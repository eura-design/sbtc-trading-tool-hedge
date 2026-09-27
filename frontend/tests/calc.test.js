// calcPosition — 리스크 기반 진입 수량
//
// 이 숫자가 그대로 주문 수량이 된다. 과하게 나오면 한 번에 계좌가 날아가고,
// 모자라게 나오면 계획한 리스크를 못 채운다.

import test from "node:test";
import assert from "node:assert/strict";
import { calcPosition, minEntryQty } from "../src/utils/calc.js";
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
  // 증거금 + 유지증거금이 자본을 넘지 않는 크기가 상한이다 (2026-09-27 — 예전엔 자본의 95%)
  //   명목 상한 = 자본 × 레버리지 ÷ (1 + 유지증거금률 × 레버리지). 유지증거금률을 안 넘기면 0.05
  const maxQty = (10000 * 5) / (50000 * (1 + 0.05 * 5));
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

// ── 심볼마다 다른 수량 단위 (2026-09-02) ────────────────────────────────────
// 실측값: SOL step 0.01 / DOGE step 1 (최소 수량도 같다)

test("수량 단위가 심볼의 것을 따른다", () => {
  // DOGE(step 1): 소수가 남으면 거래소가 거절한다
  const doge = calcPosition(10000, 0.01, 0.2, 0.19, 10, 1, 1, 0.00001);
  assert.equal(doge.actualQty % 1, 0, `DOGE 수량에 소수가 남았다: ${doge.actualQty}`);
  assert.ok(doge.actualQty >= 1);

  // SOL(step 0.01)
  const sol = calcPosition(10000, 0.01, 200, 195, 10, 0.01, 0.01, 0.01);
  const units = sol.actualQty / 0.01;
  assert.ok(Math.abs(units - Math.round(units)) < 1e-6, `SOL 수량이 0.01 배수가 아니다: ${sol.actualQty}`);
});

test("손절 거리 하한이 호가 단위를 따른다", () => {
  // 옛 코드는 0.1 고정이라, 가격이 0.2인 DOGE에서는 정상 주문이 통째로 막혔다
  const doge = calcPosition(10000, 0.01, 0.2, 0.1995, 10, 1, 1, 0.00001);
  assert.ok(doge !== null, "호가 단위가 작은 코인에서 계산이 막혔다");
  // 그래도 한 칸보다 가까우면 막는다
  assert.equal(calcPosition(10000, 0.01, 0.2, 0.200005, 10, 1, 1, 0.00001), null);
});

test("최소 수량도 심볼의 것을 쓴다", () => {
  // 자본이 작아 이상적 수량이 1 미만 → DOGE의 최소 수량 1로 올라간다
  const r = calcPosition(50, 0.001, 0.2, 0.15, 10, 1, 1, 0.00001);
  assert.equal(r.actualQty, 1);
  assert.equal(r.isMinCapped, true);
});

test("안 넘기면 예전 BTCUSDT 동작 그대로다", () => {
  const a = calcPosition(10000, 0.01, 50000, 49000, 10);
  const b = calcPosition(10000, 0.01, 50000, 49000, 10, 0.001, 0.001, 0.1);
  assert.deepEqual(a, b);
});

// ── 최소 주문 금액 (2026-09-02 실측) ────────────────────────────────────────
// 거래소는 **최소 수량과 최소 금액을 둘 다** 본다. 지금까지 금액을 안 봐서,
// 계산이 내놓은 수량이 거래소에서 거절될 수 있었다.
//   DOGE  minQty 1 (=$0.2)      / minNotional $5   → 진짜 최소 25개
//   BTC   minQty 0.001 (=$72)   / minNotional $100 → 진짜 최소 0.002

test("최소 금액에 미달하면 수량을 올린다 — DOGE", () => {
  // 자본이 작아 이상적 수량이 1 미만 → 옛 코드는 minQty 1(=$0.2)로 끝났다
  const r = calcPosition(50, 0.001, 0.2, 0.15, 10, 1, 1, 0.00001, 5);
  assert.ok(r.actualQty * 0.2 >= 5 - 1e-9, `명목가 ${r.actualQty * 0.2} < $5`);
  assert.equal(r.actualQty, 25);
  assert.equal(r.isMinCapped, true);
  assert.equal(r.isNotionalCapped, true, "금액 때문에 올라간 것이 표시돼야 한다");
});

