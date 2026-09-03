// 자릿수 규칙 — **프론트와 백엔드가 같은 답을 내야 한다**
//
// ⚠ 2026-09-03 감사에서 이 다섯 줄이 **일곱 곳에 복제**돼 있었고 그중 둘이 갈렸다:
//   `splitTp.js`와 `paperBroker.js`만 지수 표기 방어가 빠져 `1e-5`에서 5가 아니라
//   0을 냈다. 자릿수가 갈리면 **화면에 뜬 숫자와 거래소로 나가는 숫자가 달라진다.**
//
// 지금은 프론트 `utils/decimals.js` · 백엔드 `utils/round.js` 두 벌뿐이다
// (코드를 나눠 쓸 수 없어 불가피하다). 이 파일이 **둘이 같은지** 지킨다.

import test from "node:test";
import assert from "node:assert/strict";
import { decimalsOf } from "../src/utils/decimals.js";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { decimalsOf: backendDecimalsOf } = require_("../../backend/utils/round.js");

// 바이낸스가 실제로 보내는 형태 + 방어해야 하는 형태
const CASES = [
  "0.001", "0.01", "0.1", "1", "10",
  "0.10", "0.00100000", "0.0000100", "0.5", "0.05",
  "1e-5", "1e-7", "1E-5",
  0.001, 0.01, 1, 10, 0.00001,
];

test("프론트와 백엔드가 같은 답을 낸다", () => {
  for (const c of CASES) {
    assert.equal(decimalsOf(c), backendDecimalsOf(c),
      `${JSON.stringify(c)}: 프론트 ${decimalsOf(c)} ≠ 백엔드 ${backendDecimalsOf(c)}`);
  }
});

test("뒤의 0은 떼고 센다", () => {
  // 바이낸스는 "0.00100000"처럼 채워 보낸다. 8을 그대로 쓰면 거래소가 거절한다
  assert.equal(decimalsOf("0.10"), 1);
  assert.equal(decimalsOf("0.00100000"), 3);
  assert.equal(decimalsOf("0.0000100"), 5);
});

test("지수 표기를 방어한다 (회귀)", () => {
  // 값이 **숫자**로 흘러들어오면 JS가 작은 값을 지수로 만든다.
  // 방어가 없으면 소수점이 없다고 보고 0자리를 답했다
  assert.equal(decimalsOf("1e-5"), 5);
  assert.equal(decimalsOf(0.0000001), 7);   // String(0.0000001) === "1e-7"
  assert.notEqual(decimalsOf("1e-5"), 0);
});

test("정수는 0자리", () => {
  assert.equal(decimalsOf("1"), 0);
  assert.equal(decimalsOf("10"), 0);
  assert.equal(decimalsOf(1), 0);
});

test("실제 심볼의 단위 (2026-09-02 실측)", () => {
  const REAL = [
    ["BTCUSDT", "0.10",      1, "0.001", 3],
    ["ETHUSDT", "0.01",      2, "0.001", 3],
    ["SOLUSDT", "0.0100",    2, "0.01",  2],
    ["DOGEUSDT","0.0000100", 5, "1",     0],
  ];
  for (const [sym, tick, td, step, sd] of REAL) {
    assert.equal(decimalsOf(tick), td, `${sym} tick`);
    assert.equal(decimalsOf(step), sd, `${sym} step`);
  }
});
