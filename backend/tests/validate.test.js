// 주문 입력 검증
//
// ⚠ 2026-09-02: 상한이 **수량 100개**여서 DOGE 주문이 통째로 막혔다.
//   $100어치가 500개라 정상 주문이 400으로 거절됐다.
//   수량 단위가 1인 심볼이 526개 중 392개(75%)다 — 예외가 아니라 다수다.

const test   = require("node:test");
const assert = require("node:assert/strict");
const { validateOrder } = require("../middleware/validate");

function run(body) {
  let out = null;
  const req = { body };
  const res = { status(c) { this.code = c; return this; }, json(o) { out = { code: this.code, ...o }; } };
  validateOrder(req, res, () => { out = { ok: true }; });
  return out;
}

const LONG = { side: "BUY", orderType: "LIMIT" };

test("DOGE 정상 주문이 통과한다 (회귀)", () => {
  // $100어치 = 500개. 옛 상한(수량 100)이면 거절됐다
  assert.deepEqual(run({ ...LONG, entry: 0.2, tp: 0.25, sl: 0.18, quantity: 500 }), { ok: true });
  // $5 최소 주문 = 25개
  assert.deepEqual(run({ ...LONG, entry: 0.2, tp: 0.25, sl: 0.18, quantity: 25 }), { ok: true });
  // 수만 개도 금액이 작으면 통과한다
  assert.deepEqual(run({ ...LONG, entry: 0.2, tp: 0.25, sl: 0.18, quantity: 50_000 }), { ok: true });
});

test("BTC 상한은 바꾸기 전과 같은 크기다", () => {
  // 100 BTC × $72,000 = $7.2M 이 상한
  assert.deepEqual(run({ ...LONG, entry: 72000, tp: 75000, sl: 70000, quantity: 99 }), { ok: true });
  const over = run({ ...LONG, entry: 72000, tp: 75000, sl: 70000, quantity: 101 });
  assert.equal(over.code, 400);
  assert.match(over.error, /금액 상한/);
});

test("오타로 큰 값이 들어가면 여전히 막는다", () => {
  // DOGE에서도 금액이 크면 막힌다 — 그게 이 검증의 목적이다
  const over = run({ ...LONG, entry: 0.2, tp: 0.25, sl: 0.18, quantity: 100_000_000 });
  assert.equal(over.code, 400);
  assert.match(over.error, /금액 상한/);
});

test("기본 검증은 그대로다", () => {
  assert.equal(run({ ...LONG, entry: 0, tp: 1, sl: 1, quantity: 1 }).code, 400);
  assert.equal(run({ ...LONG, entry: 1, tp: 1, sl: 1, quantity: 0 }).code, 400);
  assert.equal(run({ ...LONG, entry: 1, tp: 1, sl: 1, quantity: -1 }).code, 400);
});

test("가격 방향 검증도 그대로다 (롱은 tp > entry > sl)", () => {
  assert.equal(run({ ...LONG, entry: 0.2, tp: 0.18, sl: 0.25, quantity: 100 }).code, 400);
});
