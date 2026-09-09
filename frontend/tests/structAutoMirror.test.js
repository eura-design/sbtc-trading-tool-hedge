// 자동 이어그리기(파란 점선)가 **자동 ZZ 지표와 같은 꼭짓점**을 찍는가
//
// 사용자 요구사항(2026-09-09): "내가 찍은 지점까지는 수동이고 그 이후는 자동구조의
// 알고리즘대로. 내가 찍은 지점들이 자동구조와 동일한 경우에는 결과값이 같아야 한다."
//
// 그래서 이 파일은 그 조건을 그대로 시험한다:
//   자동 ZZ가 찾아낸 꼭짓점을 **사용자가 찍은 점으로 놓고**, 그 뒤를 autoPivotsAfter가
//   이었을 때 자동 ZZ의 나머지 꼭짓점과 한 글자도 다르지 않아야 한다.
//
// ⚠ **마지막 봉(진행 중 봉)까지 포함해서 본다.** 2026-09-09 전에는 autoPivotsAfter가
//   그 봉을 빼고(`end = candles.length - 2`) 대신 "잠정 꼭짓점"을 하나 붙였는데,
//   그 점이 자동 ZZ에는 없어서 두 지표의 답이 갈렸다 (실측 429가지 중 387가지 불일치).
//   이 파일이 막는 것이 그 재발이다.

import test from "node:test";
import assert from "node:assert/strict";
import { computeStructureZigzag, dropZzSlot } from "../src/chart/structureZigzag.js";
import { autoPivotsAfter } from "../src/chart/structAutoPivots.js";
import { deriveStructure } from "../src/chart/deriveStructure.js";

const BAR_MS = 4 * 60 * 60 * 1000;

/** 씨앗 고정 난수 — 테스트가 돌 때마다 같은 캔들이 나와야 한다 */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** 무작위 걷기 캔들 (t는 밀리초, 값은 실제 가격대와 비슷한 자릿수) */
function walk(n, seed) {
  const rnd = lcg(seed);
  const out = [];
  let price = 60000;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = o * (1 + (rnd() - 0.5) * 0.03);
    const h = Math.max(o, c) * (1 + rnd() * 0.012);
    const l = Math.min(o, c) * (1 - rnd() * 0.012);
    out.push({ t: i * BAR_MS, o, h, l, c });
    price = c;
  }
  return out;
}

/**
 * 자동 ZZ가 찾은 꼭짓점 목록 `[{ t, p, type }]`.
 * 세그먼트는 꼭짓점을 이은 것이라 [첫 세그먼트의 시작점, 각 세그먼트의 끝점]이 곧 꼭짓점이고,
 * 지그재그는 고/저가 교대하므로 첫 두 점의 대소만 보면 나머지 타입이 정해진다.
 */
function zzPivots(candles, params, slot) {
  dropZzSlot(slot);
  const { segments } = computeStructureZigzag(candles, params, slot);
  dropZzSlot(slot);
  if (!segments.length) return [];
  const raw = [{ i: segments[0].i1, p: segments[0].p1 },
               ...segments.map(s => ({ i: s.i2, p: s.p2 }))];
  const firstIsLow = raw[1].p > raw[0].p;
  return raw.map((q, k) => ({
    t: +candles[q.i].t, p: q.p,
    type: (k % 2 === 0) === firstIsLow ? "L" : "H",
  }));
}

const key = pts => pts.map(q => `${q.type}${q.p}@${q.t}`).join("|");

test("자동 ZZ의 꼭짓점을 사용자 점으로 놓으면, 그 뒤도 자동 ZZ와 같은 꼭짓점이 나온다", () => {
  const params = { left_bars: 2, use_filter: true, atr_mult: 1.0, atr_period: 14 };
  let checked = 0;

  for (const seed of [1, 7, 42, 2026]) {
    const full = walk(600, seed);
    // 진행 중 봉의 자리를 옮겨가며 본다 — 마지막 봉을 어떻게 다루는가가 이 시험의 핵심이다
    for (let end = 400; end < full.length; end += 37) {
      const candles = full.slice(0, end + 1);
      const pv = zzPivots(candles, params, `m:${seed}:${end}`);
      if (pv.length < 8) continue;

      // 사용자 마지막 점의 위치도 여러 곳에서 — 끝 가까이일수록 진행 중 봉과 겹친다
      for (const j of [pv.length - 2, pv.length - 3, pv.length - 5, pv.length - 8]) {
        if (j < 2) continue;
        checked++;
        const got = autoPivotsAfter(pv.slice(0, j + 1), candles, params);
        assert.equal(
          key(got), key(pv.slice(j + 1)),
          `seed=${seed} end=${end} j=${j} — 자동 이어그리기가 자동 ZZ와 다른 꼭짓점을 찍었다`,
        );
      }
    }
  }
  assert.ok(checked >= 50, `시험한 경우가 ${checked}가지뿐이다 — 캔들 생성이 바뀌었는지 볼 것`);
});

