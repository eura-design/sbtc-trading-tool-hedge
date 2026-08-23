const express = require("express");
const { binance, roundPrice, cancelOrder, cancelPresetTPSL, assertCancelKind } = require("../services/binanceClient");
const store = require("../store/pendingOrders");
const { sideToPosition } = require("../utils/side");
const router = express.Router();

// POST /api/scale-in — 포지션 추가 진입 (TP/SL 없음)
router.post("/", async (req, res) => {
  const { side, orderType, price, quantity } = req.body;
  if (!side || !orderType || !quantity) {
    return res.status(400).json({ error: "side, orderType, quantity 필요" });
  }
  if (orderType === "LIMIT" && !price) {
    return res.status(400).json({ error: "LIMIT 주문에는 price 필요" });
  }
  try {
    const positionSide = sideToPosition(side);
    const params = {
      symbol:   "BTCUSDT",
      side,
      positionSide,
      type:     orderType,
      quantity: parseFloat(quantity).toFixed(3),
      ...(orderType === "LIMIT" && { price: roundPrice(price), timeInForce: "GTC" }),
    };
    const { data } = await binance("POST", "/fapi/v1/order", params);
    if (orderType === "LIMIT") {
      store.set(String(data.orderId), { status: "SCALE_IN", price: parseFloat(roundPrice(price)), side });
    }
    res.json({ success: true, orderId: data.orderId, status: data.status,
      fillPrice: orderType === "MARKET" ? parseFloat(data.avgPrice || 0) : null });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

// DELETE /api/scale-in — 특정 추가 진입 주문 취소
router.delete("/", async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: "orderId 필요" });
  try {
    await assertCancelKind(orderId, "SCALE_IN");   // 엉뚱한 주문 취소 방지
    await cancelOrder({ orderId });
    // ⚠ 보통 추가 진입에는 사전 TP/SL이 없다. 다만 **그 사이드에 이미 포지션이 있는 채로
    //   진입 주문이 들어오면**(플랜 박스로는 막혀 있지만 외부·API 경로가 남아 있다)
    //   `orderKind`가 그 주문을 추가 진입으로 분류해 취소가 이 경로로 온다.
    //   그때 사전 등록분을 안 내리면 트리거 주문만 거래소에 남는다 (2026-08-23 실측)
    const info = store.get(String(orderId));
    if (info?.presetTpsl) {
      await cancelPresetTPSL(info.presetTpsl)
        .catch(e => console.warn("[scale-in] 사전 TPSL 취소 실패:", e.message));
    }
    store.delete(String(orderId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
