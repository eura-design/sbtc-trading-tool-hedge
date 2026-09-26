// 없어진 기능이 브라우저에 남긴 찌꺼기를 지우는 규칙 — `utils/deadStorage.js`
//
// ⚠ 이 정리는 **사용자 설정을 지운다.** 틀리면 살아 있는 설정이 새로고침마다 사라진다.
//   그래서 `main.jsx`가 쓰는 함수를 **여기서 직접 불러** 시험한다 (규칙을 복제하지 않는다).
//
// 살아 있는 지표 이름의 정본은 `components/IndicatorMenu.jsx`의 `INDICATORS`다.
//   ※ `.jsx`를 node가 직접 읽을 수 없어서 파일을 **텍스트로 읽어** key만 뽑는다.
//     그래도 "목록이 코드와 갈리지 않는가"는 지켜진다

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { keepOnly, withoutFields, withoutFieldsInList } from "../src/utils/deadStorage.js";

/** IndicatorMenu.jsx의 INDICATORS에서 key만 뽑는다 */
function liveKeys() {
  const src = fs.readFileSync("src/components/IndicatorMenu.jsx", "utf-8");
  const block = src.slice(src.indexOf("export const INDICATORS = ["));
  const body = block.slice(0, block.indexOf("];"));
  return [...body.matchAll(/key:\s*["'`]([a-z]+)["'`]/g)].map(m => m[1]);
}

// ── keepOnly — `indicators`처럼 키 자체가 기능 이름일 때 ────────────────────
test("살아 있는 지표 목록을 읽어낸다", () => {
  const live = liveKeys();
  assert.ok(live.length >= 6, `목록을 못 읽었다 (${live.length}개) — INDICATORS 모양이 바뀌었는지 볼 것`);
  for (const k of ["vol", "rsi", "zz", "struct"]) assert.ok(live.includes(k), `${k}가 목록에 없다`);
});

test("⚠ keepOnly — 살아 있는 키는 하나도 지우지 않는다", () => {
  const live = liveKeys();
  const saved = Object.fromEntries(live.map(k => [k, true]));
  const { value, changed } = keepOnly(saved, live);
  assert.equal(changed, false, "지울 것이 없는데 바뀐 것으로 봤다 (쓸데없이 저장한다)");
  assert.deepEqual(Object.keys(value).sort(), live.slice().sort(),
    "살아 있는 지표의 on/off가 지워졌다 — 새로고침마다 설정이 사라진다");
});

test("keepOnly — 없어진 지표의 키만 지운다", () => {
  const live = liveKeys();
  // 실제로 남아 있던 찌꺼기 6개 (없어진 때는 main.jsx 주석 참고)
  const dead = ["fib", "sr", "div", "ms", "chocho", "rsidiv"];
  for (const k of dead) assert.ok(!live.includes(k), `${k}가 아직 살아 있는 목록에 있다`);

  const saved = { ...Object.fromEntries(live.map(k => [k, false])),
                  ...Object.fromEntries(dead.map(k => [k, true])) };
  const { value, changed } = keepOnly(saved, live);
  assert.equal(changed, true);
  for (const k of dead) assert.ok(!(k in value), `${k}가 안 지워졌다`);
  assert.equal(Object.keys(value).length, live.length);
});

test("keepOnly — 값(true/false)은 그대로 남는다. 지우는 건 이름뿐이다", () => {
  const live = liveKeys();
  const { value } = keepOnly({ [live[0]]: false, [live[1]]: true, chocho: true }, live);
  assert.equal(value[live[0]], false, "꺼둔 지표가 켜졌다");
  assert.equal(value[live[1]], true);
});

test("keepOnly — 빈 객체·null도 터지지 않는다", () => {
  const live = liveKeys();
  assert.deepEqual(keepOnly({}, live), { value: {}, changed: false });
  assert.deepEqual(keepOnly(null, live), { value: {}, changed: false });
});

// ── withoutFields — 기능 하나가 없어졌을 때 (`zz.show_legvol`) ──────────────
test("withoutFields — 지정한 필드만 뺀다", () => {
  const zz = { left_bars: 2, atr_mult: 1, show_legvol: true, opacity: 0.3 };
  const { value, changed } = withoutFields(zz, ["show_legvol"]);
  assert.equal(changed, true);
  assert.deepEqual(value, { left_bars: 2, atr_mult: 1, opacity: 0.3 },
    "다른 지표 파라미터가 같이 날아갔다");
});

test("withoutFields — 없으면 바뀐 것으로 보지 않는다 (두 번 돌아도 안전)", () => {
  const zz = { left_bars: 2, opacity: 0.3 };
  const { value, changed } = withoutFields(zz, ["show_legvol"]);
  assert.equal(changed, false, "지울 것이 없는데 저장하려 한다");
  assert.deepEqual(value, zz);
});

test("withoutFields — 객체가 아니면 그대로 돌려준다", () => {
  assert.deepEqual(withoutFields(null, ["x"]), { value: null, changed: false });
  assert.deepEqual(withoutFields(7, ["x"]), { value: 7, changed: false });
});

// ── withoutFieldsInList — `structures[].showLegVol` ────────────────────────
test("withoutFieldsInList — 각 구조에서 필드를 뺀다", () => {
  const list = [
    { id: 1, points: [1, 2], showLegVol: true, opacity: 0.3 },
    { id: 2, points: [3], alertChoch: true },
  ];
  const { value, changed } = withoutFieldsInList(list, ["showLegVol"]);
  assert.equal(changed, true);
  assert.deepEqual(value[0], { id: 1, points: [1, 2], opacity: 0.3 });
  assert.deepEqual(value[1], list[1], "찌꺼기가 없는 구조는 그대로여야 한다");
  assert.equal(value[1], list[1], "안 바뀐 원소는 새 객체를 만들지 않는다");
});

test("withoutFieldsInList — 배열이 아니면 그대로 (키가 없거나 깨진 경우)", () => {
  assert.deepEqual(withoutFieldsInList(null, ["x"]), { value: null, changed: false });
  assert.deepEqual(withoutFieldsInList({ a: 1 }, ["x"]), { value: { a: 1 }, changed: false });
});

test("withoutFieldsInList — 지울 것이 없으면 changed가 false다", () => {
  const list = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(withoutFieldsInList(list, ["showLegVol"]), { value: list, changed: false });
});
