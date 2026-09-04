const express = require("express");
const { binance, cancelOrder, roundQty } = require("../services/binanceClient");
const symbolInfo = require("../services/symbolInfo");
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

  const symbol    = symbolInfo.fromRequest(req);
  // ⚠ 분할 TP/SL 재계산에도 **그 심볼의 수량 단위**를 넘긴다. 0.001로 계산하면
  //   DOGE(단위 1)에서 0.5짜리가 최소 수량 필터를 통과한 뒤 roundQty에서 0으로
  //   내려가 **수량 0인 주문**이 나간다
  const { stepSize, minQty } = symbolInfo.filtersOf(symbol);
  const qStep = Number(stepSize), qMin = Number(minQty);
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
        binance("GET", "/fapi/v1/openOrders",   { symbol }),
        binance("GET", "/fapi/v2/positionRisk", { symbol }),
        binance("GET", "/fapi/v1/openAlgoOrders", { symbol }),
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
      log("QUERY_FAILED", { level: "warn", what: "splitTp", ctx: "closePrepare", posSide: side, err: errOf(e) });
    }

    // ⚠ **포지션 크기를 못 읽었으면 취소하지 않는다** (2026-08-19).
    //   예전엔 조회 실패·포지션 미발견이어도 취소부터 하고, 아래 재등록은
    //   `originalSize > 0` 가드에 막혀 건너뛰었다 → **분할 TP가 통째로 사라졌다.**
    //   되돌릴 근거(비율)가 없으면 손대지 않는 쪽이 안전하다. 대신 소리를 낸다 —
    //   예전엔 console.warn 한 줄이라 화면에서는 알 방법이 없었다
    if (splitTpOrders.length > 0 && originalSize > 0) {
      await Promise.allSettled(
        splitTpOrders.map(o =>
          cancelOrder({ orderId: o.orderId, symbol })
            .catch(e => log("ORDER_CANCEL_FAILED", { level: "warn", orderId: o.orderId, kindOf: "SPLIT_TP", ctx: "closePrepare", err: errOf(e) }))
        )
      );
      splitTpOrders.forEach(o => store.delete(String(o.orderId)));
    } else if (splitTpOrders.length > 0) {
      log("SPLIT_TP_UNTOUCHED", { level: "warn", posSide: side, orders: splitTpOrders.length, });
      // notice = 금색 토스트 (pushService 참고) — 익절 쪽이라 손절은 그대로 살아 있다
      // ⚠ **롱·숏을 적는다** (2026-09-04 사용자 요청). 둘 다 들고 있으면 어느 쪽 얘기인지
      //   알 수 없었다. 코인 이름은 안 붙인다 — 청산 요청은 화면 심볼로 들어오므로
      //   언제나 지금 보고 있는 코인이다 (`api/client.js`)
      push.pushAlert("notice", `${side} 포지션 크기를 읽지 못해 분할 TP를 조정하지 못했습니다 — 분할 TP 카드에서 수량을 확인하세요`);
      splitTpOrders = [];   // 취소한 적이 없으므로 재등록·롤백 대상에서도 뺀다
    }
  }

  // 1) 전량 청산 시에만 TP/SL + SCALE_IN 취소 (해당 사이드만)
  if (!partial) try {
    const [regularRes, algoRes] = await Promise.allSettled([
      binance("GET", "/fapi/v1/openOrders",     { symbol }),
      binance("GET", "/fapi/v1/openAlgoOrders", { symbol }),
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
        .map(o => cancelOrder({ orderId: o.orderId, symbol })),
      ...algo
        .filter(o => TPSL_TYPES.includes(o.orderType) && o.positionSide === side)
        .map(o => cancelOrder({ algoId: o.algoId, isAlgo: true, symbol })),
      ...scaleInToCancel
        .map(o => cancelOrder({ orderId: o.orderId, symbol })),
    ]);
    scaleInToCancel.forEach(o => {
      store.delete(String(o.orderId));
      log("ORDER_CANCELED", { kindOf: "SCALE_IN", orderIds: [String(o.orderId)], count: 1,
        posSide: side, ctx: "close", orderType: o.type ?? null,
        price: parseFloat(o.price) || null, qty: parseFloat(o.origQty) || null });
    });
  } catch (e) {
    log("ORDER_CANCEL_FAILED", { level: "warn", kindOf: "TPSL_SCALE_IN", ctx: "closeAll", posSide: side, err: errOf(e) });
  }

  // 2) 시장가 청산
  try {
    const { data } = await binance("POST", "/fapi/v1/order", {
      symbol,
      side:         closeSide,
      positionSide: side,
      type:         "MARKET",
      quantity:     roundQty(closeQty, symbol),
    });

    // 3) 부분 청산 성공 → 분할 TP를 잔여 포지션 비율로 재등록
    //    ⚠ 수량 계산은 utils/splitTp.js가 전부 한다 — **여기서 다시 계산하지 말 것.**
    //      "마지막 항목만 잔여에서 역산"하던 옛 식이 미커버분을 그 항목에 몰아주는
    //      버그였다 (그쪽 주석에 실측값). 지금은 전부 같은 비율로 줄이고 반올림
    //      초과분만 깎는다
    if (partial && splitTpOrders.length > 0 && originalSize > 0) {
      const { newSize, items } = rescaleSplitTps(splitTpOrders, originalSize, closeQty, qStep, qMin);
      let failed = 0;
      for (const { order: o, qty, pct } of items) {
        try {
          const { data: newOrder } = await binance("POST", "/fapi/v1/order", {
            symbol, side: o.side, positionSide: side, type: "LIMIT",
            price: o.price, quantity: roundQty(qty, symbol),
            timeInForce: "GTC",
          });
          store.set(String(newOrder.orderId), {
            symbol,
            status: "SPLIT_TP",
            price:  parseFloat(o.price),
            qty,
            pct,
            side:   o.side,
            // 어느 쪽 포지션의 분할 TP인지 (2026-08-23). 지금 이 값을 읽는 경로는 없다 —
            // 판정은 utils/orderKind.js가 주문 방향으로 한다. 진단·복구용으로 남긴다
            positionSide: side,
          });
          log("SPLIT_TP_REPLACED", { posSide: side, price: o.price, qty });
        } catch (e) {
          failed++;
          log("SPLIT_TP_REPLACE_FAILED", { level: "warn", posSide: side, price: o.price, qty, err: errOf(e) });
        }
      }
      // ⚠ **몇 건 중 몇 건인지 적는다** (2026-09-04 사용자 요청). `일부 실패`만으로는
      //   카드를 열어보기 전에는 규모를 알 수 없었다. `재등록`은 서버 쪽 말이라 뺐다
      if (failed) push.pushAlert("notice",
        `${side} 분할 TP ${items.length}건 중 ${failed}건을 다시 걸지 못했습니다 — 분할 TP 카드에서 확인하세요`);
      // 잔여가 최소 수량 미만이면 items가 비어 있다 (사실상 전량 청산 — 재등록할 게 없다)
      // ⚠ 하한은 **심볼의 최소 수량**이다 (2026-09-02). 0.001 고정이면 DOGE(최소 1)에서
      //   잔여 0.5짜리를 "아직 남았다"로 읽어 있지도 않은 실패를 알린다
      // ⚠ **하나라도 빠지면 알린다** (2026-09-04 사용자 요청). 예전엔 `items.length === 0`,
      //   즉 **전부 빠졌을 때만** 알렸다. 분할 TP는 여러 건이라 5건 중 2건이 없어지는 쪽이
      //   흔한데 그때는 화면이 조용했다 — 사용자가 알아채려면 차트의 선 개수나 카드의
      //   건수를 청산 전과 비교해야 했고, 부분 청산 직후에는 어차피 모든 수량이 바뀌어
      //   그 비교가 어렵다. 문구에 **몇 건 중 몇 건**인지 넣는 이유도 같다
      if (newSize >= qMin && items.length < splitTpOrders.length) {
        const lost = splitTpOrders.length - items.length;
        push.pushAlert("notice",
          `${side} 분할 TP ${splitTpOrders.length}건 중 ${lost}건이 없어졌습니다 — 최소 수량 미만이라 다시 걸지 못했습니다`);
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
      const { items } = rescaleSplitTps(partialSlOrders, originalSize, closeQty, qStep, qMin);
      let failed = 0;
      for (const { order: o, qty } of items) {
        try {
          await binance("POST", "/fapi/v1/algoOrder", {
            algoType: "CONDITIONAL", symbol,
            side: closeSide, positionSide: side,
            type: "STOP_MARKET", triggerPrice: o.price,
            quantity: roundQty(qty, symbol), workingType: "CONTRACT_PRICE",
          });
          await cancelOrder({ orderId: o.id, algoId: o.id, isAlgo: o.isAlgo, symbol })
            .catch(e => { failed++;
              log("ORDER_CANCEL_FAILED", { level: "warn", orderId: o.id, kindOf: "PARTIAL_SL",
                ctx: "rescaleOld", err: errOf(e) }); });
          log("PARTIAL_SL_RESCALED", { posSide: side, price: o.price, fromQty: o.origQty, toQty: qty });
        } catch (e) {
          failed++;
          log("PARTIAL_SL_RESCALE_FAILED", { level: "warn", posSide: side, price: o.price, qty,
            kept: true, err: errOf(e) });
        }
      }
      const kept = new Set(items.map(x => x.order.id));
      const dropped = partialSlOrders.filter(o => !kept.has(o.id));
      if (dropped.length) {
        log("PARTIAL_SL_KEPT", { posSide: side, count: dropped.length });
        // ⚠ **화면에도 알린다** (2026-09-04 사용자 요청). 그전에는 이 로그 한 줄이
        //   전부라, 사용자는 분할 SL 카드를 직접 열어보기 전에는 알 수 없었다.
        //   빠진 건은 옛 수량 그대로 남아 **포지션 대비 비율이 올라간다** — 절반
        //   청산이면 30%를 덮던 것이 60%를 덮는다. 손절이 없어진 것이 아니라
        //   과해진 것이라 빨간 배너가 아니라 금색 토스트다
        // ⚠ **거의 전량 청산일 때는 알리지 않는다.** 잔여가 최소 수량 미만이면 items가
        //   통째로 비어 dropped에 전부 들어오는데, 그건 포지션이 사실상 끝난 것이고
        //   남은 주문은 `orderWatcher`의 `STALE_TRIGGER_CANCELED`가 60초 안에 치운다.
        //   위 분할 TP 알림의 `newSize >= qMin`과 같은 장치다
        if (originalSize - closeQty >= qMin) {
          push.pushAlert("notice",
            `${side} 분할 SL ${partialSlOrders.length}건 중 ${dropped.length}건을 줄이지 못했습니다 — 최소 수량 미만이라 청산 전 수량 그대로 남습니다`);
        }
      }
      if (failed) {
        // ⚠ 여기만 **빨간 배너**다 (위 세 줄은 notice). 분할 SL은 손절이라,
        //   수량이 어긋나면 포지션의 일부가 손절 없이 남는다 — notice로 내리지 말 것
        // ⚠ 몇 건인지와 **그래서 어떻게 되는지**를 적는다 (2026-09-04 사용자 요청).
        //   `재조정 일부 실패`는 서버 쪽 말이라 무슨 일이 벌어졌는지 안 보였다
        push.pushAlert("critical",
          `${side} 분할 SL ${items.length}건 중 ${failed}건을 바꾸지 못했습니다 — 손절 수량이 예정보다 많을 수 있습니다`);
      }
      push.pushUpdate(["tpsl"]);
    }

    log("POSITION_CLOSED", { posSide: side, partial: !!partial, qty: closeQty,
      orderId: String(data.orderId), status: data.status });
    // 이 청산이 얼마 벌었는지를 **주문번호에 붙여** 남긴다 (TRADE_SETTLED).
    // 체결이 잡힐 때까지 조금 기다린다 — 응답 직후에는 아직 비어 있다
    setTimeout(() => {
      require("../services/incomeLogger")
        .logTradesFor(data.orderId, { posSide: side, partial: !!partial })
        .catch(() => {});
    }, 2500);
    res.json({ success: true, orderId: String(data.orderId), status: data.status });
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    log("POSITION_CLOSE_FAILED", { level: "error", posSide: side, partial: !!partial,
      qty: parseFloat(quantity), err: errOf(err) });

    // 부분 청산 실패 시 사전 취소했던 분할 TP 롤백
    if (partial && splitTpOrders.length > 0) {
      log("SPLIT_TP_ROLLBACK", { level: "warn", posSide: side, orders: splitTpOrders.length });
      for (const o of splitTpOrders) {
        try {
          const { data: restored } = await binance("POST", "/fapi/v1/order", {
            symbol, side: o.side, positionSide: side, type: "LIMIT",
            price: o.price, quantity: o.origQty,
            timeInForce: "GTC",
          });
          store.set(String(restored.orderId), {
            symbol,
            status: "SPLIT_TP",
            price:  parseFloat(o.price),
            qty:    parseFloat(o.origQty),
            pct:    store.get(String(o.orderId))?.pct ?? null,
            side:   o.side,
            positionSide: side,   // 재등록과 같은 이유 (진단·복구용 메타)
          });
          log("SPLIT_TP_ROLLED_BACK", { posSide: side, price: o.price, qty: o.origQty });
        } catch (re) {
          log("SPLIT_TP_ROLLBACK_FAILED", { level: "error", posSide: side, price: o.price,
            qty: o.origQty, err: errOf(re) });
        }
      }
      push.pushUpdate(["tpsl"]);
    }

    res.status(err.status ?? 500).json({ error: msg });
  }

  } finally {
    closeInProgress.delete(side);
  }
});

module.exports = router;
