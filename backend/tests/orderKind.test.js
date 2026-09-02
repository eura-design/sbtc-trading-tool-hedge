// 미체결 주문의 정체 판정 · 트리거 주문이 포지션을 덮는지
//
// limitKind가 틀리면 화면에서 주문 종류가 뒤바뀐다 — 추가 진입이 분할 TP로 보이면
// 취소 버튼이 엉뚱한 것을 지운다. coversPosition이 틀리면 손절 없는 포지션을
// 놓치거나(위험) 멀쩡한 포지션에 가짜 경보가 뜬다.
//
// ⚠ **헷지모드 전제다** — 판정 근거가 side + positionSide 조합이다 (utils/orderKind.js).

const test   = require("node:test");
const assert = require("node:assert/strict");
const { limitKind, coversPosition, isLiveLimit, isCloseDir, isEntryDir,
        isFullClose, orderTypeOf, orderQtyOf, triggerPriceOf,
        isTpslOrder, isStopOrder, isTpOrder } = require("../utils/orderKind");

// ── limitKind — CLAUDE.md "주문의 정체는 바이낸스가 정한다"의 표 그대로 ──────
test("청산 방향 지정가는 언제나 분할 TP", () => {
  // 포지션이 있든 없든, store에 뭐가 적혀 있든 이것 말고 다른 것일 수 없다
  assert.equal(limitKind({ side: "SELL", positionSide: "LONG"  }, { LONG: true }),  "SPLIT_TP");
  assert.equal(limitKind({ side: "BUY",  positionSide: "SHORT" }, { SHORT: true }), "SPLIT_TP");
  assert.equal(limitKind({ side: "SELL", positionSide: "LONG"  }, {}),              "SPLIT_TP");
  assert.equal(limitKind({ side: "SELL", positionSide: "LONG"  }, {}, { status: "SCALE_IN" }), "SPLIT_TP");
});

test("진입 방향 + 그 사이드에 포지션 있음 → 추가 진입", () => {
  assert.equal(limitKind({ side: "BUY",  positionSide: "LONG"  }, { LONG: true }),  "SCALE_IN");
  assert.equal(limitKind({ side: "SELL", positionSide: "SHORT" }, { SHORT: true }), "SCALE_IN");
});

test("진입 방향 + 포지션 없음 → 진입 대기", () => {
  assert.equal(limitKind({ side: "BUY",  positionSide: "LONG"  }, { LONG: false, SHORT: true }), "ENTRY");
  assert.equal(limitKind({ side: "SELL", positionSide: "SHORT" }, {}), "ENTRY");
});

test("포지션이 닫힌 뒤에는 store가 남은 추가 진입을 알려준다", () => {
  // 거래소 정보만으로는 "남은 추가 진입"과 "진입 대기"가 똑같이 생겼다.
  // 이게 없으면 손절 직후 최대 60초 동안 그 사이드에 플랜 박스를 못 그린다
  const o = { side: "BUY", positionSide: "LONG" };
  assert.equal(limitKind(o, {}, { status: "SCALE_IN" }), "SCALE_IN");
  assert.equal(limitKind(o, {}, { status: "WATCHING" }), "ENTRY");
  assert.equal(limitKind(o, {}, undefined),              "ENTRY");
});

test("방향 판정은 서로 반대다", () => {
  for (const side of ["BUY", "SELL"]) {
    for (const positionSide of ["LONG", "SHORT"]) {
      const o = { side, positionSide };
      assert.notEqual(isCloseDir(o), isEntryDir(o), `${side}/${positionSide}`);
    }
  }
});

test("살아 있는 지정가만 미체결로 본다", () => {
  assert.equal(isLiveLimit({ type: "LIMIT",       status: "NEW" }),               true);
  assert.equal(isLiveLimit({ type: "LIMIT",       status: "PARTIALLY_FILLED" }),  true);
  assert.equal(isLiveLimit({ type: "LIMIT",       status: "FILLED" }),            false);
  assert.equal(isLiveLimit({ type: "LIMIT",       status: "CANCELED" }),          false);
  assert.equal(isLiveLimit({ type: "STOP_MARKET", status: "NEW" }),               false);
});

// ── coversPosition — true / false / null 세 가지 상태 ───────────────────────
test("closePosition 주문은 수량과 무관하게 덮는다", () => {
  assert.equal(coversPosition([{ closePosition: true }], 1.0), true);
  assert.equal(coversPosition([{ closePosition: true }], null), true);
  // 응답 경로에 따라 문자열로도 온다
  assert.equal(coversPosition([{ closePosition: "true" }], 1.0), true);
  assert.equal(isFullClose({ closePosition: "true" }), true);
  assert.equal(isFullClose({ closePosition: false }),  false);
});

test("절반짜리 손절 두 개면 덮은 것이다", () => {
  const half = [{ origQty: "0.5" }, { origQty: "0.5" }];
  assert.equal(coversPosition(half, 1.0), true);
  assert.equal(coversPosition([{ origQty: "0.5" }], 1.0), false);
});

test("포지션 수량을 모르면 null — false로 뭉개지 말 것", () => {
  // "손절이 없다"와 "포지션 수량을 못 물어봤다"는 다르다.
  // 후자를 경보로 올리면 통신이 튈 때마다 가짜 경보가 뜬다
  assert.equal(coversPosition([{ origQty: "0.5" }], null),      null);
  assert.equal(coversPosition([{ origQty: "0.5" }], undefined), null);
  // 아무것도 없으면 수량을 몰라도 "안 덮인다"가 확실하다
  assert.equal(coversPosition([], null), false);
  assert.equal(coversPosition([{ origQty: "0" }], null), false);
});

test("알고 주문은 필드 이름이 다르다 — 양쪽 다 읽는다", () => {
  // 한쪽만 읽으면 바이낸스 웹이 지정가형(STOP)으로 걸어 둔 것을 놓친다
  assert.equal(orderTypeOf({ type: "STOP_MARKET" }),      "STOP_MARKET");
  assert.equal(orderTypeOf({ orderType: "STOP_MARKET" }), "STOP_MARKET");
  assert.equal(orderQtyOf({ origQty: "0.5" }),  0.5);
  assert.equal(orderQtyOf({ quantity: "0.5" }), 0.5);
  assert.equal(orderQtyOf({}), 0);
  assert.equal(triggerPriceOf({ stopPrice: "100" }),    100);
  assert.equal(triggerPriceOf({ triggerPrice: "100" }), 100);
  // 알고 주문(quantity)만으로도 덮임 판정이 된다
  assert.equal(coversPosition([{ quantity: "1.0" }], 1.0), true);
});

test("지정가형 TP/SL도 TP/SL이다", () => {
  // 우리는 늘 _MARKET으로 걸지만 바이낸스 웹·앱이 붙인 것은 지정가형일 수 있다
  for (const t of ["TAKE_PROFIT_MARKET", "STOP_MARKET", "TAKE_PROFIT", "STOP"]) {
    assert.equal(isTpslOrder({ type: t }), true, t);
  }
  assert.equal(isTpslOrder({ type: "LIMIT" }), false);
  assert.equal(isStopOrder({ type: "STOP" }),               true);
  assert.equal(isStopOrder({ type: "TAKE_PROFIT" }),        false);
  assert.equal(isTpOrder({ type: "TAKE_PROFIT_MARKET" }),   true);
  assert.equal(isTpOrder({ type: "STOP_MARKET" }),          false);
});
