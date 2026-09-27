// 포지션 행 판정 — 여덟 곳에 흩어져 있던 것을 모았다 (utils/position.js)
// ⚠ 예전엔 `> 0`·`< 0`과 `!== 0`이 섞여 있었다. 헷지 모드에서는 같은 답이지만,
//   부호에 기대지 않는 `!== 0` 하나로 정했다

const test   = require("node:test");
const assert = require("node:assert/strict");
const { amtOf, isOpen, openRow, hasOpen } = require("../utils/position");

const rows = [
  { positionSide: "LONG",  positionAmt: "0.5" },
  { positionSide: "SHORT", positionAmt: "0" },
];

test("열린 방향만 찾는다 — 0은 없는 것이다", () => {
  assert.equal(openRow(rows, "LONG").positionAmt, "0.5");
  assert.equal(openRow(rows, "SHORT"), null);
  assert.equal(hasOpen(rows, "LONG"), true);
  assert.equal(hasOpen(rows, "SHORT"), false);
});

test("숏은 음수로 온다 — 부호와 무관하게 '있다'", () => {
  assert.equal(hasOpen([{ positionSide: "SHORT", positionAmt: "-0.2" }], "SHORT"), true);
});

test("이상한 입력에도 터지지 않는다", () => {
  for (const bad of [undefined, null, {}, "", [null]]) assert.equal(hasOpen(bad, "LONG"), false);
  assert.equal(amtOf({ positionAmt: "abc" }), 0);
  assert.equal(isOpen(null), false);
});
