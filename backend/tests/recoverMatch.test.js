// 재시작 복구 — 무방비 포지션에 어느 기록의 TP/SL을 붙일지
//
// ⚠ **잘못 고르면 엉뚱한 가격에 손절이 걸린다.** 예전 포지션의 기록을 집으면
//   지금 포지션과 상관없는 자리에 손절이 붙고, 그건 사용자가 시키지 않은 주문이다.
//   못 고르면 배너로 사람에게 넘기면 되지만, 잘못 고르면 **조용히** 틀린다.
//   그래서 조건을 느슨하게 하는 방향으로는 절대 고치지 말 것.

const test   = require("node:test");
const assert = require("node:assert/strict");
const { pickRecoverable, PRICE_TOLERANCE } = require("../utils/recoverMatch");

// store 기록 한 건 (진입 side: LONG은 BUY)
const rec = (id, over = {}) => [id, {
  side: "BUY", tp: 110, sl: 90, fillPrice: 100, filledAt: 1_000, ...over,
}];

const pick = (entries, side = "LONG", entry = 100, used = new Set()) =>
  pickRecoverable(entries, side, entry, used);

test("조건을 다 만족하면 고른다", () => {
  const r = pick([rec("a")]);
  assert.ok(r, "못 골랐다");
  assert.equal(r[0], "a");
  assert.equal(r[1].sl, 90);
});

test("이미 쓴 기록은 다시 안 쓴다 — 한 기록으로 두 포지션을 복구할 수 없다", () => {
  assert.equal(pick([rec("a")], "LONG", 100, new Set(["a"])), null);
  // 배열로 넘겨도 된다
  assert.equal(pick([rec("a")], "LONG", 100, ["a"]), null);
});

test("tp·sl이 **둘 다** 있어야 한다 — 하나만 있으면 나머지를 지어내게 된다", () => {
  assert.equal(pick([rec("a", { tp: null })]), null);
  assert.equal(pick([rec("a", { sl: null })]), null);
  assert.equal(pick([rec("a", { tp: undefined, sl: undefined })]), null);
});

test("사이드가 같아야 한다", () => {
  assert.equal(pick([rec("a", { side: "SELL" })], "LONG"), null, "숏 기록을 롱에 붙였다");
  assert.ok(pick([rec("a", { side: "SELL" })], "SHORT"), "숏 기록을 숏에 못 붙였다");
});

test("체결가가 없으면 **거부한다** (낡은 기록)", () => {
  // ⚠ "언제 것인지 모르는 TP/SL"을 지금 포지션에 붙이는 것이 가장 위험하다
  assert.equal(pick([rec("a", { fillPrice: null })]), null);
  assert.equal(pick([rec("a", { fillPrice: 0 })]), null);
  assert.equal(pick([rec("a", { fillPrice: undefined })]), null);
});

test("진입가의 ±2% 밖이면 안 고른다", () => {
  assert.ok(pick([rec("a", { fillPrice: 102 })]), "+2%는 통과해야 한다");
  assert.ok(pick([rec("a", { fillPrice: 98 })]),  "-2%는 통과해야 한다");
  assert.equal(pick([rec("a", { fillPrice: 102.1 })]), null, "+2.1%가 통과했다");
  assert.equal(pick([rec("a", { fillPrice: 97.9 })]),  null, "-2.1%가 통과했다");
  assert.equal(PRICE_TOLERANCE, 0.02);
});

test("여럿이면 **가장 최근**을 고른다", () => {
  const r = pick([
    rec("old", { filledAt: 1_000 }),
    rec("new", { filledAt: 5_000 }),
    rec("mid", { filledAt: 3_000 }),
  ]);
  assert.equal(r[0], "new");
});

test("filledAt이 없으면 createdAt으로 잰다", () => {
  const r = pick([
    rec("a", { filledAt: undefined, createdAt: 9_000 }),
    rec("b", { filledAt: 2_000 }),
  ]);
  assert.equal(r[0], "a");
});

test("시각이 아예 없어도 터지지 않는다", () => {
  const r = pick([rec("a", { filledAt: undefined, createdAt: undefined })]);
  assert.ok(r, "시각이 없다고 못 고르면 안 된다");
});

test("포지션 진입가가 없으면 아무것도 안 고른다", () => {
  // 근접도를 잴 기준이 없다 — 이때 고르면 그냥 아무거나 집는 것이다
  assert.equal(pickRecoverable([rec("a")], "LONG", 0), null);
  assert.equal(pickRecoverable([rec("a")], "LONG", undefined), null);
  assert.equal(pickRecoverable([rec("a")], "LONG", NaN), null);
});

test("빈 입력", () => {
  assert.equal(pick([]), null);
  assert.equal(pick(null), null);
  assert.equal(pick(undefined), null);
});

test("실제 상황 — 예전 포지션 기록이 섞여 있어도 지금 것만 고른다", () => {
  // 서버가 꺼져 있던 사이에 여러 번 매매했고, 지금 포지션은 진입가 100이다
  const r = pick([
    rec("어제-롱",   { fillPrice: 72_000, filledAt: 1_000 }),     // 가격이 딴판
    rec("아까-숏",   { side: "SELL", fillPrice: 100.5, filledAt: 8_000 }), // 사이드가 다르다
    rec("지금-롱",   { fillPrice: 100.5, filledAt: 7_000 }),      // ← 이것
    rec("기록없음",  { fillPrice: null,  filledAt: 9_000 }),      // 체결가가 없다
  ], "LONG", 100);
  assert.equal(r[0], "지금-롱");
});
