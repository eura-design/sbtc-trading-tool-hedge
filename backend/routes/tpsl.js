const express = require("express");
const { binance, roundPrice, cancelOrder } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const { sideToPosition, positionToClose } = require("../utils/side");
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

    const findOrder = (type, positionSide) => {
      const r = regular.find(o => o.type === type && o.positionSide === positionSide);
      if (r) return { orderId: r.orderId, price: parseFloat(r.stopPrice), isAlgo: false };
      const closeSide = positionToClose(positionSide);
      // positionSide 필드 없는 algo 주문은 side(closeSide)로 폴백
      const a = algo.find(o => o.orderType === type &&
        (o.positionSide === positionSide || (!o.positionSide && o.side === closeSide)));
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
      .sort((a, b) => b.price - a.price);

    // SELL side = closing LONG, BUY side = closing SHORT
    const longSplitTps  = splitTps.filter(o => o.side === "SELL");
    const shortSplitTps = splitTps.filter(o => o.side === "BUY");

    res.json({
      long:  { tp: findOrder("TAKE_PROFIT_MARKET", "LONG"),  sl: findOrder("STOP_MARKET", "LONG"),  splitTps: longSplitTps  },
      short: { tp: findOrder("TAKE_PROFIT_MARKET", "SHORT"), sl: findOrder("STOP_MARKET", "SHORT"), splitTps: shortSplitTps },
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

router.put("/", async (req, res) => {
  // tp/sl 중 변경된 것만 전송 (H1: 변경되지 않은 쪽은 취소/재등록하지 않음)
  const { tp, sl, side, tpOrderId, slOrderId, tpIsAlgo, slIsAlgo } = req.body;
  if (!side) return res.status(400).json({ error: "side 필요" });
  if (!tp && !sl) return res.status(400).json({ error: "tp 또는 sl 중 하나는 필요" });

  const closeSide    = side === "BUY" ? "SELL" : "BUY";
  const positionSide = sideToPosition(side);
  const newOrders = { tp: null, sl: null };
  let noSl = false;
  let splitCanceled = 0, splitFailed = 0;

  const cancelExisting = (isAlgo, id) =>
    cancelOrder({ orderId: id, algoId: id, isAlgo })
      .catch(e => console.warn(`기존 주문 취소 실패 (id=${id}):`, e.response?.data?.msg));

  // ⚠ **단일 TP와 분할 TP는 배타다 — 단일 TP를 걸면 그 사이드 분할 TP를 전부 취소한다**
  //   (2026-08-19 사용자 확정). 같이 걸려 있으면 포지션의 200%를 팔려는 셈이다.
  //   반대 방향은 `POST /split`이 단일 TP를 취소한다 — 양방향 대칭이다
  //   ※ **`+TP` 버튼을 숨기는 방식으로 되돌리지 말 것.** 한때 분할 TP가 있으면 버튼을
  //     감췄는데, 그러면 분할 TP를 카드에서 하나씩 지워야만 단일 TP로 돌아갈 수 있었다.
  //     "나중에 건 쪽이 이긴다"가 사용자가 고른 규칙이다 (양방향 대칭이라 외울 게 하나다)
  //   ※ SL은 대상이 아니다 — 분할 TP는 익절이라 손절과 겹치지 않는다
  const cancelSplitTpsFor = async positionSide => {
    const ids = [...store.entries()]
      .filter(([, info]) => info.status === "SPLIT_TP" && info.positionSide === positionSide)
      .map(([orderId]) => orderId);
    let failed = 0;
    for (const orderId of ids) {
      try {
        await cancelOrder({ orderId });
        store.delete(orderId);
      } catch (e) {
        // 실패해도 계속 — 남은 것들이라도 지운다. 못 지운 건 응답으로 알린다
        failed++;
        console.warn(`[tpsl] 분할 TP 취소 실패 (id=${orderId}):`,
          e.response?.data?.msg || e.message);
      }
    }
    return { canceled: ids.length - failed, failed };
  };

  // ⚠ **`workingType`은 `CONTRACT_PRICE`로 통일한다** (2026-08-19 사용자 확정).
  //   여기만 `MARK_PRICE`였다 — 같은 TP/SL인데 **어떻게 걸었느냐로 발동 조건이 갈렸다**:
  //     · 진입 체결 후 자동 등록(services/binanceClient.js placeTPSL) → CONTRACT_PRICE
  //     · 차트에서 선을 드래그해 수정(여기)                          → MARK_PRICE
  //   마크 가격은 여러 거래소 지수 기반이라 실제 체결가와 어긋난다. 그래서 드래그로
  //   옮긴 SL은 **차트 캔들이 그 선을 뚫어도 발동하지 않을 수 있었다** — 화면이 보여주는
  //   건 실제 체결가(캔들)인데 판정은 다른 값으로 하고 있었다는 뜻이다.
  //   한쪽만 되돌리지 말 것 — 두 파일이 같은 값이어야 한다.
  const placeAlgo = (type, price) =>
    binance("POST", "/fapi/v1/algoOrder", {
      algoType: "CONDITIONAL", symbol: "BTCUSDT", side: closeSide, positionSide,
      type, triggerPrice: roundPrice(price),
      closePosition: "true", workingType: "CONTRACT_PRICE",
    });

  try {
    // TP가 변경된 경우에만 처리 (H1)
    if (tp) {
      if (tpOrderId) await cancelExisting(tpIsAlgo, tpOrderId);
      const r = await placeAlgo("TAKE_PROFIT_MARKET", tp);
      newOrders.tp = { orderId: r.data.algoId, price: parseFloat(roundPrice(tp)), isAlgo: true };
      // ⚠ 분할 TP는 **새 TP가 걸린 뒤에** 내린다 — 순서를 뒤집지 말 것.
      //   TP 등록은 흔히 실패한다(롱 TP를 현재가 아래에 놓으면 바이낸스 -2021 거절).
      //   먼저 지우면 그 실패 한 번에 **걸어 둔 분할 TP 여러 개가 통째로 날아간다** —
      //   화면엔 "TP/SL 수정 실패"만 뜨고 왜 분할 TP가 사라졌는지는 안 나온다.
      //   지금 순서면 TP가 실패해도 분할 TP는 그대로다 (throw → catch → 여기 도달 안 함).
      //   대신 둘 다 살아 있는 창이 한 요청만큼 생기는데, 그 사이에 TP가 발동해도
      //   포지션이 0이 되며 바이낸스가 분할 TP(reduceOnly)를 자동 취소한다 —
      //   결과가 의도한 것과 같아서 실질 위험이 없다.
      //   취소가 실패하면 공존이 남으므로 `splitFailed`로 올려 에러 배너를 띄운다
      const r0 = await cancelSplitTpsFor(positionSide);
      splitCanceled = r0.canceled;
      splitFailed   = r0.failed;
    }

    // SL이 변경된 경우에만 처리 (H1)
    if (sl) {
      if (slOrderId) await cancelExisting(slIsAlgo, slOrderId);
      try {
        const r = await placeAlgo("STOP_MARKET", sl);
        newOrders.sl = { orderId: r.data.algoId, price: parseFloat(roundPrice(sl)), isAlgo: true };
      } catch (e) {
        const msg = e.response?.data?.msg || e.message;
        console.error(`[tpsl] SL 등록 실패: ${msg}`);
        noSl = true;
      }
    }

    res.json({ success: true, tp: newOrders.tp, sl: newOrders.sl, noSl,
      splitCanceled, splitFailed });
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    console.error("[PUT /api/tpsl]", msg);
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/tpsl — 단일 TP 또는 SL 취소 (차트의 × 버튼)
// 분할 TP는 /split, 진입 미체결 주문은 /api/orders — 여기는 알고 TP/SL 하나만 다룬다
router.delete("/", async (req, res) => {
  const { orderId, isAlgo } = req.body ?? {};
  if (!orderId) return res.status(400).json({ error: "orderId 필요" });
  try {
    await cancelOrder({ orderId, algoId: orderId, isAlgo });
    res.json({ success: true });
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    console.error("[DELETE /api/tpsl]", msg);
    res.status(500).json({ error: msg });
  }
});

// POST /api/tpsl/split — 분할 TP 추가 (LIMIT positionSide 등록 후 기존 단일 TP 취소 — 순서 주의)
router.post("/split", async (req, res) => {
  const { side, price, qty, pct, tpOrderId, tpIsAlgo } = req.body;
  if (!side || !price || !qty) return res.status(400).json({ error: "side, price, qty 필요" });
  try {
    const closeSide = positionToClose(side);
    const { data } = await binance("POST", "/fapi/v1/order", {
      symbol: "BTCUSDT", side: closeSide, positionSide: side, type: "LIMIT",
      price: roundPrice(price), quantity: parseFloat(qty).toFixed(3),
      timeInForce: "GTC",
    });
    store.set(String(data.orderId), {
      status: "SPLIT_TP", price: parseFloat(roundPrice(price)),
      qty: parseFloat(qty), pct: pct ?? null, side: closeSide, positionSide: side,
    });
    // ⚠ 기존 단일 TP는 **분할 TP가 걸린 뒤에** 취소한다 (PUT과 같은 이유, 순서를 뒤집지 말 것).
    //   먼저 취소하면 LIMIT 등록이 거절됐을 때 **TP가 하나도 없는 상태**로 끝난다 —
    //   화면은 다음 폴링(60초)까지 없어진 TP 선을 계속 그린다.
    //   지금 순서면 등록 실패 시 단일 TP가 그대로 남는다
    if (tpOrderId) {
      await cancelOrder({ orderId: tpOrderId, algoId: tpOrderId, isAlgo: tpIsAlgo })
        .catch(e => console.warn(`기존 TP 취소 실패:`, e.response?.data?.msg));
    }
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
    await cancelOrder({ orderId });
    store.delete(String(orderId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
