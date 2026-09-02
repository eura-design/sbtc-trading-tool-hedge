// rescaleSplitTps — 부분 청산 후 분할 TP 재계산
//
// 여기가 틀리면 **사용자가 시키지 않은 물량이 TP 가격에서 나간다.** 눈으로는 안 보이고
// 체결된 뒤에야 안다 (utils/splitTp.js 머리 주석). 그래서 이 파일이 있다.
//
// ⚠ 2026-08-19 버그의 실측값이 아래 "미커버" 테스트에 그대로 들어 있다. 그 숫자를
//   고치지 말 것 — 고치면 회귀 테스트가 아니라 그냥 지금 동작을 베낀 것이 된다.

const test   = require("node:test");
const assert = require("node:assert/strict");
const { rescaleSplitTps, MIN_QTY } = require("../utils/splitTp");

// 가격 내림차순으로 넘기는 게 부르는 쪽 책임이라, 테스트도 그 순서로 만든다
const ord = (...qtys) => qtys.map(q => ({ origQty: String(q) }));
const qtysOf = r => r.items.map(x => x.qty);
const sum = a => Math.round(a.reduce((s, v) => s + v, 0) * 1000) / 1000;

test("잔여 비율만큼 모든 항목을 같은 규칙으로 줄인다", () => {
  // 1.0 포지션에 0.6/0.4 (100% 커버) → 절반 청산
  const r = rescaleSplitTps(ord(0.6, 0.4), 1.0, 0.5);
  assert.equal(r.newSize, 0.5);
  assert.deepEqual(qtysOf(r), [0.3, 0.2]);
  assert.deepEqual(r.items.map(x => x.pct), [60, 40]);   // 비율은 그대로
});

test("미커버가 있어도 마지막 항목이 부풀지 않는다 (2026-08-19 회귀)", () => {
  // 진입 1.0 + 분할 TP 0.6/0.4 → 추가 진입 +0.5 (포지션 1.5, 0.5는 TP 없이 끌고 간다)
  // 50% 청산: 기대 0.3/0.2 (합 0.5)
  // 옛 버그는 마지막만 `잔여 - 앞의 합`으로 계산해 0.3/0.45 (합 0.75)가 나왔다
  //   → TP 없이 두려던 0.25가 TP 가격에서 같이 나갔다
  const r = rescaleSplitTps(ord(0.6, 0.4), 1.5, 0.75);
  assert.equal(r.newSize, 0.75);
  assert.deepEqual(qtysOf(r), [0.3, 0.2]);
  assert.equal(sum(qtysOf(r)), 0.5);
  // 미커버는 정상 상태다 — 합이 잔여에 모자라는 것이 맞다
  assert.ok(sum(qtysOf(r)) < r.newSize, "미커버분까지 TP로 덮어버렸다");
});

test("반올림으로 합이 잔여를 넘으면 뒤에서부터 깎는다", () => {
  const r = rescaleSplitTps(ord(0.333, 0.333, 0.334), 1.0, 0.5);
  assert.equal(r.newSize, 0.5);
  assert.ok(sum(qtysOf(r)) <= r.newSize, `합 ${sum(qtysOf(r))}이 잔여 ${r.newSize}를 넘었다`);
  // 깎이는 건 **뒤쪽**이다 — 앞은 온전해야 한다
  const q = qtysOf(r);
  assert.ok(q[0] >= q[q.length - 1], "앞쪽이 먼저 깎였다");
});

test("모자라는 건 그대로 둔다 — 채워 넣지 않는다", () => {
  // 0.1만 TP로 덮인 1.0 포지션 → 절반 청산하면 0.05만 남아야 한다
  const r = rescaleSplitTps(ord(0.1), 1.0, 0.5);
  assert.deepEqual(qtysOf(r), [0.05]);
  assert.equal(r.newSize, 0.5);
});

test("전량 청산이면 등록할 것이 없다", () => {
  const r = rescaleSplitTps(ord(0.6, 0.4), 1.0, 1.0);
  assert.equal(r.newSize, 0);
  assert.deepEqual(r.items, []);
});

test("잔여가 최소 수량 미만이면 등록할 것이 없다", () => {
  const r = rescaleSplitTps(ord(0.6, 0.4), 1.0, 0.9995);
  assert.ok(r.newSize < MIN_QTY);
  assert.deepEqual(r.items, []);
});

