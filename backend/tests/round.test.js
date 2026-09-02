// 호가·수량 단위 맞추기
//
// 여기서 나온 문자열이 그대로 거래소로 나간다. 실제 심볼의 실제 필터값으로 검산한다.

const test   = require("node:test");
const assert = require("node:assert/strict");
const { decimalsOf, roundToTick, floorToStep } = require("../utils/round");

// 바이낸스 exchangeInfo가 실제로 내려주는 형태 (0을 채워 보낸다)
const BTC  = { tick: "0.10",       step: "0.001" };
const ETH  = { tick: "0.01",       step: "0.001" };
const DOGE = { tick: "0.0000100",  step: "1" };

test("자릿수는 뒤의 0을 떼고 센다", () => {
  // "0.10"을 2자리로 읽으면 pricePrecision이 1인 심볼에서 거절당한다
  assert.equal(decimalsOf("0.10"),        1);
  assert.equal(decimalsOf("0.00100000"),  3);
  assert.equal(decimalsOf("0.0000100"),   5);
  assert.equal(decimalsOf("1"),           0);
  assert.equal(decimalsOf("10"),          0);
  assert.equal(decimalsOf("0.5"),         1);
  assert.equal(decimalsOf(0.001),         3);   // 숫자로 와도 된다
  assert.equal(decimalsOf("1e-5"),        5);   // 지수 표기 방어
});

test("가격은 호가 단위의 배수로 반올림된다", () => {
  assert.equal(roundToTick(50000.04, BTC.tick),  "50000.0");
  assert.equal(roundToTick(50000.06, BTC.tick),  "50000.1");
  assert.equal(roundToTick(50000,    BTC.tick),  "50000.0");
  assert.equal(roundToTick(3456.789, ETH.tick),  "3456.79");
  assert.equal(roundToTick(0.123456, DOGE.tick), "0.12346");
});

test("부동소수 오차가 문자열로 새어 나가지 않는다", () => {
  // 0.1 * 3 = 0.30000000000000004 — 이대로 보내면 거절된다
  for (const v of [0.3, 1.1, 2.675, 50000.1, 0.07]) {
    for (const tick of [BTC.tick, ETH.tick, DOGE.tick, "0.5", "2"]) {
      const s = roundToTick(v, tick);
      assert.ok(!/\d{6,}$/.test(s), `${v} @ ${tick} → ${s} (오차가 샜다)`);
      assert.equal(s, Number(s).toFixed(decimalsOf(tick)), `${v} @ ${tick} → ${s}`);
    }
  }
});

test("결과는 언제나 호가 단위의 배수다", () => {
  for (const tick of ["0.10", "0.01", "0.0000100", "0.5", "2", "1"]) {
    const t = Number(tick);
    for (let v = 0.01; v < 200; v += 0.37) {
      const out = Number(roundToTick(v, tick));
      const units = out / t;
      assert.ok(Math.abs(units - Math.round(units)) < 1e-6,
        `${v} @ tick ${tick} → ${out} 은 배수가 아니다`);
    }
  }
});

test("수량은 내림이다 — 올리면 없는 물량을 주문한다", () => {
  assert.equal(floorToStep(0.0019, BTC.step), "0.001");
  assert.equal(floorToStep(0.0011, BTC.step), "0.001");
  assert.equal(floorToStep(0.999,  BTC.step), "0.999");
  // step 1짜리 심볼 — 0.001을 보내면 거절된다
  assert.equal(floorToStep(123.9, DOGE.step), "123");
  assert.equal(floorToStep(0.9,   DOGE.step), "0");
});

test("나눗셈 오차 때문에 한 칸이 사라지지 않는다", () => {
  // 0.003 / 0.001 이 2.9999999999999996으로 나오는 일이 있다 → 그대로 내리면 0.002
  for (let n = 1; n <= 500; n++) {
    const q = Math.round(n * 1000) / 1000000 * 1000;   // 0.001 단위 값을 오차 있게 만든다
    const expected = (Math.round(q * 1000) / 1000).toFixed(3);
    assert.equal(floorToStep(q, BTC.step), expected, `n=${n} q=${q}`);
  }
});

test("결과는 언제나 최소 단위의 배수이고 원래 값을 넘지 않는다", () => {
  for (const step of ["0.001", "1", "0.1", "10"]) {
    const s = Number(step);
    for (let q = 0.001; q < 50; q += 0.137) {
      const out = Number(floorToStep(q, step));
      assert.ok(out <= q + 1e-9, `${q} @ step ${step} → ${out} (커졌다)`);
      const units = out / s;
      assert.ok(Math.abs(units - Math.round(units)) < 1e-6,
        `${q} @ step ${step} → ${out} 은 배수가 아니다`);
    }
  }
});

test("음수·0은 0으로 떨어진다", () => {
  assert.equal(floorToStep(0,    BTC.step), "0.000");
  assert.equal(floorToStep(-1,   BTC.step), "0.000");
});

test("단위가 없거나 이상하면 조용히 넘어가지 않고 던진다", () => {
  // 조용히 기본값으로 떨어지면 **다른 심볼에 BTC 단위가 적용된다** — 그게 최악이다
  assert.throws(() => roundToTick(100, 0),         /tickSize/);
  assert.throws(() => roundToTick(100, undefined), /tickSize/);
  assert.throws(() => roundToTick(NaN, "0.1"),     /값/);
  assert.throws(() => floorToStep(1, 0),           /stepSize/);
  assert.throws(() => floorToStep(NaN, "0.001"),   /수량/);
});

test("지금까지의 BTCUSDT 동작과 같다", () => {
  // 옛 roundPrice: (Math.round(p * 10) / 10).toFixed(1)
  const old = p => (Math.round(parseFloat(p) * 10) / 10).toFixed(1);
  for (let p = 100; p < 120000; p += 137.03) {
    assert.equal(roundToTick(p, BTC.tick), old(p), `p=${p}`);
  }
});