test("노이즈 필터를 꺼도 같다", () => {
  const params = { left_bars: 3, use_filter: false, atr_mult: 0, atr_period: 14 };
  const full = walk(400, 99);
  const pv = zzPivots(full, params, "m:nofilter");
  assert.ok(pv.length >= 8, "꼭짓점이 너무 적다");
  for (const j of [pv.length - 2, pv.length - 4, Math.floor(pv.length / 2)]) {
    const got = autoPivotsAfter(pv.slice(0, j + 1), full, params);
    assert.equal(key(got), key(pv.slice(j + 1)), `j=${j}`);
  }
});

// ── 신고된 그 장면 (2026-09-09, BTCUSDT 4시간) ──────────────────────────────
// 사용자 마지막 점이 고점이고, **진행 중 봉이 그보다 높은 고가**를 만들어 구조 고점을
// 돌파한 상황이다. 자동 ZZ는 그 자리에서 bull CHoCH를 찍었는데 수동 구조는 찍지 않았다.
//
// 옛 동작: 진행 중 봉을 빼고 "잠정 꼭짓점"을 붙이는데 그 타입이 직전 점의 반대로
//          고정돼 있어, 고점 다음에는 **무조건 저점**이 붙었다. 그래서 진행 중 봉의
//          고가는 구조에 들어오지 못하고 저가만 들어왔다 → 돌파 자체가 없던 일이 됐다.
test("진행 중 봉이 같은 방향으로 새 고점을 만들면 그 돌파가 구조에 들어온다", () => {
  const params = { left_bars: 2, use_filter: false, atr_mult: 0, atr_period: 14 };

  // 평평한 바탕에 꼭짓점만 뾰족하게 (chochMirror.test.js의 candlesFor와 같은 방식)
  const c = [];
  const flat = (p) => c.push({ t: c.length * BAR_MS, o: p, h: p, l: p, c: p });
  const spike = (h, l) => c.push({ t: c.length * BAR_MS, o: (h + l) / 2, h, l, c: (h + l) / 2 });

  for (let k = 0; k < 4; k++) flat(100);
  spike(120, 100);                    // H 120
  for (let k = 0; k < 3; k++) flat(105);
  spike(105, 80);                     // L 80
  for (let k = 0; k < 3; k++) flat(95);
  spike(110, 95);                     // H 110  ← 사용자 마지막 점. 이게 구조 고점이 된다
  for (let k = 0; k < 3; k++) flat(100);
  spike(100, 70);                     // L 70   (구조 저점 80을 깬다 = bear CHoCH)
  for (let k = 0; k < 3; k++) flat(90);
  spike(100, 90);                     // H 100  ← 자동이 찾은 고점. 110을 못 넘어 아직 CHoCH 아님
  for (let k = 0; k < 3; k++) flat(95);
  spike(130, 96);                     // ← **진행 중 봉**: 위 H 100을 130으로 늘려 110을 넘는다

  const pv = zzPivots(c, params, "m:case");
  // 사용자가 찍은 점 = 자동 ZZ의 꼭짓점 중 H 110까지
  const cut = pv.findIndex(q => q.p === 110);
  assert.ok(cut > 0, "H 110 꼭짓점을 못 찾았다 — 캔들 구성이 바뀌었는지 볼 것");
  const user = pv.slice(0, cut + 1);
  assert.equal(user[user.length - 1].type, "H", "사용자 마지막 점이 고점이어야 이 장면이다");

  const auto = autoPivotsAfter(user, c, params);
  assert.equal(key(auto), key(pv.slice(cut + 1)), "자동 ZZ와 다른 꼭짓점을 찍었다");
  assert.equal(auto[auto.length - 1].p, 130, "진행 중 봉의 고가(130)가 안 들어왔다");

  // 그 꼭짓점이 들어오면 CHoCH도 따라온다 — 자동 ZZ와 같은 방향·같은 레벨이어야 한다
  const manual = deriveStructure([...user, ...auto]).chochs.map(e => `${e.dir}@${e.price}`);
  dropZzSlot("m:case2");
  const zz = computeStructureZigzag(c, params, "m:case2").chochs.map(e => `${e.dir}@${e.price}`);
  dropZzSlot("m:case2");
  assert.deepEqual(manual, zz, `수동 ${manual} ≠ 자동 ${zz}`);
  assert.ok(manual.includes("bull@110"), `구조 고점 110 돌파가 CHoCH로 안 잡혔다: ${manual}`);
});
