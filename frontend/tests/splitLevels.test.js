// 분할 주문의 가격·수량 배분
//
// 여기서 나온 숫자가 그대로 거래소로 나간다 (utils/splitLevels.js 머리 주석).
// 그리고 **화면 미리보기와 실제 주문이 이 함수 하나를 공유한다** — 어긋나면
// 체결된 뒤에야 보인다.

import test from "node:test";
import assert from "node:assert/strict";
import { splitPrices, splitQtys, splitOrders, splitPlan,
         maxSplitCount, bigPieceAtHigh } from "../src/utils/splitLevels.js";

const sum = a => Math.round(a.reduce((s, v) => s + v, 0) * 1000) / 1000;
const qtys = list => list.map(o => o.qty);

// ── 수량 ────────────────────────────────────────────────────────────────────
test("합은 총 수량을 절대 넘지 않는다", () => {
  // 넘으면 시키지 않은 물량이 주문으로 나간다
  for (let total = 0.001; total <= 2; total = Math.round((total + 0.001) * 1000) / 1000) {
    for (const n of [1, 2, 3, 5, 10]) {
      const q = splitQtys(total, n);
      assert.ok(sum(q) <= total + 1e-9, `total=${total} n=${n} → 합 ${sum(q)}`);
    }
  }
});

test("남는 한 칸씩은 앞에서부터 얹는다", () => {
  // 0.010을 3분할 → 4/3/3 (0.001 단위 10칸)
  assert.deepEqual(splitQtys(0.01, 3), [0.004, 0.003, 0.003]);
  assert.deepEqual(splitQtys(0.009, 3), [0.003, 0.003, 0.003]);
});

test("수량 0짜리를 끼워 돌려주지 않는다 — 개수를 줄인다", () => {
  // 0.002를 5분할하면 뒤 3개가 0이 된다. 그대로 주면 부르는 쪽이 주문으로 보낸다
  assert.deepEqual(splitQtys(0.002, 5), [0.001, 0.001]);
  assert.deepEqual(splitQtys(0, 3), []);
  assert.deepEqual(splitQtys(0.0005, 3), []);   // 최소 단위 미만
  assert.deepEqual(splitQtys(1, 0), []);
});

test("최대 분할 개수는 한 조각이 최소 단위 이상이 되는 선까지", () => {
  assert.equal(maxSplitCount(0.002), 2);     // 0.001짜리 2개가 한계
  assert.equal(maxSplitCount(0.01),  10);    // 기본 상한 10
  assert.equal(maxSplitCount(5),     10);
  assert.equal(maxSplitCount(0),     1);     // 방어
  assert.equal(maxSplitCount(-1),    1);
  // 부동소수 오차(0.095999…)를 내림으로 흡수한다
  assert.equal(maxSplitCount(0.096, 200), 96);
});

test("최대 개수만큼 쪼개면 조각이 하나도 안 빠진다", () => {
  for (const total of [0.002, 0.005, 0.01, 0.037, 1.234]) {
    const n = maxSplitCount(total);
    assert.equal(splitQtys(total, n).length, n, `total=${total}`);
  }
});

// ── 가격 ────────────────────────────────────────────────────────────────────
test("양 끝을 포함해 균등 배치한다", () => {
  assert.deepEqual(splitPrices(100, 200, 3), [100, 150, 200]);
  assert.deepEqual(splitPrices(200, 100, 3), [200, 150, 100]);   // 정렬하지 않는다
});

test("1개면 손을 뗀 자리(p2) 하나다", () => {
  // 클릭(1개)은 시작점 없이 놓은 자리이고, 드래그를 1개로 줄였을 때도 그게 직관에 맞는다
  assert.deepEqual(splitPrices(100, 200, 1), [200]);
  assert.deepEqual(splitPrices(100, 200, 0), [200]);
});

// ── 큰 조각은 기준가에서 먼 쪽 (2026-08-27 사용자 확정) ─────────────────────
test("큰 조각이 어느 끝으로 가는가 — 네 경우", () => {
  assert.equal(bigPieceAtHigh(true,  "scale_in"), false); // 추가 진입·롱  → 아래 (더 싸게 더 많이)
  assert.equal(bigPieceAtHigh(false, "scale_in"), true);  // 추가 진입·숏  → 위
  assert.equal(bigPieceAtHigh(true,  "split_tp"), true);  // 분할 TP·롱    → 위 (먼 목표에 더 많이)
  assert.equal(bigPieceAtHigh(false, "split_tp"), false); // 분할 TP·숏    → 아래
});

test("드래그를 어느 끝에서 시작해도 배분이 같다 (2026-08-27 회귀)", () => {
  // 옛 버그: splitOrders는 "준 순서대로" 배분해서, 같은 구간을 같은 값으로 걸어도
  // 손을 아래에서 시작하면 아래가 많고 위에서 시작하면 위가 많았다.
  // 화면 어디에도 그 차이가 드러나지 않았다.
  for (const isLong of [true, false]) {
    for (const kind of ["scale_in", "split_tp", "split_sl"]) {
      const down = splitPlan(200, 100, 3, 0.01, isLong, kind);   // 위→아래로 끌었다
      const up   = splitPlan(100, 200, 3, 0.01, isLong, kind);   // 아래→위로 끌었다
      assert.deepEqual(down, up, `${isLong ? "롱" : "숏"}/${kind}`);
    }
  }
});

test("큰 조각이 실제로 먼 쪽에 붙는다", () => {
  // 분할 TP·롱 → 위쪽(먼 목표)이 커야 한다
  const tpLong = splitPlan(100, 200, 3, 0.01, true, "split_tp");
  const atHigh = tpLong.find(o => o.price === 200);
  const atLow  = tpLong.find(o => o.price === 100);
  assert.ok(atHigh.qty >= atLow.qty, "분할 TP·롱인데 위쪽이 크지 않다");

  // 추가 진입·롱 → 아래쪽(더 싼 값)이 커야 한다
  const inLong = splitPlan(100, 200, 3, 0.01, true, "scale_in");
  assert.ok(inLong.find(o => o.price === 100).qty >= inLong.find(o => o.price === 200).qty,
    "추가 진입·롱인데 아래쪽이 크지 않다");
});

test("splitOrders는 가격과 수량을 짝지어 준다 — 개수가 어긋나지 않는다", () => {
  // 미리보기와 실주문이 이걸 공유하므로, 가격만 있고 수량이 없는 항목이 있으면 안 된다
  for (const [total, n] of [[0.01, 3], [0.002, 5], [1, 10], [0.0005, 2]]) {
    const list = splitOrders(100, 200, n, total);
    assert.ok(list.every(o => o.qty > 0 && Number.isFinite(o.price)),
      `total=${total} n=${n} → ${JSON.stringify(list)}`);
    assert.equal(sum(qtys(list)) <= total + 1e-9, true);
  }
});
