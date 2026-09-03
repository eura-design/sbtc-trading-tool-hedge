// 자동 ZZ와 수동 구조가 **같은 CHoCH 규칙**을 쓰는가
//
// ⚠ CLAUDE.md: "한쪽만 되돌리면 같은 차트에서 지표끼리, 또 트레이딩뷰와 결과가 어긋난다".
//   규칙이 두 벌인 이유는 계산 구조가 다르기 때문이다 —
//   자동 ZZ는 캔들에서 꼭짓점을 **찾아가며** forward-only로 누적하고,
//   수동 구조는 사용자가 찍은 꼭짓점을 받아 **매번 전체 재계산**한다.
//   그래서 코드를 나눠 쓸 수 없고, 대신 **같은 꼭짓점을 주면 같은 답**이 나와야 한다.
//
// 이 파일은 그 계약을 지킨다: 꼭짓점 배열을 만들어 두 구현에 각각 먹이고
// CHoCH의 **방향과 레벨**이 일치하는지 본다.

import test from "node:test";
import assert from "node:assert/strict";
import { deriveStructure } from "../src/chart/deriveStructure.js";
import { computeStructureZigzag, dropZzSlot } from "../src/chart/structureZigzag.js";

const H = (t, p) => ({ t, p, type: "H" });
const L = (t, p) => ({ t, p, type: "L" });

/**
 * 꼭짓점 배열을 **자동 ZZ가 그대로 집어낼 캔들**로 바꾼다.
 * 꼭짓점 사이를 평평하게 채우고, 꼭짓점 봉만 뾰족하게 만든다.
 * ⚠ 노이즈 필터를 끄고(use_filter:false) left_bars를 작게 잡아, 두 구현이
 *   **같은 꼭짓점 집합**을 보게 한다 — 그래야 규칙만 견줄 수 있다
 */
function candlesFor(points, pad = 4) {
  const out = [];
  let t = 0;
  const flat = (p) => out.push({ t: t++, o: p, h: p, l: p, c: p });
  for (let i = 0; i < points.length; i++) {
    for (let k = 0; k < pad; k++) flat(points[i].p + (points[i].type === "H" ? -5 : 5));
    const p = points[i];
    out.push({ t: t++, o: p.p, h: p.p, l: p.p, c: p.p });
  }
  for (let k = 0; k < pad; k++) flat(points[points.length - 1].p);
  return out;
}

const PARAMS = { left_bars: 2, use_filter: false, atr_mult: 0, atr_period: 14 };

/** 두 구현의 CHoCH를 `방향@레벨` 문자열로 뽑아 견준다 */
function compare(points, slot) {
  const manual = deriveStructure(points).chochs
    .map(c => `${c.dir}@${c.price}`);
  dropZzSlot(slot);
  const auto = computeStructureZigzag(candlesFor(points), PARAMS, slot).chochs
    .map(c => `${c.dir}@${c.price}`);
  dropZzSlot(slot);
  return { manual, auto };
}

test("첫 돌파도 CHoCH — 두 구현이 같다", () => {
  const pts = [L(1, 90), H(2, 110), L(3, 95), H(4, 120)];
  const { manual, auto } = compare(pts, "t:first");
  assert.deepEqual(manual, ["bull@110"]);
  assert.deepEqual(auto, manual, `자동 ${auto} ≠ 수동 ${manual}`);
});

test("같은 방향 재돌파는 BOS — 두 구현이 같다", () => {
  const pts = [L(1, 90), H(2, 110), L(3, 95), H(4, 120), L(5, 100), H(6, 130)];
  const { manual, auto } = compare(pts, "t:bos");
  assert.deepEqual(manual, ["bull@110"], "수동이 BOS를 CHoCH로 셌다");
  assert.deepEqual(auto, manual, `자동 ${auto} ≠ 수동 ${manual}`);
});

test("추세 전환 — 두 구현이 같다", () => {
  const pts = [L(1, 90), H(2, 110), L(3, 95), H(4, 120), L(5, 90)];
  const { manual, auto } = compare(pts, "t:flip");
  assert.deepEqual(manual, ["bull@110", "bear@95"]);
  assert.deepEqual(auto, manual, `자동 ${auto} ≠ 수동 ${manual}`);
});

test("돌파가 없으면 둘 다 비어 있다", () => {
  const pts = [L(1, 90), H(2, 110), L(3, 95), H(4, 105)];
  const { manual, auto } = compare(pts, "t:none");
  assert.deepEqual(manual, []);
  assert.deepEqual(auto, []);
});

test("숏 방향도 두 구현이 같다", () => {
  const pts = [H(1, 110), L(2, 90), H(3, 100), L(4, 85)];
  const { manual, auto } = compare(pts, "t:bear");
  assert.deepEqual(manual, ["bear@90"]);
  assert.deepEqual(auto, manual, `자동 ${auto} ≠ 수동 ${manual}`);
});
