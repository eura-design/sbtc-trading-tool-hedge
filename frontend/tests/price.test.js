// 가격·수량 표시
//
// ⚠ 2026-09-02 전수조사에서 나온 버그를 고정한다: 화면 전체가 `d3.format(",.0f")`로
//   가격을 찍고 있었다. BTC(70,000)에서는 맞지만 **DOGE(0.2)에서는 전부 `$0`이 된다** —
//   가격 축·크로스헤어·현재가가 다 그랬다.

import test from "node:test";
import assert from "node:assert/strict";
import { tickDecimals, fmtPrice, fmtPriceUsd } from "../src/utils/price.js";
import { qtyDecimals, floorQty, fmtQty, qtyLabel } from "../src/utils/qty.js";

// 실측값 (바이낸스 exchangeInfo, 2026-09-02)
const BTC  = { tick: 0.1,     step: 0.001 };
const ETH  = { tick: 0.01,    step: 0.001 };
const SOL  = { tick: 0.01,    step: 0.01  };
const DOGE = { tick: 0.00001, step: 1     };

test("자릿수는 호가 단위가 정한다", () => {
  assert.equal(tickDecimals(0.1),     1);
  assert.equal(tickDecimals("0.10"),  1);   // 뒤의 0은 떼고 센다
  assert.equal(tickDecimals(0.01),    2);
  assert.equal(tickDecimals(0.00001), 5);
  assert.equal(tickDecimals(1),       0);
  assert.equal(tickDecimals("1e-5"),  5);
});

test("저가 코인이 0으로 뭉개지지 않는다 (회귀)", () => {
  // 옛 코드: d3.format(",.0f")(0.20431) === "0"
  assert.equal(fmtPrice(0.20431, DOGE.tick), "0.20431");
  assert.notEqual(fmtPrice(0.20431, DOGE.tick), "0");
  assert.equal(fmtPriceUsd(0.20431, DOGE.tick), "$0.20431");
});

test("BTC는 예전처럼 보인다", () => {
  assert.equal(fmtPrice(72256.5, BTC.tick),    "72,256.5");
  assert.equal(fmtPriceUsd(72256.5, BTC.tick), "$72,256.5");
  assert.equal(fmtPrice(3456.789, ETH.tick),   "3,456.79");
});

test("음수·빈 값", () => {
  assert.equal(fmtPriceUsd(-1.5, BTC.tick), "-$1.5");
  assert.equal(fmtPrice(null, BTC.tick),      "—");
  assert.equal(fmtPrice(undefined, BTC.tick), "—");
  assert.equal(fmtPrice(NaN, BTC.tick),       "—");
});

test("maxDec는 묶되 tick보다 굵게 자르지 않는다", () => {
  assert.equal(fmtPrice(0.20431, DOGE.tick, 2), "0.20");   // 좁은 자리용
  assert.equal(fmtPrice(72256.5, BTC.tick, 5),  "72,256.5"); // tick이 이미 1자리
});

// ── 수량 ────────────────────────────────────────────────────────────────────
test("수량 자릿수도 심볼 단위를 따른다", () => {
  assert.equal(qtyDecimals(0.001), 3);
  assert.equal(qtyDecimals(0.01),  2);
  assert.equal(qtyDecimals(1),     0);
  assert.equal(fmtQty(0.164, BTC.step), "0.164");
  assert.equal(fmtQty(123,   DOGE.step), "123");     // `123.000`이 아니다 (회귀)
  assert.equal(fmtQty(1.5,   SOL.step),  "1.50");
});

test("수량은 내림 — 올리면 없는 물량을 주문한다", () => {
  assert.equal(floorQty(0.0019, BTC.step), 0.001);
  assert.equal(floorQty(123.9,  DOGE.step), 123);
  assert.equal(floorQty(1.567,  SOL.step),  1.56);
  assert.equal(floorQty(-1,     BTC.step),  0);
  // 나눗셈 오차로 한 칸이 사라지지 않는다 (backend floorToStep과 같은 규칙)
  for (let n = 1; n <= 300; n++) {
    const q = n / 1000;
    assert.equal(floorQty(q, 0.001), Number(q.toFixed(3)), `n=${n}`);
  }
});

test("라벨은 코인 이름을 따른다", () => {
  assert.equal(qtyLabel(0.164, BTC.step, "BTC"),  "0.164 BTC");
  assert.equal(qtyLabel(123,   DOGE.step, "DOGE"), "123 DOGE");
  assert.equal(qtyLabel(0.164, BTC.step),          "0.164");   // 이름을 모르면 숫자만
});
