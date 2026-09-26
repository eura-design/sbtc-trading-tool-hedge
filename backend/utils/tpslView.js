// TP/SL 분류 — 바이낸스가 준 미체결·알고 주문 목록을 화면이 읽는 모양으로 바꾼다
//
// ⚠ **두 라우트가 이 함수를 같이 쓴다** (2026-09-26에 여기로 모았다):
//   · `GET /api/tpsl`      — 지금 보고 있는 심볼 하나
//   · `GET /api/positions` — 계정 전체 (사이드바의 하늘색 포지션 카드)
//   복사해서 두 벌로 만들지 말 것. 두 벌이 갈리면 같은 포지션의 손절 가격이
//   **카드마다 다르게** 보인다 — 한쪽은 부분 손절을, 다른 쪽은 전량 손절을 집는 식이다.
//
// ⚠ 거래소를 부르지 않고 store도 직접 읽지 않는다 (순수 함수) —
//   `tests/tpslView.test.js`가 node로 바로 부른다. 재료는 부르는 쪽이 넘긴다:
//   `presetIds`는 `presetTpslIds()`가, 등록 당시 비율은 `pctOf`가 준다.
const { positionToClose } = require("./side");
const { isLiveLimit, isCloseDir, isFullClose, orderQtyOf } = require("./orderKind");

// ⚠ **지정가형(`STOP`/`TAKE_PROFIT`)도 같이 찾는다** (2026-08-23).
//   우리가 거는 건 늘 `_MARKET`이지만, **바이낸스 웹·앱에서 주문에 붙여 건 TP/SL은
//   지정가형일 수 있다.** 그것만 보면 화면에 TP/SL이 없는 것처럼 보이고,
//   더 나쁘게는 reconcile이 "SL 없는 포지션"으로 오인해 경보를 띄운다
const TYPES = {
  TAKE_PROFIT_MARKET: ["TAKE_PROFIT_MARKET", "TAKE_PROFIT"],
  STOP_MARKET:        ["STOP_MARKET",        "STOP"],
};

/**
 * 아직 체결되지 않은 진입 주문에 **미리 걸어 둔** TP/SL의 주문번호.
 *
 * ⚠ 그 주문들은 거래소엔 실제로 올라가 있지만 화면에서는 감춘다
 *   (2026-08-23 사용자 선택 B) — 그 가격은 **플랜 박스가 이미 보여주고 있어서**
 *   같이 그리면 같은 값이 두 번 뜬다. 체결되면 `onFilled`가 `closePosition` 방식으로
 *   갈아끼우고 store status도 WATCHING을 벗으므로, 그때부터는 정상적으로 보인다.
 *
 * @param entries `store/pendingOrders.js`의 `entries()` — [orderId, info] 쌍
 * @returns {Set<string>}
 */
function presetTpslIds(entries) {
  const out = new Set();
  for (const [, info] of entries) {
    if (info.status !== "WATCHING" || !info.presetTpsl) continue;
    for (const k of ["tp", "sl"]) {
      const id = info.presetTpsl[k]?.orderId;
      if (id) out.add(String(id));
    }
  }
  return out;
}

/**
 * 한 심볼의 TP/SL 한 벌.
 *
 * @param regular `/fapi/v1/openOrders` 응답 (조회 실패했으면 빈 배열)
 * @param algo    `/fapi/v1/openAlgoOrders` 응답의 주문 배열
 * @param presetIds `presetTpslIds()` 결과 — 감출 주문번호
 * @param pctOf   주문번호 → 등록 당시 비율. 모르면 null을 돌려주면 된다
 * @returns {{long: object, short: object}} 각각 `{ tp, sl, splitTps, partialSls }`
 */
function buildTpslView(regular, algo, { presetIds = new Set(), pctOf = () => null } = {}) {
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
    if (r) return { orderId: String(r.orderId), price: parseFloat(r.stopPrice), isAlgo: false };
    const closeSide = positionToClose(positionSide);
    // positionSide 필드 없는 algo 주문은 side(closeSide)로 폴백
    const a = algo.find(o => types.includes(o.orderType) && !presetIds.has(String(o.algoId)) &&
      isFullClose(o) &&
      (o.positionSide === positionSide || (!o.positionSide && o.side === closeSide)));
    if (a) return { orderId: String(a.algoId), price: parseFloat(a.triggerPrice), isAlgo: true };
    return null;
  };

  // 부분 청산 트리거 주문(수량 지정) — 예: "평단까지 내려오면 절반만 청산".
  // 사전 등록분(preset)은 제외한다 — 그건 아직 체결 안 된 진입 주문에 딸린 것이고,
  // 그 가격은 플랜 박스가 이미 보여준다 (위 presetTpslIds 주석)
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
      pct:     pctOf(String(o.orderId)) ?? null,
    }))
    .sort((a, b) => b.price - a.price);

  // SELL side = 롱 청산, BUY side = 숏 청산
  return {
    long:  { tp: findOrder("TAKE_PROFIT_MARKET", "LONG"),  sl: findOrder("STOP_MARKET", "LONG"),
             splitTps: splitTps.filter(o => o.side === "SELL"),
             partialSls: partialOf("STOP_MARKET", "LONG") },
    short: { tp: findOrder("TAKE_PROFIT_MARKET", "SHORT"), sl: findOrder("STOP_MARKET", "SHORT"),
             splitTps: splitTps.filter(o => o.side === "BUY"),
             partialSls: partialOf("STOP_MARKET", "SHORT") },
  };
}

module.exports = { presetTpslIds, buildTpslView, TYPES };
