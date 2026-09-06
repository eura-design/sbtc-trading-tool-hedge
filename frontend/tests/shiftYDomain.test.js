// 차트를 위아래로 끌 때 **세로 범위가 얼마나 움직이는가** (`chart/scales.js`)
//
// ⚠ 이 계산이 틀리면 증상이 "차트가 미끄러진다"로 나타난다 — 끈 거리와 실제로 움직인
//   거리가 다르면, 잡은 캔들이 커서를 따라오지 않는다.
// ⚠ **로그 눈금에서는 더하기가 아니라 곱하기다.** 선형 식을 그대로 쓰면 화면 위쪽으로
//   갈수록 어긋나서, 위로 끌 때와 아래로 끌 때의 이동량이 달라진다.

import test from "node:test";
import assert from "node:assert/strict";
import { shiftYDomain, zoomYDomain } from "../src/chart/scales.js";

const IH = 500;   // 캔들 영역 높이(px)

test("아래로 끌면 **더 높은 가격**이 드러난다 (범위가 위로 간다)", () => {
  // 캔들을 아래로 끌면 위쪽이 비면서 그 위 가격대가 보여야 한다
  const [lo, hi] = shiftYDomain([100, 200], 50, IH, false);
  assert.ok(lo > 100 && hi > 200, `위로 안 갔다: ${lo} ~ ${hi}`);
});

test("위로 끌면 **더 낮은 가격**이 드러난다", () => {
  const [lo, hi] = shiftYDomain([100, 200], -50, IH, false);
  assert.ok(lo < 100 && hi < 200, `아래로 안 갔다: ${lo} ~ ${hi}`);
});

test("끈 거리와 움직인 거리가 **정확히 같다** (선형)", () => {
  // 화면 높이의 10%를 끌었으면 범위도 폭의 10%만큼 움직여야 한다.
  // 안 그러면 잡은 캔들이 커서를 앞서거나 뒤처진다
  const [lo, hi] = shiftYDomain([100, 200], IH * 0.1, IH, false);
  assert.equal(Math.round(lo), 110);
  assert.equal(Math.round(hi), 210);
});

test("폭은 변하지 않는다 — 옮기는 것이지 늘이는 것이 아니다 (선형)", () => {
  const [lo, hi] = shiftYDomain([100, 200], 137, IH, false);
  assert.ok(Math.abs((hi - lo) - 100) < 1e-9, `폭이 변했다: ${hi - lo}`);
});

test("로그에서는 **비율**이 그대로다 (폭이 아니라)", () => {
  // 로그 축은 같은 간격이 같은 배율이다. 옮겨도 위/아래 가격의 배수는 같아야 한다
  const [lo, hi] = shiftYDomain([100, 200], 137, IH, true);
  assert.ok(Math.abs(hi / lo - 2) < 1e-9, `배율이 변했다: ${hi / lo}`);
  assert.ok(lo > 100, "위로 안 갔다");
});

test("로그에서 한 화면(IH)을 끌면 **범위가 통째로 한 칸 옮겨진다**", () => {
  // 100~200을 아래로 한 화면 끌면 200~400이 보인다 (배율 2배가 그대로 이어진다)
  const [lo, hi] = shiftYDomain([100, 200], IH, IH, true);
  assert.ok(Math.abs(lo - 200) < 1e-6, `lo가 ${lo}`);
  assert.ok(Math.abs(hi - 400) < 1e-6, `hi가 ${hi}`);
});

test("선형과 로그의 **방향이 같다** (한쪽만 뒤집히면 로그를 켤 때 차트가 반대로 끌린다)", () => {
  const linUp = shiftYDomain([100, 200],  50, IH, false)[0];
  const logUp = shiftYDomain([100, 200],  50, IH, true)[0];
  const linDn = shiftYDomain([100, 200], -50, IH, false)[0];
  const logDn = shiftYDomain([100, 200], -50, IH, true)[0];
  assert.ok(linUp > 100 && logUp > 100, "아래로 끌었는데 방향이 갈렸다");
  assert.ok(linDn < 100 && logDn < 100, "위로 끌었는데 방향이 갈렸다");
});

test("안 끌었으면 그대로 (0으로 나누지 않는다)", () => {
  assert.deepEqual(shiftYDomain([100, 200], 0, IH, false), [100, 200]);
  assert.deepEqual(shiftYDomain([100, 200], 50, 0, false), [100, 200]);   // 높이 0 — 화면이 아직 없다
});

test("값이 깨져 있으면 그대로 돌려준다 (NaN을 만들지 않는다)", () => {
  // 세로 범위에 NaN이 한 번 들어가면 축·캔들·도형이 전부 안 그려진다
  const out = shiftYDomain([NaN, 200], 50, IH, false);
  assert.ok(Number.isNaN(out[0]), "입력을 바꿔 버렸다");
  assert.equal(out[1], 200);
});

test("소수점 가격(DOGE 0.2)에서도 로그 이동이 무너지지 않는다", () => {
  const [lo, hi] = shiftYDomain([0.18, 0.22], 60, IH, true);
  assert.ok(lo > 0.18 && hi > 0.22, `안 움직였다: ${lo} ~ ${hi}`);
  assert.ok(Math.abs(hi / lo - (0.22 / 0.18)) < 1e-9, "배율이 변했다");
});