test("줄인 결과가 최소 수량 미만인 조각은 빠진다", () => {
  // 0.001짜리를 90% 청산하면 0.0001 → 거래소가 거절할 주문이라 보내면 안 된다
  const r = rescaleSplitTps(ord(0.5, 0.001), 1.0, 0.9);
  assert.equal(r.newSize, 0.1);
  assert.deepEqual(qtysOf(r), [0.05]);
});

test("들어온 값이 비었거나 이상하면 빈 목록", () => {
  assert.deepEqual(rescaleSplitTps([], 1.0, 0.5).items, []);
  assert.deepEqual(rescaleSplitTps(null, 1.0, 0.5).items, []);
  assert.deepEqual(rescaleSplitTps(ord(0.5), 0, 0).items, []);
});

test("합은 어떤 조합에서도 잔여를 넘지 않는다", () => {
  // 넘치면 시키지 않은 물량이 주문으로 나간다 — 이 파일의 존재 이유다
  for (let size = 0.01; size <= 3; size += 0.01) {
    for (const pct of [0.1, 0.25, 0.333, 0.5, 0.667, 0.9, 0.99]) {
      const closeQty = Math.round(size * pct * 1000) / 1000;
      const r = rescaleSplitTps(ord(size * 0.5, size * 0.3, size * 0.2), size, closeQty);
      assert.ok(sum(qtysOf(r)) <= r.newSize + 1e-9,
        `size=${size} close=${closeQty} → 합 ${sum(qtysOf(r))} > 잔여 ${r.newSize}`);
    }
  }
});

// ── 심볼마다 다른 수량 단위 (2026-09-02 전수조사) ──────────────────────────
// DOGE는 LOT_SIZE가 **1**이다. 0.001로 계산하면 0.5짜리 조각이 최소 수량 필터를
// 통과한 뒤 routes/close.js의 roundQty에서 0으로 내려가 **수량 0인 주문**이 나간다.

test("수량 단위가 1인 심볼에서 조각이 정수로 떨어진다", () => {
  // 포지션 300(=100+200)을 절반 청산 → 기대 50/100
  const r = rescaleSplitTps(ord(200, 100), 300, 150, 1, 1);
  assert.equal(r.newSize, 150);
  assert.deepEqual(qtysOf(r), [100, 50]);
  for (const q of qtysOf(r)) assert.equal(q % 1, 0, `소수가 남았다: ${q}`);
});

test("단위가 1이면 1 미만 조각은 걸러진다 (수량 0 주문 방지)", () => {
  // 0.5로 줄어드는 조각은 거래소에 못 낸다 — 여기서 빠져야 한다
  const r = rescaleSplitTps(ord(100, 1), 200, 100, 1, 1);
  assert.equal(r.newSize, 100);
  assert.ok(!qtysOf(r).some(q => q < 1), `1 미만이 남았다: ${qtysOf(r)}`);
});

test("합은 어떤 단위에서도 잔여를 넘지 않는다", () => {
  for (const [step, size] of [[1, 300], [0.01, 3], [0.001, 1.5], [10, 5000]]) {
    for (const pct of [0.25, 0.333, 0.5, 0.9]) {
      const closeQty = size * pct;
      const r = rescaleSplitTps(ord(size * 0.5, size * 0.3, size * 0.2), size, closeQty, step, step);
      const total = qtysOf(r).reduce((s, v) => s + v, 0);
      assert.ok(total <= r.newSize + 1e-9,
        `step=${step} size=${size} → 합 ${total} > 잔여 ${r.newSize}`);
      for (const q of qtysOf(r)) {
        const units = q / step;
        assert.ok(Math.abs(units - Math.round(units)) < 1e-6, `${q}는 ${step}의 배수가 아니다`);
      }
    }
  }
});

test("안 넘기면 예전 BTCUSDT 동작 그대로다", () => {
  const a = rescaleSplitTps(ord(0.6, 0.4), 1.5, 0.75);
  const b = rescaleSplitTps(ord(0.6, 0.4), 1.5, 0.75, 0.001, 0.001);
  assert.deepEqual(qtysOf(a), qtysOf(b));
  assert.deepEqual(qtysOf(a), [0.3, 0.2]);
});