test("최소 금액에 미달하면 수량을 올린다 — BTC", () => {
  // 0.001 BTC = $72 < $100 → 0.002로 올라가야 한다
  const r = calcPosition(100, 0.0001, 72000, 70000, 10, 0.001, 0.001, 0.1, 100);
  assert.ok(r.actualQty * 72000 >= 100 - 1e-9, `명목가 ${r.actualQty * 72000} < $100`);
  assert.equal(r.actualQty, 0.002);
});

test("올린 수량도 단위의 배수다", () => {
  for (const [px, step, minQty, minNot] of [
    [0.2,    1,     1,     5],      // DOGE
    [0.5,    0.1,   0.1,   5],      // XRP류
    [200,    0.01,  0.01,  5],      // SOL
    [72000,  0.001, 0.001, 100],    // BTC
  ]) {
    const r = calcPosition(50, 0.0005, px, px * 0.9, 10, step, minQty, px * 0.0001, minNot);
    const units = r.actualQty / step;
    assert.ok(Math.abs(units - Math.round(units)) < 1e-6,
      `px=${px} step=${step} → ${r.actualQty}가 배수가 아니다`);
    assert.ok(r.actualQty * px >= minNot - 1e-9,
      `px=${px} → 명목가 ${r.actualQty * px} < ${minNot}`);
  }
});

test("이미 충분하면 건드리지 않는다", () => {
  // 리스크 계산 결과가 최소 금액을 이미 넘으면 그대로 둔다
  const r = calcPosition(10000, 0.01, 0.2, 0.19, 10, 1, 1, 0.00001, 5);
  assert.equal(r.isNotionalCapped, false);
  assert.equal(r.isMinCapped, false);
  assert.ok(r.actualQty > 25);
});

test("최소 금액을 안 넘기면 예전 동작 그대로다", () => {
  const a = calcPosition(50, 0.001, 0.2, 0.15, 10, 1, 1, 0.00001);
  const b = calcPosition(50, 0.001, 0.2, 0.15, 10, 1, 1, 0.00001, 0);
  assert.deepEqual(a, b);
  assert.equal(a.actualQty, 1);   // minQty만 본 결과
});

// ── 거래소가 받아 주는 가장 작은 주문 수량 (2026-09-27) ─────────────────────
//
// 플랜 카드의 `최소` 버튼이 쓴다 — 수동 스케일 진입의 첫 조각을 넣는 용도다.
// ⚠ **최소 수량과 최소 금액은 별개이고 거래소는 둘 다 본다.** 하나만 보면 거절된다.

test("최소 수량과 최소 금액 중 **큰 쪽**이다", () => {
  // BTC: 0.001이 이미 $84라 수량 쪽이 이긴다
  assert.equal(minEntryQty({ price: 84236.3, step: 0.001, minQty: 0.001, minNotional: 50 }), 0.001);
  // ETH: 0.001은 $2.7뿐 → 최소 금액 $20에 걸려 0.008로 올라간다
  assert.equal(minEntryQty({ price: 2686.41, step: 0.001, minQty: 0.001, minNotional: 20 }), 0.008);
  // DOGE: 1개는 $0.2뿐 → $5에 걸려 25개
  assert.equal(minEntryQty({ price: 0.2, step: 1, minQty: 1, minNotional: 5 }), 25);
});

test("금액을 수량으로 바꿀 때 **올린다** — 내리면 미달이라 거절된다", () => {
  const q = minEntryQty({ price: 2686.41, step: 0.001, minQty: 0.001, minNotional: 20 });
  assert.ok(q * 2686.41 >= 20, `${q} × 2686.41 = ${q * 2686.41} — 최소 금액에 못 미친다`);
  // 한 단위 내리면 미달이어야 한다 (= 올림이 실제로 필요했다)
  assert.ok((q - 0.001) * 2686.41 < 20);
});