// ── 화면 이동 모드에서의 휠 확대·축소 (zoomYDomain) ────────────────────────
//
// ⚠ 실제 신고: A를 켜고 휠로 축소했더니 **캔들이 세로로 길어 보였다.** 가로만 넓히고
//   세로를 그대로 뒀기 때문이다. 가로와 **같은 배율**로 세로도 움직여야 비율이 지켜진다.

test("가로와 같은 배율로 세로도 넓어진다 (축소)", () => {
  // 가로가 1.25배 넓어지면 세로 범위도 1.25배여야 그림이 안 눌린다
  const [lo, hi] = zoomYDomain([100, 200], 1.25, 0.5, false);
  assert.ok(Math.abs((hi - lo) - 125) < 1e-9, `폭이 ${hi - lo} (125여야 한다)`);
});

test("확대도 같은 배율이다", () => {
  const [lo, hi] = zoomYDomain([100, 200], 0.8, 0.5, false);
  assert.ok(Math.abs((hi - lo) - 80) < 1e-9, `폭이 ${hi - lo} (80이어야 한다)`);
});

test("커서가 가리키던 가격은 **제자리에 남는다**", () => {
  // 가로가 커서 아래 봉을 붙잡고 확대하므로, 세로도 그래야 그 지점이 안 흔들린다.
  // 커서가 위에서 25% 지점 → 가격 175. 확대해도 그 가격이 여전히 25% 지점이어야 한다
  const r = 0.25;
  const [lo, hi] = zoomYDomain([100, 200], 0.8, r, false);
  const priceAtCursor = hi - (hi - lo) * r;
  assert.ok(Math.abs(priceAtCursor - 175) < 1e-9, `커서 가격이 ${priceAtCursor}로 밀렸다`);
});

test("로그에서는 **배율**이 같은 배수로 커진다", () => {
  // 선형의 "폭 × factor"에 해당하는 것이 로그에서는 "배율의 factor 제곱"이다
  const [lo, hi] = zoomYDomain([100, 200], 2, 0.5, true);
  assert.ok(Math.abs(hi / lo - 4) < 1e-9, `배율이 ${hi / lo} (4여야 한다)`);
});

test("커서가 캔들 영역 밖이면 가장자리로 본다 (NaN을 만들지 않는다)", () => {
  // 커서가 거래량 패널 위에 있으면 비율이 1을 넘는다 — 그대로 쓰면 범위가 뒤집힌다
  const [lo, hi] = zoomYDomain([100, 200], 1.25, 1.8, false);
  assert.ok(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo, `범위가 깨졌다: ${lo} ~ ${hi}`);
});

test("배율이 0이거나 값이 깨졌으면 그대로 돌려준다", () => {
  assert.deepEqual(zoomYDomain([100, 200], 0, 0.5, false), [100, 200]);
  assert.deepEqual(zoomYDomain([100, 200], -1, 0.5, false), [100, 200]);
  assert.ok(Number.isNaN(zoomYDomain([NaN, 200], 1.25, 0.5, false)[0]));
});

// ── 안전망: 무한대를 만들지 않는다 (2026-09-06) ────────────────────────────
//
// ⚠ 세로 범위에 무한대가 한 번 들어가면 축·캔들·도형이 통째로 안 그려지고, 그 뒤로는
//   확대해도 되돌아오지 않는다(무한대는 계산해도 무한대다). 실측으로 그렇게 만들 수 있었다.
// ※ 지금 화면에서는 도달하지 않는다 — 가로 축 한계가 먼저 걸려 연속 축소가 6번에서
//   끊긴다. 그래도 함수 자체가 무한대를 내놓지 않아야 다른 곳에서 불러도 안전하다.

test("로그에서 **50번 연속 축소**해도 무한대가 되지 않는다", () => {
  let y = [0.18, 0.22];
  for (let i = 0; i < 50; i++) y = zoomYDomain(y, 1.25, 0.5, true);
  assert.ok(Number.isFinite(y[0]) && Number.isFinite(y[1]),
    `무한대가 됐다: ${y[0]} ~ ${y[1]} — 이 상태가 되면 차트가 통째로 안 그려진다`);
  assert.ok(y[1] > y[0], "범위가 뒤집혔다");
});

test("막힌 뒤에도 **계속 쓸 수 있다** (확대가 먹힌다)", () => {
  let y = [0.18, 0.22];
  for (let i = 0; i < 50; i++) y = zoomYDomain(y, 1.25, 0.5, true);
  const before = y[1] - y[0];
  for (let i = 0; i < 5; i++) y = zoomYDomain(y, 0.8, 0.5, true);
  assert.ok(Number.isFinite(y[1]) && (y[1] - y[0]) < before, "확대가 안 먹힌다");
});

test("끌기도 같은 안전망을 쓴다", () => {
  // 범위가 이미 엄청나게 큰 상태에서 끌어도 무한대를 만들지 않는다
  const huge = [1e-300, 1e300];
  const out = shiftYDomain(huge, 250, 500, false);
  assert.ok(Number.isFinite(out[0]) && Number.isFinite(out[1]), `무한대가 됐다: ${out}`);
});
