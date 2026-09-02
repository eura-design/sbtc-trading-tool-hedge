// 포지션이 사라진 곳 찾기
//
// ⚠ 2026-09-02 실주문 테스트에서 나온 버그를 고정한다: ETH 0.009를 청산했는데
//   POSITION_GONE이 안 찍혔다. 원인은 **이번 관측을 돌았기 때문**이다 —
//   포지션이 닫히면 그 심볼은 감시 목록에서 빠져 이번 관측에 아예 없다.

const test   = require("node:test");
const assert = require("node:assert/strict");
const { goneSides } = require("../utils/positionDiff");

const m = (obj) => new Map(Object.entries(obj));
const L = { long: true,  short: false };
const S = { long: false, short: true  };
const B = { long: true,  short: true  };
const N = { long: false, short: false };

test("심볼이 목록에서 통째로 빠져도 잡는다 (ETH 청산 회귀)", () => {
  // 포지션이 닫히면 watchedSymbols에서 빠져 **이번 관측에 ETHUSDT가 없다**
  const last = m({ BTCUSDT: L, ETHUSDT: L });
  const now  = m({ BTCUSDT: L });
  assert.deepEqual(goneSides(last, now), [{ symbol: "ETHUSDT", gone: "LONG" }]);
});

test("한 심볼 안에서 한쪽만 사라진 경우", () => {
  assert.deepEqual(goneSides(m({ BTCUSDT: B }), m({ BTCUSDT: L })),
    [{ symbol: "BTCUSDT", gone: "SHORT" }]);
  assert.deepEqual(goneSides(m({ BTCUSDT: B }), m({ BTCUSDT: S })),
    [{ symbol: "BTCUSDT", gone: "LONG" }]);
  assert.deepEqual(goneSides(m({ BTCUSDT: B }), m({ BTCUSDT: N })),
    [{ symbol: "BTCUSDT", gone: "LONG+SHORT" }]);
});

test("여러 심볼이 동시에 닫혀도 전부 잡는다", () => {
  const r = goneSides(m({ BTCUSDT: L, ETHUSDT: S, SOLUSDT: L }), m({ SOLUSDT: L }));
  assert.deepEqual(r, [{ symbol: "BTCUSDT", gone: "LONG" },
                       { symbol: "ETHUSDT", gone: "SHORT" }]);
});

test("새로 생긴 포지션은 사라진 것이 아니다", () => {
  assert.deepEqual(goneSides(m({ BTCUSDT: L }), m({ BTCUSDT: L, ETHUSDT: L })), []);
  assert.deepEqual(goneSides(m({}), m({ ETHUSDT: L })), []);
});

test("그대로면 아무것도 없다", () => {
  assert.deepEqual(goneSides(m({ BTCUSDT: B, ETHUSDT: L }), m({ BTCUSDT: B, ETHUSDT: L })), []);
});

test("첫 관측은 기준선만 — 사라진 것이 있을 수 없다", () => {
  assert.deepEqual(goneSides(null, m({ BTCUSDT: L })), []);
  assert.deepEqual(goneSides(undefined, m({ BTCUSDT: L })), []);
});

test("이번 관측이 통째로 비어도 (조회가 다 실패한 회차)", () => {
  // ⚠ 실제로는 watchAccount가 그 회차를 통째로 건너뛰므로 여기 오지 않는다.
  //   그래도 함수 자체는 "직전에 있던 것이 전부 사라졌다"로 답해야 한다
  assert.deepEqual(goneSides(m({ BTCUSDT: L }), m({})),
    [{ symbol: "BTCUSDT", gone: "LONG" }]);
});
