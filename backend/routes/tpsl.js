const express = require("express");
const { binance, roundPrice } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const router  = express.Router();

router.get("/", async (req, res) => {
  try {
    const [regularRes, algoRes] = await Promise.allSettled([
      binance("GET", "/fapi/v1/openOrders",     { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" }),
    ]);
    const regular = regularRes.status === "fulfilled" ? regularRes.value.data : [];
    const algoRaw = algoRes.status  === "fulfilled" ? algoRes.value.data  : [];
    const algo    = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);

    const findOrder = (type) => {
      const r = regular.find(o => o.type === type);
      if (r) return { orderId: r.orderId, price: parseFloat(r.stopPrice), isAlgo: false };
      const a = algo.find(o => o.orderType === type);
      if (a) return { orderId: a.algoId, price: parseFloat(a.triggerPrice), isAlgo: true };
      return null;
    };

    // SPLIT_TP: store에 있는데 바이낸스에 없으면 이미 체결/취소됨 → store 정리
    // 단, openOrders 조회 실패 시엔 정리 스킵 — 빈 배열을 "없음"으로 오판하면
    // 살아있는 SPLIT_TP가 지워져 position.js에서 external 주문으로 오인됨
    if (regularRes.status === "fulfilled") {
      const openIds = new Set(regular.map(o => String(o.orderId)));
      for (const [orderId, info] of store.entries()) {
        if (info.status === "SPLIT_TP" && !openIds.has(String(orderId))) {
          console.log(`[TPSL] SPLIT_TP ${orderId}이 바이낸스에 없음 → 제거`);
          store.delete(orderId);
        }
      }
    } else {
      console.warn("[TPSL] openOrders 조회 실패 → SPLIT_TP 정리 스킵:",
        regularRes.reason?.response?.data?.msg || regularRes.reason?.message);
    }

    const splitTps = regular
      .filter(o => store.get(String(o.orderId))?.status === "SPLIT_TP")
      .map(o => ({
        orderId: String(o.orderId),
        price:   parseFloat(o.price),
        qty:     parseFloat(o.origQty),
        side:    o.side,
        pct:     store.get(String(o.orderId))?.pct ?? null,
      }))
      .sort((a, b) => a.side === "SELL" ? a.price - b.price : b.price - a.price);

    res.json({ tp: findOrder("TAKE_PROFIT_MARKET"), sl: findOrder("STOP_MARKET"), splitTps });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

router.put("/", async (req, res) => {
  // tp/sl 중 변경된 것만 전송 (H1: 변경되지 않은 쪽은 취소/재등록하지 않음)
  const { tp, sl, side, tpOrderId, slOrderId, tpIsAlgo, slIsAlgo } = req.body;
  if (!side) return res.status(400).json({ error: "side 필요" });
  if (!tp && !sl) return res.status(400).json({ error: "tp 또는 sl 중 하나는 필요" });

  const closeSide = side === "BUY" ? "SELL" : "BUY";
  const newOrders = { tp: null, sl: null };
  let noSl = false;

  const cancelOrder = (isAlgo, id) => {
    const p = isAlgo
      ? binance("DELETE", "/fapi/v1/algoOrder", { symbol: "BTCUSDT", algoId: id })
      : binance("DELETE", "/fapi/v1/order",     { symbol: "BTCUSDT", orderId: id });
    return p.catch(e => console.warn(`기존 주문 취소 실패 (id=${id}):`, e.response?.data?.msg));
  };

  const placeAlgo = (type, price) =>
    binance("POST", "/fapi/v1/algoOrder", {
      algoType: "CONDITIONAL", symbol: "BTCUSDT", side: closeSide,
      type, triggerPrice: roundPrice(price),
      closePosition: "true", workingType: "MARK_PRICE",
    });

  try {
    // TP가 변경된 경우에만 처리 (H1)
    if (tp) {
      if (tpOrderId) await cancelOrder(tpIsAlgo, tpOrderId);
      const r = await placeAlgo("TAKE_PROFIT_MARKET", tp);
      newOrders.tp = { orderId: r.data.algoId, price: parseFloat(roundPrice(tp)), isAlgo: true };
    }

    // SL이 변경된 경우에만 처리 (H1)
    if (sl) {
      if (slOrderId) await cancelOrder(slIsAlgo, slOrderId);
      try {
        const r = await placeAlgo("STOP_MARKET", sl);
        newOrders.sl = { orderId: r.data.algoId, price: parseFloat(roundPrice(sl)), isAlgo: true };
      } catch (e) {
        const msg = e.response?.data?.msg || e.message;
        console.error(`[tpsl] SL 등록 실패: ${msg}`);
        noSl = true;
      }
    }

    res.json({ success: true, tp: newOrders.tp, sl: newOrders.sl, noSl });
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    console.error("[PUT /api/tpsl]", msg);
    res.status(500).json({ error: msg });
  }
});

// POST /api/tpsl/split — 분할 TP 추가 (기존 단일 TP 취소 후 LIMIT reduceOnly 등록)
router.post("/split", async (req, res) => {
  const { side, price, qty, pct, tpOrderId, tpIsAlgo } = req.body;
  if (!side || !price || !qty) return res.status(400).json({ error: "side, price, qty 필요" });
  try {
    // 기존 단일 TP 취소
    if (tpOrderId) {
      const cancel = tpIsAlgo
        ? binance("DELETE", "/fapi/v1/algoOrder", { symbol: "BTCUSDT", algoId: tpOrderId })
        : binance("DELETE", "/fapi/v1/order",     { symbol: "BTCUSDT", orderId: tpOrderId });
      await cancel.catch(e => console.warn(`기존 TP 취소 실패:`, e.response?.data?.msg));
    }
    const closeSide = side === "LONG" ? "SELL" : "BUY";
    const { data } = await binance("POST", "/fapi/v1/order", {
      symbol: "BTCUSDT", side: closeSide, type: "LIMIT",
      price: roundPrice(price), quantity: parseFloat(qty).toFixed(3),
      timeInForce: "GTC", reduceOnly: "true",
    });
    store.set(String(data.orderId), {
      status: "SPLIT_TP", price: parseFloat(roundPrice(price)),
      qty: parseFloat(qty), pct: pct ?? null, side: closeSide,
    });
    res.json({ success: true, orderId: String(data.orderId),
      price: parseFloat(roundPrice(price)), qty: parseFloat(qty) });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

// DELETE /api/tpsl/split — 특정 분할 TP 취소
router.delete("/split", async (req, res) => {
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