test("단위 자릿수로 정리한다 (부동소수 잡음이 남지 않는다)", () => {
  const q = minEntryQty({ price: 2686.41, step: 0.001, minQty: 0.001, minNotional: 20 });
  assert.equal(String(q), "0.008", "0.008000000000000002 같은 값이 나오면 안 된다");
});

test("최소 금액을 모르면 최소 수량만 본다 (그 인자가 생기기 전 동작)", () => {
  assert.equal(minEntryQty({ price: 100, step: 0.001, minQty: 0.001 }), 0.001);
  assert.equal(minEntryQty({ price: 100, step: 0.001, minQty: 0.001, minNotional: 0 }), 0.001);
});

test("가격을 모르면 최소 수량으로 떨어진다 (0으로 나누지 않는다)", () => {
  assert.equal(minEntryQty({ price: 0, step: 0.001, minQty: 0.001, minNotional: 50 }), 0.001);
});

test("⚠ `calcPosition`의 하한과 **같은 값**이다 (규칙이 한 벌이다)", () => {
  // 자본이 아주 작으면 리스크 계산 결과가 하한에 눌린다 — 그 하한이 이 함수여야 한다
  const r = calcPosition(3, 0.01, 2686.41, 2600, 10, 0.001, 0.001, 0.01, 20);
  const floor = minEntryQty({ price: 2686.41, step: 0.001, minQty: 0.001, minNotional: 20 });
  assert.equal(r.actualQty, floor);
  assert.equal(r.isMinCapped, true);
  assert.equal(r.isNotionalCapped, true, "수량이 아니라 금액 때문에 올라간 경우다");
});

// ── 레버리지 상한은 **그 코인의 유지증거금률**로 잰다 (2026-09-27) ─────────
// 예전엔 모든 코인에 5%를 썼다. 실제 1구간 값은 0.004(BTC) ~ 0.1667로 40배 넘게 차이 난다

test("유지증거금률이 높은 코인일수록 상한이 **좁아진다**", () => {
  // 손절이 아주 가까워 레버리지 상한에 걸리게 한다
  const btc  = calcPosition(10000, 0.05, 100, 99.99, 10, 0.001, 0.001, 0.01, 0, 0.004);
  const risky = calcPosition(10000, 0.05, 100, 99.99, 10, 0.001, 0.001, 0.01, 0, 0.1667);
  assert.equal(btc.isLeverageCapped, true);
  assert.equal(risky.isLeverageCapped, true);
  assert.ok(risky.actualQty < btc.actualQty,
    `유지증거금률 16.67% 코인이 0.4% 코인보다 크게 잡혔다 (${risky.actualQty} ≥ ${btc.actualQty})`);
});

test("상한에서 **증거금 + 유지증거금이 자본을 넘지 않는다**", () => {
  for (const mmr of [0.004, 0.015, 0.05, 0.1667]) {
    const r = calcPosition(10000, 0.05, 100, 99.99, 10, 0.001, 0.001, 0.01, 0, mmr);
    const notional = r.actualQty * 100;
    const need = notional / 10 + notional * mmr;
    assert.ok(need <= 10000 + 1, `유지증거금률 ${mmr}: 필요 ${need.toFixed(2)} > 자본 10000`);
  }
});

test("유지증거금률을 모르면 보수적 기본값(0.05)을 쓴다", () => {
  const a = calcPosition(10000, 0.05, 100, 99.99, 10, 0.001, 0.001, 0.01, 0);
  const b = calcPosition(10000, 0.05, 100, 99.99, 10, 0.001, 0.001, 0.01, 0, 0.05);
  assert.equal(a.actualQty, b.actualQty);
  for (const bad of [0, -1, NaN, null]) {
    const c = calcPosition(10000, 0.05, 100, 99.99, 10, 0.001, 0.001, 0.01, 0, bad);
    assert.equal(c.actualQty, b.actualQty, `${bad}이면 기본값으로 떨어져야 한다`);
  }
});
