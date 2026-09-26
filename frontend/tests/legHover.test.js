// 레그 hover — **자동 이어그리기(하늘색 점선) 구간도 잡히는가** (2026-09-26 사용자 요청)
//
// 그전에는 `findHoveredLeg`가 `st.points`(사용자가 찍은 점)만 훑어서, 점선 구간에
// 마우스를 올려도 등락률 라벨이 뜨지 않았다. 자동 점을 사용자 점 뒤에 이어 붙여
// 같은 루프로 훑게 고쳤다.
//
// 여기서 지키는 것 셋:
//   ① 자동 구간에 마우스를 올리면 등락률이 나온다
//   ② 그 구간의 첫 레그도 **비교 대상(두 칸 앞)을 찾는다** — 배열을 따로 돌리면 못 찾는다
//   ③ ⚠ **꼭짓점 드래그·삭제 경로에는 자동 점이 섞이지 않는다.** 섞이면 사용자가 찍지도
//      않은 점을 잡아 옮기거나 지운다

import test from "node:test";
import assert from "node:assert/strict";
import {
  findHoveredLeg, structureXYs, findHitStructPointIdx,
} from "../src/chart/hitDetection.js";

// 봉 하나 = 10px, 가격 100 = y 200 (아래로 갈수록 값이 작아지는 화면 좌표)
const candles = Array.from({ length: 20 }, (_, i) => ({
  t: new Date(i * 60_000), o: 100, h: 110, l: 90, c: 100, v: 1,
}));
const xScale = idx => idx * 10;
const yScale = p => (110 - p) * 10;

const T = i => +candles[i].t;
const H = (i, p) => ({ t: T(i), p, type: "H" });
const L = (i, p) => ({ t: T(i), p, type: "L" });

// 사용자가 찍은 점 4개 = 레그 3개 (상승 · 하락 · 상승)
const st = {
  id: 1,
  points: [L(0, 100), H(4, 104), L(8, 101), H(12, 106)],
};
// 자동이 이어 붙인 점 2개 = 레그 2개 더 (하락 · 상승)
const autoChains = [{ structId: 1, points: [L(16, 102), H(19, 107)] }];

/** 두 점 사이 중간 지점의 화면 좌표 */
const midOf = (a, b) => ({
  px: (xScale(a.i) + xScale(b.i)) / 2,
  py: (yScale(a.p) + yScale(b.p)) / 2,
});
const at = (i, p) => ({ i, p });

const hover = (pos, chains = autoChains) => findHoveredLeg({
  ...pos, structures: [st], zzSegments: null,
  xScale, yScale, candles, structAutoChains: chains,
});

test("확정 레그는 예전처럼 잡힌다", () => {
  const r = hover(midOf(at(0, 100), at(4, 104)));
  assert.ok(r, "확정 레그가 안 잡혔다");
  assert.equal(r.pct.toFixed(2), "4.00", "100 → 104는 +4%");
  assert.equal(r.prev, null, "첫 상승 레그는 비교 대상이 없다 [LV7]");
});

test("① 자동 구간(점선) 레그도 잡힌다", () => {
  const r = hover(midOf(at(12, 106), at(16, 102)));
  assert.ok(r, "자동 구간 레그가 안 잡혔다 — 이게 이 파일의 본론이다");
  // 106 → 102 = -3.7735...%
  assert.equal(r.pct.toFixed(2), "-3.77");
});

test("① 자동 점끼리의 레그도 잡힌다", () => {
  const r = hover(midOf(at(16, 102), at(19, 107)));
  assert.ok(r, "자동 점 사이 레그가 안 잡혔다");
  assert.equal(r.pct.toFixed(2), "4.90");   // 102 → 107
});

test("② 자동 구간의 첫 레그도 두 칸 앞과 비교한다", () => {
  const r = hover(midOf(at(12, 106), at(16, 102)));
  // 이 레그는 합친 배열에서 k=4 (points[3]→points[4]) → 두 칸 앞은 points[1]→points[2]
  assert.ok(r.prev, "비교 대상을 못 찾았다 — 배열을 따로 돌리면 이렇게 된다");
  assert.deepEqual(r.prev, { i1: 4, i2: 8 }, "두 칸 앞 레그(H4 → L8)여야 한다");
});

test("자동 점이 없으면 예전과 똑같이 동작한다", () => {
  const r = hover(midOf(at(12, 106), at(16, 102)), []);
  assert.equal(r, null, "자동 점을 안 넘겼는데 그 구간이 잡혔다");
  assert.ok(hover(midOf(at(8, 101), at(12, 106)), []), "확정 레그는 그대로 잡혀야 한다");
});

test("structAutoChains를 아예 안 넘겨도 터지지 않는다", () => {
  const r = findHoveredLeg({
    ...midOf(at(0, 100), at(4, 104)),
    structures: [st], zzSegments: null, xScale, yScale, candles,
  });
  assert.ok(r, "인자를 생략했을 때 기본값이 안 먹었다");
});

test("다른 구조의 자동 점을 끌어오지 않는다", () => {
  const r = hover(midOf(at(12, 106), at(16, 102)), [{ structId: 999, points: [L(16, 102)] }]);
  assert.equal(r, null, "structId가 다른데 붙였다");
});

// ── ③ 읽기 전용이어야 한다 ─────────────────────────────────────────────────
test("⚠ structureXYs의 기본값은 사용자 점뿐이다 — 드래그·삭제가 자동 점을 잡으면 안 된다", () => {
  const xy = structureXYs(st, candles, xScale, yScale);
  assert.equal(xy.length, st.points.length, "기본값에 자동 점이 섞였다");

  // 꼭짓점 히트는 st.points의 인덱스를 돌려준다. 자동 점 자리를 눌러도 -1이어야 한다
  const idx = findHitStructPointIdx(st, xScale(16), yScale(102), xScale, yScale, candles);
  assert.equal(idx, -1, "자동 점이 드래그·삭제 대상으로 잡혔다");
});
