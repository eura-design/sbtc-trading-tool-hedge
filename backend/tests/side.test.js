// 헷지모드 side 매핑
//
// 네 함수가 전부 삼항 연산자 한 줄이라 "테스트할 게 있나" 싶지만, **뒤집히면
// 롱을 닫으려던 주문이 숏을 연다.** 그리고 진입 방향과 청산 방향이 서로 반대라
// 이름만 보고 잘못 고르기 쉽다 (positionToSide vs positionToClose).

const test   = require("node:test");
const assert = require("node:assert/strict");
const { sideToPosition, positionToSide,
        closeToPosition, positionToClose } = require("../utils/side");

test("진입: BUY는 롱, SELL은 숏", () => {
  assert.equal(sideToPosition("BUY"),  "LONG");
  assert.equal(sideToPosition("SELL"), "SHORT");
  assert.equal(positionToSide("LONG"),  "BUY");
  assert.equal(positionToSide("SHORT"), "SELL");
});

test("청산: SELL이 롱 종료, BUY가 숏 종료 — 진입과 반대다", () => {
  assert.equal(closeToPosition("SELL"), "LONG");
  assert.equal(closeToPosition("BUY"),  "SHORT");
  assert.equal(positionToClose("LONG"),  "SELL");
  assert.equal(positionToClose("SHORT"), "BUY");
});

test("왕복하면 제자리로 돌아온다", () => {
  for (const p of ["LONG", "SHORT"]) {
    assert.equal(sideToPosition(positionToSide(p)),   p, `진입 왕복 ${p}`);
    assert.equal(closeToPosition(positionToClose(p)), p, `청산 왕복 ${p}`);
  }
});

test("같은 포지션에 대해 진입 side와 청산 side는 언제나 반대다", () => {
  for (const p of ["LONG", "SHORT"]) {
    assert.notEqual(positionToSide(p), positionToClose(p), p);
  }
});
