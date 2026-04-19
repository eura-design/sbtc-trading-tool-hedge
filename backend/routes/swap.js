const express = require("express");
const { binance, roundPrice, placeTPSL } = require("../services/binanceClient");
const store  = require("../store/pendingOrders");
const push   = require("../services/pushService");
const router = express.Router();

const SWAP_PCT = 0.02; // TP/SL ±2%

// 새 포지션이 Binance에 실제로 반영될 때까지 대기 (최대 maxWaitMs)
async function waitForPosition(maxWaitMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const { data } = await binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" });
      const pos = data.find(p => parseFloat(p.positionAmt) !== 0);
      if (pos) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// POST /api/swap
// body: { lastPrice: number, leverage: number }
router.post("/", async (req, res) => {
  const { lastPrice, leverage } = req.body;
  if (!lastPrice) return res.status(400).json({ error: "lastPrice 필요" });

  // 1) 현재 포지션 조회
  let positionAmt, currentSide;
  try {
    const { data } = await binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" });
    const pos = data.find(p => parseFloat(p.positionAmt) !== 0);
    if (!pos) return res.status(400).json({ error: "열린 포지션이 없습니다" });
    positionAmt  = Math.abs(parseFloat(pos.positionAmt));
    currentSide  = parseFloat(pos.positionAmt) > 0 ? "LONG" : "SHORT";
  } catch (e) {
    return res.status(500).json({ error: `포지션 조회 실패: ${e.message}` });
  }

  const newSide        = currentSide === "LONG" ? "SHORT" : "LONG";
  const closeSideOld   = currentSide === "LONG" ? "SELL"  : "BUY";  // 기존 포지션 청산
  const openSideNew    = newSide     === "LONG" ? "BUY"   : "SELL"; // 신규 포지션 진입
  const closeSideNew   = newSide     === "LONG" ? "SELL"  : "BUY";  // 신규 TP/SL용

  // 레버리지 설정 (필요 시)
  if (leverage) {
    try {
      await binance("POST", "/fapi/v1/leverage", { symbol: "BTCUSDT", leverage: parseInt(leverage) });
    } catch (e) {
      console.warn("[swap] 레버리지 설정 실패 (계속):", e.message);
    }
  }

  // 2) SCALE_IN + SPLIT_TP + TP/SL 전부 취소
  try {
    const [regularRes, algoRes] = await Promise.allSettled([
      binance("GET", "/fapi/v1/openOrders",     { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" }),
    ]);
    const regular = regularRes.status === "fulfilled" ? regularRes.value.data : [];
    const algoRaw = algoRes.status    === "fulfilled" ? algoRes.value.data    : [];
    const algo    = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);

    const toCancel = regular.filter(o => {
      const st = store.get(String(o.orderId))?.status;
      return ["TAKE_PROFIT_MARKET", "STOP_MARKET"].includes(o.type)
          || st === "SCALE_IN"
          || st === "SPLIT_TP";
    });

    await Promise.allSettled([
      ...toCancel.map(o =>
        binance("DELETE", "/fapi/v1/order", { symbol: "BTCUSDT", orderId: o.orderId })
      ),
      ...algo
        .filter(o => ["TAKE_PROFIT_MARKET", "STOP_MARKET"].includes(o.orderType))
        .map(o => binance("DELETE", "/fapi/v1/algoOrder", { symbol: "BTCUSDT", algoId: o.algoId })),
    ]);
    toCancel.forEach(o => {
      const st = store.get(String(o.orderId))?.status;
      if (st === "SCALE_IN" || st === "SPLIT_TP") store.delete(String(o.orderId));
    });
  } catch (e) {
    console.warn("[swap] 주문 취소 오류 (청산 계속):", e.message);
  }

  // 3) 시장가 청산
  try {
    await binance("POST", "/fapi/v1/order", {
      symbol:     "BTCUSDT",
      side:       closeSideOld,
      type:       "MARKET",
      quantity:   positionAmt.toFixed(3),
      reduceOnly: "true",
    });
  } catch (e) {
    const msg = e.response?.data?.msg || e.message;
    console.error("[swap] 청산 실패:", msg);
    return res.status(500).json({ error: `청산 실패: ${msg}` });
  }

  // 4) 반대 방향 시장가 진입
  let entryOrder;
  try {
    const { data } = await binance("POST", "/fapi/v1/order", {
      symbol:   "BTCUSDT",
      side:     openSideNew,
      type:     "MARKET",
      quantity: positionAmt.toFixed(3),
    });
    entryOrder = data;
  } catch (e) {
    const msg = e.response?.data?.msg || e.message;
    console.error("[swap] 반대 진입 실패:", msg);
    push.pushUpdate(["position", "tpsl"]);
    // closeOnly: true → 프론트에서 criticalAlert 표시
    return res.status(500).json({ error: `청산 완료, 반대 진입 실패: ${msg}`, closeOnly: true });
  }

  // 5) 포지션 반영 확인 후 TP/SL 계산 및 등록
  await waitForPosition();

  const ap = parseFloat(entryOrder.avgPrice);
  const fillPrice = ap > 0 ? ap : parseFloat(lastPrice);
  const tp = newSide === "LONG"
    ? roundPrice(fillPrice * (1 + SWAP_PCT))
    : roundPrice(fillPrice * (1 - SWAP_PCT));
  const sl = newSide === "LONG"
    ? roundPrice(fillPrice * (1 - SWAP_PCT))
    : roundPrice(fillPrice * (1 + SWAP_PCT));

  const tpslInfo = {
    side:      openSideNew,
    closeSide: closeSideNew,
    tp, sl,
    qty:    positionAmt,
    status: "FILLED",
    filledAt: Date.now(),
  };
  const tpslResult = await placeTPSL(tpslInfo);

  // 실패 시 store에 저장 → reconcileWithBinance가 15초 내 자동 재시도
  if (tpslResult.failed.length > 0) {
    const orderId = `swap_${Date.now()}`;
    store.set(orderId, { ...tpslInfo, status: "TPSL_PARTIAL", tpsl: tpslResult });
    console.error(`[swap] TP/SL 실패 → store 저장 (reconcile 재시도 대기) key=${orderId}`);
  }

  push.pushUpdate(["position", "tpsl"]);

  res.json({
    success:  true,
    newSide,
    quantity: positionAmt,
    fillPrice,
    tp, sl,
    warning: tpslResult.failed.length > 0
      ? `${tpslResult.failed.map(f => f.type).join(", ")} 등록 실패 — 자동 재시도 중`
      : null,
  });
});

module.exports = router;
