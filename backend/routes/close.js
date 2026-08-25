const express = require("express");
const { binance, cancelOrder } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const push    = require("../services/pushService");
const { log, errOf } = require("../store/logStore");
const { positionToClose } = require("../utils/side");
const { rescaleSplitTps } = require("../utils/splitTp");
const { isLiveLimit, isEntryDir, isCloseDir, TPSL_TYPES,
  isFullClose, orderQtyOf } = require("../utils/orderKind");
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
  let partialSlOrders = [];
  let originalSize  = 0;
  if (partial) {
    try {
      const [{ data: openOrders }, { data: posData }, algoRes] = await Promise.all([
        binance("GET", "/fapi/v1/openOrders",   { symbol: "BTCUSDT" }),
        binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" }),
        binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" }),
      ]);
      const algoRaw = algoRes.data;
      const algos = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);
      // 해당 사이드의 분할 TP만 취소 (반대쪽 SPLIT_TP는 건드리지 않음)
      // 외부에서 건 분할 TP도 포함해야 잔여 비율 재계산이 맞는다 (2026-08-23)
      splitTpOrders = openOrders.filter(o =>
        isLiveLimit(o) && isCloseDir(o) && o.positionSide === side
      );
      // ⚠ **가격 내림차순으로 정렬한다** (2026-08-19). 바이낸스 openOrders는 순서를
      //   보장하지 않는데, 재계산이 반올림 초과분을 뒤에서부터 깎으므로 순서가 결과를
      //   0.001만큼 좌우한다. 페이퍼 브로커(paperBroker.addSplitTp)와 GET /api/tpsl도
      //   같은 정렬이라 여기서 맞춰야 실거래·연습·화면이 전부 같은 항목을 가리킨다
      splitTpOrders.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
      // 해당 사이드의 포지션 크기를 기준으로 비율 계산
      const pos = posData.find(p => p.positionSide === side && parseFloat(p.positionAmt) !== 0);
      originalSize = pos ? Math.abs(parseFloat(pos.positionAmt)) : 0;

      // ── 분할 SL 목록 (2026-08-24) — **여기서 취소하지 않는다.** 아래 3-2) 참고 ──
      // 사전 등록분(preplaceTPSL)은 뺀다 — 그건 아직 체결 안 된 진입 주문에 딸린
      // 것이라 이 포지션과 무관하다 (`GET /api/tpsl`이 거르는 것과 같은 이유)
      const presetIds = new Set();
      for (const [, info] of store.entries()) {
        if (info.status !== "WATCHING" || !info.presetTpsl) continue;
        for (const k of ["tp", "sl"]) {
          const id = info.presetTpsl[k]?.orderId;
          if (id) presetIds.add(String(id));
        }
      }
      const mine = o => isCloseDir(o) && o.positionSide === side && !isFullClose(o);
      partialSlOrders = [
        ...openOrders.filter(o => TPSL_TYPES.includes(o.type) && mine(o)
            && !presetIds.has(String(o.orderId)))
          .map(o => ({ id: String(o.orderId), isAlgo: false,
                       price: o.stopPrice, origQty: String(orderQtyOf(o)) })),
        ...algos.filter(o => TPSL_TYPES.includes(o.orderType) && mine(o)
            && !presetIds.has(String(o.algoId)))
          .map(o => ({ id: String(o.algoId), isAlgo: true,
                       price: o.triggerPrice, origQty: String(orderQtyOf(o)) })),
      ].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    } catch (e) {
      console.warn("[close] 분할 TP 사전 조회 실패:", e.message);
    }

    // ⚠ **포지션 크기를 못 읽었으면 취소하지 않는다** (2026-08-19).
    //   예전엔 조회 실패·포지션 미발견이어도 취소부터 하고, 아래 재등록은
    //   `originalSize > 0` 가드에 막혀 건너뛰었다 → **분할 TP가 통째로 사라졌다.**
    //   되돌릴 근거(비율)가 없으면 손대지 않는 쪽이 안전하다. 대신 소리를 낸다 —
    //   예전엔 console.warn 한 줄이라 화면에서는 알 방법이 없었다
    if (splitTpOrders.length > 0 && originalSize > 0) {
      await Promise.allSettled(
        splitTpOrders.map(o =>
          cancelOrder({ orderId: o.orderId })
            .catch(e => console.warn(`[close] 분할 TP 사전 취소 실패 ${o.orderId}:`, e.response?.data?.msg))
        )
      );
      splitTpOrders.forEach(o => store.delete(String(o.orderId)));
    } else if (splitTpOrders.length > 0) {
      console.warn("[close] 포지션 크기 조회 실패 — 분할 TP를 건드리지 않고 청산만 진행");
      // notice = 금색 토스트 (pushService 참고) — 익절 쪽이라 손절은 그대로 살아 있다
      push.pushAlert("notice", "포지션 크기를 읽지 못해 분할 TP를 조정하지 못했습니다 — 분할 TP 카드에서 수량을 확인하세요");
      splitTpOrders = [];   // 취소한 적이 없으므로 재등록·롤백 대상에서도 뺀다
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

    // ⚠ **추가 진입 판정을 store가 아니라 주문 방향으로 한다** (2026-08-23).
    //   지금 이 사이드는 청산 중이라 포지션이 있는 상태 → 진입 방향 지정가는
    //   전부 추가 진입이다. store로 걸렀을 땐 **밖에서 낸 추가 진입이 안 잡혀서,
    //   청산 뒤에도 살아남아 나중에 손절 없는 새 포지션을 열 수 있었다**
    const scaleInToCancel = regular.filter(o =>
      isLiveLimit(o) && isEntryDir(o) && o.positionSide === side
    );

    await Promise.allSettled([
      // TP/SL: positionSide로 해당 사이드만 취소 (반대쪽 TP/SL은 보존)
      // ⚠ **지정가형(`STOP`/`TAKE_PROFIT`)도 지운다** (2026-08-23 감사에서 누락 발견).
      //   `GET /api/tpsl`은 지정가형도 TP/SL로 읽는데 청산이 그걸 안 지우면,
      //   포지션이 사라진 뒤에도 트리거 주문이 거래소에 남는다
      //   (조건부 주문은 포지션이 0이 돼도 자동 취소되지 않는다 — 같은 날 실측)
      ...regular
        .filter(o => TPSL_TYPES.includes(o.type) && o.positionSide === side)
        .map(o => cancelOrder({ orderId: o.orderId })),
      ...algo
        .filter(o => TPSL_TYPES.includes(o.orderType) && o.positionSide === side)
        .map(o => cancelOrder({ algoId: o.algoId, isAlgo: true })),
      ...scaleInToCancel
        .map(o => cancelOrder({ orderId: o.orderId })),
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
    //    ⚠ 수량 계산은 utils/splitTp.js가 전부 한다 — **여기서 다시 계산하지 말 것.**
    //      "마지막 항목만 잔여에서 역산"하던 옛 식이 미커버분을 그 항목에 몰아주는
    //      버그였다 (그쪽 주석에 실측값). 지금은 전부 같은 비율로 줄이고 반올림
    //      초과분만 깎는다
    if (partial && splitTpOrders.length > 0 && originalSize > 0) {
      const { newSize, items } = rescaleSplitTps(splitTpOrders, originalSize, closeQty);
      let anyFailed = false;
      for (const { order: o, qty, pct } of items) {
        try {
          const { data: newOrder } = await binance("POST", "/fapi/v1/order", {
            symbol: "BTCUSDT", side: o.side, positionSide: side, type: "LIMIT",
            price: o.price, quantity: qty.toFixed(3),
            timeInForce: "GTC",
          });
          store.set(String(newOrder.orderId), {
            status: "SPLIT_TP",
            price:  parseFloat(o.price),
            qty,
            pct,
            side:   o.side,
            // 어느 쪽 포지션의 분할 TP인지 (2026-08-23). 지금 이 값을 읽는 경로는 없다 —
            // 판정은 utils/orderKind.js가 주문 방향으로 한다. 진단·복구용으로 남긴다
            positionSide: side,
          });
          console.log(`[close] 분할 TP 재등록: ${o.price} × ${qty} BTC`);
        } catch (e) {
          anyFailed = true;
          console.warn(`[close] 분할 TP 재등록 실패 ${o.price}:`, e.response?.data?.msg);
        }
      }
      if (anyFailed) push.pushAlert("notice", "분할 TP 재등록 일부 실패 — 분할 TP 카드에서 수동 확인 필요");
      // 잔여가 최소 수량 미만이면 items가 비어 있다 (사실상 전량 청산 — 재등록할 게 없다)
      if (newSize >= 0.001 && items.length === 0 && splitTpOrders.length > 0) {
        push.pushAlert("notice", "분할 TP가 최소 수량 미만이 되어 재등록되지 않았습니다");
      }

      push.pushUpdate(["tpsl"]);
    }

    // 3-2) 부분 청산 성공 → **분할 SL도 잔여 비율로 맞춘다** (2026-08-24)
    //
    // ⚠ 왜 맞춰야 하나: 안 고치면 "절반만 빼는 손절"이 슬그머니 **전량 손절로 변한다.**
    //   0.173에 0.087을 걸어두고 절반 청산하면 포지션 0.086 < 주문 0.087이 되어,
    //   그 가격에서 **전부** 나간다 — 시킨 것과 다른 일이다
    //
    // ⚠ **분할 TP와 순서가 반대다.** 저쪽은 미리 취소하고 청산 뒤 재등록하는데(롤백 있음),
    //   손절을 먼저 내리면 청산이 실패했을 때 **보호가 없는 창**이 생긴다. 그래서
    //     ① 청산이 성공한 뒤에 ② **새 것을 먼저 걸고** ③ 옛 것을 취소한다.
    //   어느 단계가 실패해도 **보호가 줄어드는 경로가 없다** — 겹치는 동안은 과하게
    //   덮이는 것이고 그건 `reduceOnly`가 잘라내므로 무해하다
    //
    // ⚠ 잔여가 최소 수량 미만이 되어 빠진 항목은 **옛 주문을 그대로 둔다.** 지우면
    //   그만큼 무방비다 (분할 TP는 지워도 손해가 없어 규칙이 다르다)
    if (partial && partialSlOrders.length > 0 && originalSize > 0) {
      const { items } = rescaleSplitTps(partialSlOrders, originalSize, closeQty);
      let anyFailed = false;
      for (const { order: o, qty } of items) {
        try {
          await binance("POST", "/fapi/v1/algoOrder", {
            algoType: "CONDITIONAL", symbol: "BTCUSDT",
            side: closeSide, positionSide: side,
            type: "STOP_MARKET", triggerPrice: o.price,
            quantity: qty.toFixed(3), workingType: "CONTRACT_PRICE",
          });
          await cancelOrder({ orderId: o.id, algoId: o.id, isAlgo: o.isAlgo })
            .catch(e => { anyFailed = true;
              console.warn(`[close] 분할 SL 옛 주문 취소 실패 ${o.id} (겹쳐도 무해):`,
                e.response?.data?.msg); });
          console.log(`[close] 분할 SL 재조정: ${o.price} ${o.origQty} → ${qty}`);
        } catch (e) {
          anyFailed = true;
          console.warn(`[close] 분할 SL 재조정 실패 ${o.price} — 기존 주문을 그대로 둔다:`,
            e.response?.data?.msg);
        }
      }
      const kept = new Set(items.map(x => x.order.id));
      const dropped = partialSlOrders.filter(o => !kept.has(o.id));
      if (dropped.length) {
        console.log(`[close] 분할 SL ${dropped.length}건은 잔여가 최소 수량 미만 → 그대로 둔다`);
      }
      if (anyFailed) {
        // ⚠ 여기만 **빨간 배너**다 (위 세 줄은 notice). 분할 SL은 손절이라,
        //   수량이 어긋나면 포지션의 일부가 손절 없이 남는다 — notice로 내리지 말 것
        push.pushAlert("critical", "분할 SL 재조정 일부 실패 — 분할 SL 카드에서 수량을 확인하세요");
      }
      push.pushUpdate(["tpsl"]);
    }

    log("POSITION_CLOSED", { posSide: side, partial: !!partial, qty: closeQty,
      orderId: data.orderId, status: data.status });
    // 이 청산이 얼마 벌었는지를 **주문번호에 붙여** 남긴다 (TRADE_SETTLED).
    // 체결이 잡힐 때까지 조금 기다린다 — 응답 직후에는 아직 비어 있다
    setTimeout(() => {
      require("../services/incomeLogger")
        .logTradesFor(data.orderId, { posSide: side, partial: !!partial })
        .catch(() => {});
    }, 2500);
    res.json({ success: true, orderId: data.orderId, status: data.status });
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    console.error("[POST /api/close]", msg);
    log("POSITION_CLOSE_FAILED", { level: "error", posSide: side, partial: !!partial,
      qty: parseFloat(quantity), err: errOf(err) });

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
            positionSide: side,   // 재등록과 같은 이유 (진단·복구용 메타)
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
