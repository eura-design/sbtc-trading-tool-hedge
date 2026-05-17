const express = require("express");
const { binance, cancelOrder } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const router  = express.Router();

// DELETE /api/orders — 바이낸스 미체결 LIMIT 진입 주문 취소 (source of truth: Binance)
// body: { side?: "LONG"|"SHORT" } — 생략 시 전체 취소, 지정 시 해당 사이드만 취소
router.delete("/", async (req, res) => {
  try {
    const { side } = req.body ?? {};
    // 바이낸스에서 실제 미체결 LIMIT 주문 조회 후 취소
    const { data: openOrders } = await binance("GET", "/fapi/v1/openOrders", { symbol: "BTCUSDT" });
    const entryOrders = openOrders.filter(o => {
      if (o.type !== "LIMIT") return false;
      if (o.status !== "NEW" && o.status !== "PARTIALLY_FILLED") return false;
      // SCALE_IN, SPLIT_TP는 진입 주문이 아님 → 취소 대상에서 제외
      const stored = store.get(String(o.orderId));
      if (stored?.status === "SCALE_IN" || stored?.status === "SPLIT_TP") return false;
      // 헤지 모드: closing LIMIT(store 유실된 SPLIT_TP) 보호
      if ((o.side === "SELL" && o.positionSide === "LONG") ||
          (o.side === "BUY"  && o.positionSide === "SHORT")) return false;
      // side 지정 시 해당 사이드만 취소
      if (side && o.positionSide !== side) return false;
      return true;
    });

    for (const o of entryOrders) {
      await cancelOrder({ orderId: o.orderId })
        .catch(e => console.warn(`주문 취소 실패 (orderId=${o.orderId}):`, e.response?.data?.msg));
      store.delete(String(o.orderId));
    }

    // store에만 남아있는 WATCHING도 정리
    for (const [orderId, info] of store.entries()) {
      if (info.status === "WATCHING") store.delete(orderId);
    }

    res.json({ success: true, cancelled: entryOrders.length });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
