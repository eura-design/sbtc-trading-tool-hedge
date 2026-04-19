const express = require("express");
const { binance, roundPrice } = require("../services/binanceClient");
const store = require("../store/pendingOrders");
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
    const params = {
      symbol:   "BTCUSDT",
      side,
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
    await binance("DELETE", "/fapi/v1/order", { symbol: "BTCUSDT", orderId });
    store.delete(String(orderId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
