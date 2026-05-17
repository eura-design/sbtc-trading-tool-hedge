const express = require("express");
const { binance } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const push    = require("../services/pushService");
const { positionToClose } = require("../utils/side");
const router  = express.Router();

// 사이드별 처리 중 락 — 부분 청산의 분할TP 사전취소~재등록 윈도우와
// 다른 close/scale-in 요청이 겹쳐서 잔여 수량 계산이 꼬이는 race 방지
const closeInProgress = new Set();

// POST /api/close
// body: { side: "LONG"|"SHORT", quantity: string, partial?: boolean }
// 1) 전량 청산: TP/SL 취소 후 시장가 청산
// 2) 부분 청산: 시장가 청산 후 분할 TP를 잔여 포지션 비율로 재등록
router.post("/", async (req, res) => {
  const { side, quantity, partial = false } = req.body;
  if (!side || !quantity) return res.status(400).json({ error: "side, quantity 필요" });

  if (closeInProgress.has(side)) {
    return res.status(409).json({ error: `${side} 청산이 이미 진행 중입니다. 잠시 후 다시 시도하세요` });
  }
  closeInProgress.add(side);
  try {

  const closeSide = positionToClose(side);
  const closeQty  = parseFloat(quantity);

  // 부분 청산 시 분할 TP 미리 취소 (race condition 방지)
  // 취소 후 청산 실패 시 롤백을 위해 원본 정보 보존
  let splitTpOrders = [];
  let originalSize  = 0;
  if (partial) {
    try {
      const [{ data: openOrders }, { data: posData }] = await Promise.all([
        binance("GET", "/fapi/v1/openOrders",   { symbol: "BTCUSDT" }),
        binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" }),
      ]);
      // 해당 사이드의 분할 TP만 취소 (반대쪽 SPLIT_TP는 건드리지 않음)
      splitTpOrders = openOrders.filter(o =>
        store.get(String(o.orderId))?.status === "SPLIT_TP" && o.side === closeSide
      );
      // 해당 사이드의 포지션 크기를 기준으로 비율 계산
      const pos = posData.find(p => p.positionSide === side && parseFloat(p.positionAmt) !== 0);
      originalSize = pos ? Math.abs(parseFloat(pos.positionAmt)) : 0;
    } catch (e) {
      console.warn("[close] 분할 TP 사전 조회 실패:", e.message);
    }

    if (splitTpOrders.length > 0) {
      await Promise.allSettled(
        splitTpOrders.map(o =>
          binance("DELETE", "/fapi/v1/order", { symbol: "BTCUSDT", orderId: o.orderId })
            .catch(e => console.warn(`[close] 분할 TP 사전 취소 실패 ${o.orderId}:`, e.response?.data?.msg))
        )
      );
      splitTpOrders.forEach(o => store.delete(String(o.orderId)));
    }
  }

  // 1) 전량 청산 시에만 TP/SL + SCALE_IN 취소 (해당 사이드만)
  if (!partial) try {
    const [regularRes, algoRes] = await Promise.allSettled([
      binance("GET", "/fapi/v1/openOrders",     { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" }),
    ]);
    const regular = regularRes.status === "fulfilled" ? regularRes.value.data : [];
    const algoRaw = algoRes.status  === "fulfilled" ? algoRes.value.data  : [];
    const algo    = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);

    // SCALE_IN: positionSide로 해당 사이드만 취소
    const scaleInToCancel = regular.filter(o =>
      store.get(String(o.orderId))?.status === "SCALE_IN" && o.positionSide === side
    );

    await Promise.allSettled([
      // TP/SL: positionSide로 해당 사이드만 취소 (반대쪽 TP/SL은 보존)
      ...regular
        .filter(o => ["TAKE_PROFIT_MARKET", "STOP_MARKET"].includes(o.type) && o.positionSide === side)
        .map(o => binance("DELETE", "/fapi/v1/order", { symbol: "BTCUSDT", orderId: o.orderId })),
      ...algo
        .filter(o => ["TAKE_PROFIT_MARKET", "STOP_MARKET"].includes(o.orderType) && o.positionSide === side)
        .map(o => binance("DELETE", "/fapi/v1/algoOrder", { symbol: "BTCUSDT", algoId: o.algoId })),
      ...scaleInToCancel
        .map(o => binance("DELETE", "/fapi/v1/order", { symbol: "BTCUSDT", orderId: o.orderId })),
    ]);
    scaleInToCancel.forEach(o => {
      store.delete(String(o.orderId));
      console.log(`[close] SCALE_IN 주문 취소: orderId=${o.orderId}`);
    });
  } catch (e) {
    console.warn("[close] TP/SL/SCALE_IN 취소 중 오류 (청산 계속):", e.message);
  }

  // 2) 시장가 청산
  try {
    const { data } = await binance("POST", "/fapi/v1/order", {
      symbol:       "BTCUSDT",
      side:         closeSide,
      positionSide: side,
      type:         "MARKET",
      quantity:     closeQty.toFixed(3),
    });

    // 3) 부분 청산 성공 → 분할 TP를 잔여 포지션 비율로 재등록
    if (partial && splitTpOrders.length > 0 && originalSize > 0) {
      const newSize = Math.max(0, originalSize - closeQty);
      const ratio   = newSize / originalSize;

      // 잔여 포지션이 있으면 비율 조정해서 재등록
      // 마지막 항목은 반올림 오차 누적을 방지하기 위해 newSize - 앞 항목 합계로 계산
      if (newSize >= 0.001) {
        let sumQty = 0;
        let anyFailed = false;
        for (let i = 0; i < splitTpOrders.length; i++) {
          const o = splitTpOrders[i];
          const isLast = i === splitTpOrders.length - 1;
          const rawQty = isLast
            ? Math.max(0, newSize - sumQty)
            : parseFloat(o.origQty) * ratio;
          const newQty = parseFloat(rawQty.toFixed(3));
          if (newQty < 0.001) continue;
          sumQty += newQty;
          try {
            const { data: newOrder } = await binance("POST", "/fapi/v1/order", {
              symbol: "BTCUSDT", side: o.side, positionSide: side, type: "LIMIT",
              price: o.price, quantity: newQty.toFixed(3),
              timeInForce: "GTC",
            });
            store.set(String(newOrder.orderId), {
              status: "SPLIT_TP",
              price:  parseFloat(o.price),
              qty:    newQty,
              pct:    Math.round(newQty / newSize * 100),
              side:   o.side,
            });
            console.log(`[close] 분할 TP 재등록: ${o.price} × ${newQty} BTC`);
          } catch (e) {
            anyFailed = true;
            console.warn(`[close] 분할 TP 재등록 실패 ${o.price}:`, e.response?.data?.msg);
          }
        }
        if (anyFailed) push.pushAlert("error", "분할 TP 재등록 일부 실패 — 분할 TP 카드에서 수동 확인 필요");
      }

      push.pushUpdate(["tpsl"]);
    }

    res.json({ success: true, orderId: data.orderId, status: data.status });
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    console.error("[POST /api/close]", msg);

    // 부분 청산 실패 시 사전 취소했던 분할 TP 롤백
    if (partial && splitTpOrders.length > 0) {
      console.warn("[close] 청산 실패 — 분할 TP 롤백 시도");
      for (const o of splitTpOrders) {
        try {
          const { data: restored } = await binance("POST", "/fapi/v1/order", {
            symbol: "BTCUSDT", side: o.side, positionSide: side, type: "LIMIT",
            price: o.price, quantity: o.origQty,
            timeInForce: "GTC",
          });
          store.set(String(restored.orderId), {
            status: "SPLIT_TP",
            price:  parseFloat(o.price),
            qty:    parseFloat(o.origQty),
            pct:    store.get(String(o.orderId))?.pct ?? null,
            side:   o.side,
          });
          console.log(`[close] 분할 TP 롤백 완료: ${o.price} × ${o.origQty} BTC`);
        } catch (re) {
          console.error(`[close] 분할 TP 롤백 실패 ${o.price}:`, re.response?.data?.msg);
        }
      }
      push.pushUpdate(["tpsl"]);
    }

    res.status(500).json({ error: msg });
  }

  } finally {
    closeInProgress.delete(side);
  }
});

module.exports = router;
