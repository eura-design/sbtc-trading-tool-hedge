// `indicators`에 남은 **없어진 지표의 on/off**를 골라 지우는 규칙 (2026-09-26)
//
// ⚠ 이 정리는 사용자 설정을 지운다. 틀리면 **살아 있는 지표의 on/off가 새로고침마다
//   사라진다** — 목록에 없는 이름으로 보이기 때문이다. 그래서 규칙을 따로 검산한다.
//
// 정본은 `components/IndicatorMenu.jsx`의 `INDICATORS`다. 여기서 그 목록을 **직접 불러**
// 쓰므로, 지표를 추가·제거하면 이 테스트가 자동으로 새 목록을 본다.
//   ※ `.jsx`를 node가 직접 읽을 수 없어서(JSX 문법) 파일을 **텍스트로 읽어** key만 뽑는다.
//     그 대신 "목록이 코드와 갈리지 않는가"는 지켜진다

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/** IndicatorMenu.jsx의 INDICATORS에서 key만 뽑는다 (정본을 복제하지 않기 위해) */
function liveKeys() {
  const src = fs.readFileSync("src/components/IndicatorMenu.jsx", "utf-8");
  const block = src.slice(src.indexOf("export const INDICATORS = ["));
  const body = block.slice(0, block.indexOf("];"));
  return [...body.matchAll(/key:\s*["'`]([a-z]+)["'`]/g)].map(m => m[1]);
}

/** main.jsx가 쓰는 규칙과 **같은 식** — 목록에 있는 이름만 남긴다 */
function prune(saved, live) {
  const keep = new Set(live);
  return Object.fromEntries(Object.entries(saved).filter(([k]) => keep.has(k)));
}

test("살아 있는 지표 목록을 읽어낸다", () => {
  const live = liveKeys();
  assert.ok(live.length >= 6, `목록을 못 읽었다 (${live.length}개) — INDICATORS 모양이 바뀌었는지 볼 것`);
  // 2026-09-26 기준 8개. 지표를 늘리면 이 줄이 아니라 아래 테스트들이 지켜준다
  for (const k of ["vol", "rsi", "zz", "struct"]) assert.ok(live.includes(k), `${k}가 목록에 없다`);
});

test("⚠ 살아 있는 키는 하나도 지우지 않는다", () => {
  const live = liveKeys();
  // 전부 켜둔 상태를 흉내낸다
  const saved = Object.fromEntries(live.map(k => [k, true]));
  const kept = prune(saved, live);
  assert.deepEqual(Object.keys(kept).sort(), live.slice().sort(),
    "살아 있는 지표의 on/off가 지워졌다 — 새로고침마다 설정이 사라진다");
});

test("없어진 지표의 키만 지운다", () => {
  const live = liveKeys();
  // 실제로 남아 있던 찌꺼기 6개 (없어진 때는 main.jsx 주석 참고)
  const dead = ["fib", "sr", "div", "ms", "chocho", "rsidiv"];
  for (const k of dead) assert.ok(!live.includes(k), `${k}가 아직 살아 있는 목록에 있다`);

  const saved = { ...Object.fromEntries(live.map(k => [k, false])),
                  ...Object.fromEntries(dead.map(k => [k, true])) };
  const kept = prune(saved, live);
  for (const k of dead) assert.ok(!(k in kept), `${k}가 안 지워졌다`);
  assert.equal(Object.keys(kept).length, live.length);
});

test("값(true/false)은 그대로 남는다 — 지우는 건 이름뿐이다", () => {
  const live = liveKeys();
  const saved = { [live[0]]: false, [live[1]]: true, chocho: true };
  const kept = prune(saved, live);
  assert.equal(kept[live[0]], false, "꺼둔 지표가 켜졌다");
  assert.equal(kept[live[1]], true);
});

test("빈 객체·찌꺼기 없음도 터지지 않는다", () => {
  const live = liveKeys();
  assert.deepEqual(prune({}, live), {});
  const clean = { vol: false };
  assert.deepEqual(prune(clean, live), clean, "지울 것이 없으면 그대로여야 한다");
});
