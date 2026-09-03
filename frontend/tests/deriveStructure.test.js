// 수동 구조 → CHoCH 판정
//
// ── 왜 이 파일이 있나 ──────────────────────────────────────────────────────
// 판정 규칙이 두 벌 있다 — 자동 ZZ(`structureZigzag.js`)와 수동 구조(여기).
// 둘은 **같은 규칙이어야 한다** (CLAUDE.md: 한쪽만 되돌리면 같은 차트에서
// 지표끼리, 또 트레이딩뷰와 결과가 어긋난다).
//
// 2026-08-13에 규칙이 한 번 바뀌었고(첫 돌파도 CHoCH), 2026-08-12에는
// BOS 구간 오탐을 고쳤다(`284761f`). 그런데 지금까지 검산이 없었다.

import test from "node:test";
import assert from "node:assert/strict";
import { deriveStructure } from "../src/chart/deriveStructure.js";

// 꼭짓점: 시간순, 고/저 교대
const H = (t, p) => ({ t, p, type: "H" });
const L = (t, p) => ({ t, p, type: "L" });
const dirs = (r) => r.chochs.map(c => c.dir);

test("꼭짓점이 둘 미만이면 아무것도 없다", () => {
  assert.deepEqual(deriveStructure([]).chochs, []);
  assert.deepEqual(deriveStructure([H(1, 100)]).chochs, []);
  assert.deepEqual(deriveStructure(null).chochs, []);
});

test("세그먼트는 꼭짓점을 이은 것이다", () => {
  const r = deriveStructure([L(1, 90), H(2, 110), L(3, 95)]);
  assert.equal(r.segments.length, 2);
  assert.deepEqual(r.segments[0], { t1: 1, p1: 90, t2: 2, p2: 110 });
});

test("첫 돌파도 CHoCH다 (2026-08-13 사용자 요청)", () => {
  // 추세가 아직 미정(bias=0)일 때의 첫 돌파. 예전엔 BOS로 넘겼다
  //   L90 → H110 → L95 → H120  : H120이 구조 고점 110을 처음 돌파
  const r = deriveStructure([L(1, 90), H(2, 110), L(3, 95), H(4, 120)]);
  assert.equal(r.chochs.length, 1, `개수: ${r.chochs.length}`);
  assert.equal(r.chochs[0].dir, "bull");
  assert.equal(r.chochs[0].price, 110, "돌파당한 구조 고점이 레벨이다");
});

test("같은 방향으로 또 돌파하면 BOS다 — CHoCH를 찍지 않는다 (284761f 회귀)", () => {
  //   … H120(CHoCH) → L100 → H130 : 이미 상승인데 또 고점 돌파 = BOS
  const r = deriveStructure([L(1, 90), H(2, 110), L(3, 95), H(4, 120), L(5, 100), H(6, 130)]);
  assert.equal(r.chochs.length, 1, `BOS를 CHoCH로 셌다: ${dirs(r)}`);
  assert.equal(r.chochs[0].dir, "bull");
});

test("추세가 뒤집히면 다시 CHoCH다", () => {
  //   상승(H120) → 그 뒤 구조 저점 95를 하향 돌파 → bear CHoCH
  const r = deriveStructure([
    L(1, 90), H(2, 110), L(3, 95), H(4, 120),   // bull CHoCH
    L(5, 90),                                    // 구조 저점 95 하향 돌파 → bear CHoCH
  ]);
  assert.deepEqual(dirs(r), ["bull", "bear"]);
});

test("돌파하지 못하면 아무것도 없다", () => {
  //   고점이 계속 낮아지고 저점도 안 깨면 CHoCH가 없다
  const r = deriveStructure([L(1, 90), H(2, 110), L(3, 95), H(4, 105)]);
  assert.deepEqual(r.chochs, [], `${dirs(r)}`);
});

test("가로선 끝(toT)은 **레그 선분과 레벨의 교차점**이다", () => {
  // ⚠ 실제로 뚫은 봉이 아니다 — 그러면 가로선이 지그재그를 지나 삐져나온다
  //   (2026-08-12 사용자 지적). structureZigzag의 crossIdx와 같은 규칙
  const r = deriveStructure([L(1, 90), H(2, 110), L(3, 95), H(4, 120)]);
  const c = r.chochs[0];
  // 레그 L95(t=3) → H120(t=4)에서 레벨 110을 지나는 지점 = 3 + (110-95)/(120-95) = 3.6
  assert.ok(Math.abs(c.toT - 3.6) < 1e-9, `toT=${c.toT} (3.6이어야 한다)`);
  // 정의상 두 꼭짓점 **사이**에 들어간다 → 삐져나오지 않는다
  assert.ok(c.toT >= 3 && c.toT <= 4);
});

test("레벨이 정확히 꼭짓점 값이면 교차점이 끝점이다", () => {
  const r = deriveStructure([L(1, 90), H(2, 110), L(3, 95), H(4, 110.0001)]);
  const c = r.chochs[0];
  assert.ok(c.toT >= 3 && c.toT <= 4, `toT=${c.toT}`);
});

test("숏 방향도 대칭이다", () => {
  //   H110 → L90 → H100 → L85 : L85가 구조 저점 90을 처음 하향 돌파
  const r = deriveStructure([H(1, 110), L(2, 90), H(3, 100), L(4, 85)]);
  assert.equal(r.chochs.length, 1);
  assert.equal(r.chochs[0].dir, "bear");
  assert.equal(r.chochs[0].price, 90);
});

test("긴 구조에서 CHoCH는 방향이 바뀔 때만 늘어난다", () => {
  // 상승 → 하락 → 상승 : bull, bear, bull 세 번
  const pts = [
    L(1, 90), H(2, 110), L(3, 95), H(4, 120),   // bull
    L(5, 90),                                    // bear
    H(6, 125),                                   // bull (구조 고점 120 돌파)
  ];
  assert.deepEqual(dirs(deriveStructure(pts)), ["bull", "bear", "bull"]);
});
