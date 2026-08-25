const express = require("express");
const { binance, roundPrice, cancelOrder, assertCancelKind } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const { sideToPosition, positionToClose } = require("../utils/side");
const { isLiveLimit, isCloseDir, isFullClose, orderQtyOf } = require("../utils/orderKind");
const { log, errOf } = require("../store/logStore");
const router  = express.Router();

// SPLIT_TP를 store에서 지우기 전 두는 유예 — 등록 직후 낡은 openOrders 스냅샷에
// 안 잡히는 창을 덮는다 (position.js의 GRACE_PERIOD와 같은 값·같은 이유)
const SPLIT_TP_GRACE_MS = 30_000;

router.get("/", async (req, res) => {
  try {
    const [regularRes, algoRes] = await Promise.allSettled([
      binance("GET", "/fapi/v1/openOrders",     { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" }),
    ]);
    const regular = regularRes.status === "fulfilled" ? regularRes.value.data : [];
    const algoRaw = algoRes.status  === "fulfilled" ? algoRes.value.data  : [];
    const algo    = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);

    // ⚠ **아직 체결되지 않은 진입 주문에 미리 걸어 둔 TP/SL은 감춘다**
    //   (2026-08-23 사용자 선택 B). 거래소엔 실제로 올라가 있지만, 그 가격은
    //   **플랜 박스가 이미 보여주고 있다** — 같이 그리면 같은 값이 두 번 뜬다.
    //   체결되면 `onFilled`가 `closePosition` 방식으로 갈아끼우고 store status도
    //   WATCHING을 벗으므로, 그때부터는 정상적으로 보인다
    const presetIds = new Set();
    for (const [, info] of store.entries()) {
      if (info.status !== "WATCHING" || !info.presetTpsl) continue;
      for (const k of ["tp", "sl"]) {
        const id = info.presetTpsl[k]?.orderId;
        if (id) presetIds.add(String(id));
      }
    }

    // ⚠ **지정가형(`STOP`/`TAKE_PROFIT`)도 같이 찾는다** (2026-08-23).
    //   우리가 거는 건 늘 `_MARKET`이지만, **바이낸스 웹·앱에서 주문에 붙여 건 TP/SL은
    //   지정가형일 수 있다.** 그것만 보면 화면에 TP/SL이 없는 것처럼 보이고,
    //   더 나쁘게는 reconcile이 "SL 없는 포지션"으로 오인해 경보를 띄운다
    const TYPES = {
      TAKE_PROFIT_MARKET: ["TAKE_PROFIT_MARKET", "TAKE_PROFIT"],
      STOP_MARKET:        ["STOP_MARKET",        "STOP"],
    };
    //
    // ⚠ **전량 청산(`closePosition:true`)인 것만 고른다** (2026-08-24).
    //   예전엔 종류만 맞으면 **먼저 나온 것**을 집었다. 그때는 후보가 하나뿐이라 맞았지만,
    //   부분 손절(수량 지정)이 생기면 **어느 게 잡힐지 바이낸스가 주는 순서에 달린다.**
    //   그러면 차트 손절선이 그때그때 다른 가격에 그려지고, 더 나쁘게는 그 선을 끌었을 때
    //   `saveTpsl`이 **부분 손절의 주문번호를 취소 대상으로 실어 보내** 조용히 지워버린다
    //   (그 자리에 전량 손절이 새로 걸려 손절이 두 개가 된다).
    //   → 부분 청산 주문은 아래 `partialOf`가 따로 담는다. 안 보이게 두지 않는다
    const findOrder = (type, positionSide) => {
      const types = TYPES[type] ?? [type];
      const r = regular.find(o => types.includes(o.type) && o.positionSide === positionSide
        && isFullClose(o) && !presetIds.has(String(o.orderId)));
      if (r) return { orderId: r.orderId, price: parseFloat(r.stopPrice), isAlgo: false };
      const closeSide = positionToClose(positionSide);
      // positionSide 필드 없는 algo 주문은 side(closeSide)로 폴백
      const a = algo.find(o => types.includes(o.orderType) && !presetIds.has(String(o.algoId)) &&
        isFullClose(o) &&
        (o.positionSide === positionSide || (!o.positionSide && o.side === closeSide)));
      if (a) return { orderId: a.algoId, price: parseFloat(a.triggerPrice), isAlgo: true };
      return null;
    };

    // 부분 청산 트리거 주문(수량 지정) — 예: "평단까지 내려오면 절반만 청산".
    // 사전 등록분(preset)은 제외한다 — 그건 아직 체결 안 된 진입 주문에 딸린 것이고,
    // 그 가격은 플랜 박스가 이미 보여준다 (위 presetIds 주석)
    const partialOf = (type, positionSide) => {
      const types = TYPES[type] ?? [type];
      const closeSide = positionToClose(positionSide);
      const out = [];
      for (const o of regular) {
        if (!types.includes(o.type) || o.positionSide !== positionSide) continue;
        if (isFullClose(o) || presetIds.has(String(o.orderId))) continue;
        out.push({ orderId: String(o.orderId), price: parseFloat(o.stopPrice),
          qty: orderQtyOf(o), isAlgo: false, positionSide });
      }
      for (const o of algo) {
        if (!types.includes(o.orderType)) continue;
        if (!(o.positionSide === positionSide || (!o.positionSide && o.side === closeSide))) continue;
        if (isFullClose(o) || presetIds.has(String(o.algoId))) continue;
        out.push({ orderId: String(o.algoId), price: parseFloat(o.triggerPrice),
          qty: orderQtyOf(o), isAlgo: true, positionSide });
      }
      return out.sort((a, b) => b.price - a.price);
    };

    // SPLIT_TP: store에 있는데 바이낸스에 없으면 이미 체결/취소됨 → store 정리
    // 단, openOrders 조회 실패 시엔 정리 스킵 — 빈 배열을 "없음"으로 오판하면
    // 살아있는 SPLIT_TP가 지워져 position.js에서 external 주문으로 오인됨
    if (regularRes.status === "fulfilled") {
      const openIds = new Set(regular.map(o => String(o.orderId)));
      const now = Date.now();
      for (const [orderId, info] of store.entries()) {
        if (info.status === "SPLIT_TP" && !openIds.has(String(orderId))) {
          // ⚠ **갓 등록한 항목은 건너뛴다** (2026-08-23, SPLIT_TP_GRACE_MS).
          //   openOrders 스냅샷은 이 요청이 **시작될 때** 찍힌다. POST /split과 겹치면
          //   방금 건 분할 TP가 목록에 없는 것처럼 보여 **살아있는 주문의 store 기록을
          //   지운다.** 그러면 position.js가 그걸 external 진입 주문으로 오인한다 —
          //   분할 TP 목록에서 사라지고 "외부 미체결 주문" 카드가 대신 떴다 (실제 신고).
          //   position.js의 고아 판정이 GRACE_PERIOD를 두는 것과 같은 이유다
          if (info.createdAt && now - info.createdAt < SPLIT_TP_GRACE_MS) continue;
          console.log(`[TPSL] SPLIT_TP ${orderId}이 바이낸스에 없음 → 제거`);
          store.delete(orderId);
        }
      }
    } else {
      console.warn("[TPSL] openOrders 조회 실패 → SPLIT_TP 정리 스킵:",
        regularRes.reason?.response?.data?.msg || regularRes.reason?.message);
    }

    // ⚠ **분할 TP도 store가 아니라 주문 방향으로 가른다** (2026-08-23, position.js와 같은 이유).
    //   청산 방향 LIMIT(SELL/LONG, BUY/SHORT)은 분할 TP 말고 다른 것일 수 없다.
    //   store 기록은 `pct`(등록 당시 비율)에만 쓴다 — 외부 주문은 그게 없어 null이다
    const splitTps = regular
      .filter(o => isLiveLimit(o) && isCloseDir(o))
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
      long:  { tp: findOrder("TAKE_PROFIT_MARKET", "LONG"),  sl: findOrder("STOP_MARKET", "LONG"),
               splitTps: longSplitTps,  partialSls: partialOf("STOP_MARKET", "LONG")  },
      short: { tp: findOrder("TAKE_PROFIT_MARKET", "SHORT"), sl: findOrder("STOP_MARKET", "SHORT"),
               splitTps: shortSplitTps, partialSls: partialOf("STOP_MARKET", "SHORT") },
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

  const cancelExisting = (isAlgo, id) =>
    cancelOrder({ orderId: id, algoId: id, isAlgo })
      .catch(e => console.warn(`기존 주문 취소 실패 (id=${id}):`, e.response?.data?.msg));

  // ⚠ **단일 TP와 분할 TP는 공존한다 — 서로 취소하지 않는다** (2026-08-23 사용자 확정,
  //   실계좌 검증). 2026-08-19~23에는 "나중에 건 쪽이 이긴다"는 배타 규칙이 있었고
  //   여기서 분할 TP를 전부 취소했다. **그 근거("포지션의 200%를 팔게 된다")가 틀렸다:**
  //     · 분할 TP  = LIMIT + `reduceOnly:true`   → 포지션보다 많이 못 판다
  //     · 단일 TP  = `closePosition:true`         → "그때 **남아있는** 전부"라는 뜻이다
  //   그래서 분할 TP가 먼저 체결되면 단일 TP는 잔여만 정리하고, 단일 TP가 먼저 터지면
  //   포지션이 0이 되며 바이낸스가 분할 TP를 자동 취소한다. **어느 순서든 합계는 100%다.**
  //   실측(2026-08-23): 분할 TP가 걸린 롱에 `TAKE_PROFIT_MARKET`+closePosition을 추가
  //   등록 → 바이낸스가 **정상 접수**, 셋(분할TP·TP·SL)이 나란히 공존.
  //   ⚠ 되돌리면 **"일부 익절 + 나머지 전량 익절"을 못 하게 된다** — 흔한 설정이고,
  //     분할 TP로 100%를 채우는 대안은 추가 진입 때 미커버가 생겨 더 나쁘다
  //     (`closePosition`은 늘 잔여 전부를 덮으므로 그 문제가 없다)
  //   ※ SL은 예나 지금이나 무관하다 — 분할 TP는 익절이라 손절과 겹치지 않는다
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

    log("TPSL_UPDATED", { posSide: side, tp: newOrders.tp?.price ?? null,
      sl: newOrders.sl?.price ?? null, noSl: !!noSl });
    res.json({ success: true, tp: newOrders.tp, sl: newOrders.sl, noSl });
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
    await assertCancelKind(orderId, "TPSL");   // 엉뚱한 주문 취소 방지 (2026-08-23 감사)
    await cancelOrder({ orderId, algoId: orderId, isAlgo });
    log("ORDER_CANCELED", { kindOf: "TPSL", orderIds: [String(orderId)], count: 1 });
    res.json({ success: true });
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    console.error("[DELETE /api/tpsl]", msg);
    res.status(500).json({ error: msg });
  }
});

// POST /api/tpsl/split — 분할 TP 추가 (LIMIT positionSide)
//
// ⚠ **기존 단일 TP를 취소하지 않는다** (2026-08-23 사용자 확정). 둘은 공존한다 —
//   이유와 실측은 위 PUT의 주석. `tpOrderId`/`tpIsAlgo`를 다시 받지 말 것
router.post("/split", async (req, res) => {
  const { side, price, qty, pct } = req.body;
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
    log("SPLIT_TP_PLACED", { posSide: side, qty: parseFloat(qty),
      price: parseFloat(price), orderId: String(data.orderId) });
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
    await assertCancelKind(orderId, "SPLIT_TP");   // 엉뚱한 주문 취소 방지
    await cancelOrder({ orderId });
    store.delete(String(orderId));
    log("ORDER_CANCELED", { kindOf: "SPLIT_TP", orderIds: [String(orderId)], count: 1 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

// ── 분할 SL (수량 지정 STOP_MARKET) — 2026-08-24 ─────────────────────────────
//
// "평단까지 내려오면 절반만 청산" 같은 예약. 분할 TP의 손절 쪽 짝이다.
//
// ⚠ **`closePosition`을 쓰지 않는다 — 수량을 직접 적는다.** 그게 전량 손절과 갈리는
//   유일한 표시이고, 조회·청소·취소 판정이 전부 그 값을 본다 (`utils/orderKind.js`).
//   헷지모드 청산 방향이라 바이낸스가 `reduceOnly`를 자동으로 붙여 포지션보다
//   많이는 못 판다 (2026-08-24 실측)
//
// ⚠ **store에 기록하지 않는다.** 주문 자체에 다 찍혀 있어서 거래소가 원본이면 충분하다
//   ("주문의 정체는 바이낸스가 정한다" 절). 그래서 **바이낸스 앱에서 직접 건 것도
//   똑같이 목록에 뜨고 취소된다**
//
// ⚠ 트리거는 `CONTRACT_PRICE` — 우리 TP/SL 전부와 같은 값이어야 한다.
//   마크 가격을 쓰면 차트 캔들이 선을 뚫어도 발동하지 않을 수 있다 (PUT 주석 참고)
router.post("/partial-sl", async (req, res) => {
  const { side, price, qty } = req.body;
  if (!side || !price || !qty) return res.status(400).json({ error: "side, price, qty 필요" });
  try {
    const { data } = await binance("POST", "/fapi/v1/algoOrder", {
      algoType: "CONDITIONAL", symbol: "BTCUSDT",
      side: positionToClose(side), positionSide: side,
      type: "STOP_MARKET", triggerPrice: roundPrice(price),
      quantity: parseFloat(qty).toFixed(3), workingType: "CONTRACT_PRICE",
    });
    log("PARTIAL_SL_PLACED", { posSide: side, qty: parseFloat(qty),
      price: parseFloat(price), orderId: String(data.algoId) });
    res.json({ success: true, orderId: String(data.algoId),
      price: parseFloat(roundPrice(price)), qty: parseFloat(qty) });
  } catch (err) {
    const code = err.response?.data?.code;
    const msg  = err.response?.data?.msg || err.message;
    // -2021 = 즉시 발동할 자리. 롱 손절은 현재가보다 **아래**여야 한다 —
    // 위에 걸고 싶다면 그건 익절이므로 분할 TP를 써야 한다
    res.status(500).json({ error: code === -2021
      ? "즉시 발동할 가격입니다 — ▲LONG은 현재가보다 아래, ▼SHORT는 위여야 합니다"
      : msg });
  }
});

// DELETE /api/tpsl/partial-sl — 분할 SL 하나 취소
router.delete("/partial-sl", async (req, res) => {
  const { orderId } = req.body ?? {};
  if (!orderId) return res.status(400).json({ error: "orderId 필요" });
  try {
    // ⚠ 전량 손절을 여기로 지우지 못하게 막는다 (그 반대도 `DELETE /`가 막는다)
    await assertCancelKind(orderId, "PARTIAL_SL");
    await cancelOrder({ orderId, algoId: orderId, isAlgo: true });
    log("ORDER_CANCELED", { kindOf: "PARTIAL_SL", orderIds: [String(orderId)], count: 1 });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
