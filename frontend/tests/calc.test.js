// calcPosition — 리스크 기반 진입 수량
//
// 이 숫자가 그대로 주문 수량이 된다. 과하게 나오면 한 번에 계좌가 날아가고,
// 모자라게 나오면 계획한 리스크를 못 채운다.

import test from "node:test";
import assert from "node:assert/strict";
import { calcPosition } from "../src/utils/calc.js";
import { MIN_QTY, QTY_STEP } from "../src/constants.js";

test("리스크 금액 ÷ 1단위 손실 = 수량", () => {
  // 자본 10000, 리스크 1% = 100달러. 진입 50000 / 손절 49000 → 1단위당 1000달러 손실
  // → 이상적 수량 0.1
  const r = calcPosition(10000, 0.01, 50000, 49000, 10);
  assert.ok(Math.abs(r.idealQty - 0.1) < 1e-9, `idealQty=${r.idealQty}`);
  assert.equal(r.actualQty, 0.1);
  assert.ok(Math.abs(r.actualRiskPct - 1) < 0.01, `실제 리스크 ${r.actualRiskPct}%`);
  assert.equal(r.isLeverageCapped, false);
  assert.equal(r.isMinCapped, false);
});

test("롱·숏 방향과 무관하다 — 손절까지의 거리만 본다", () => {
  const long  = calcPosition(10000, 0.01, 50000, 49000, 10);   // 손절이 아래
  const short = calcPosition(10000, 0.01, 50000, 51000, 10);   // 손절이 위
  assert.equal(long.actualQty, short.actualQty);
});

test("레버리지 한도를 넘지 않는다", () => {
  // 손절이 아주 가까우면 이상적 수량이 커진다 → 레버리지가 먼저 막아야 한다
  const r = calcPosition(10000, 0.05, 50000, 49990, 5);
  assert.equal(r.isLeverageCapped, true);
  assert.ok(r.actualQty < r.idealQty, "레버리지 한도가 안 걸렸다");
  // 유지증거금 5%를 뺀 자본 × 레버리지 ÷ 진입가가 상한이다
  const maxQty = (10000 * 0.95 * 5) / 50000;
  assert.ok(r.actualQty <= maxQty + QTY_STEP, `${r.actualQty} > 상한 ${maxQty}`);
  // 상한에 걸렸으면 실제 리스크는 계획보다 **작아야** 한다 (크면 위험하다)
  assert.ok(r.actualRiskPct < r.idealRiskPct);
});

test("레버리지를 올리면 수량 상한도 올라간다", () => {
  const lo = calcPosition(10000, 0.05, 50000, 49990, 1);
  const hi = calcPosition(10000, 0.05, 50000, 49990, 20);
  assert.ok(hi.actualQty > lo.actualQty);
});

test("최소 수량 아래로는 안 내려간다", () => {
  // 자본이 아주 작으면 이상적 수량이 최소 단위 미만이 된다
  const r = calcPosition(10, 0.001, 50000, 45000, 10);
  assert.equal(r.actualQty, MIN_QTY);
  assert.equal(r.isMinCapped, true);
  // ⚠ 이때는 계획보다 **더 큰** 리스크를 지게 된다 — 화면이 그걸 알려야 한다
  assert.ok(r.actualRiskPct > r.idealRiskPct);
});

test("수량은 언제나 최소 단위의 배수다", () => {
  for (const cap of [500, 1000, 12345, 98765]) {
    for (const risk of [0.005, 0.01, 0.02]) {
      const r = calcPosition(cap, risk, 50000, 49000, 10);
      const units = r.actualQty / QTY_STEP;
      assert.ok(Math.abs(units - Math.round(units)) < 1e-6,
        `cap=${cap} risk=${risk} → ${r.actualQty}는 ${QTY_STEP}의 배수가 아니다`);
    }
  }
});

test("계산할 수 없으면 null — 0을 돌려주지 않는다", () => {
  assert.equal(calcPosition(10000, 0.01, 50000, 50000, 10), null);   // 손절 = 진입
  assert.equal(calcPosition(10000, 0.01, 50000, 50000.05, 10), null); // 거리가 0.1 미만
  assert.equal(calcPosition(0, 0.01, 50000, 49000, 10), null);        // 자본 0
  assert.equal(calcPosition(-100, 0.01, 50000, 49000, 10), null);     // 자본 음수
});

test("손절이 멀수록 수량이 준다", () => {
  const near = calcPosition(10000, 0.01, 50000, 49500, 20).actualQty;
  const far  = calcPosition(10000, 0.01, 50000, 45000, 20).actualQty;
  assert.ok(far < near, `먼 손절 ${far} >= 가까운 손절 ${near}`);
});
