// RSI 순수 계산 (Wilder's Smoothing)
//
// ⚠ 여기서 지키려는 것은 **두 경로가 같은 답을 내는가**다.
//   화면의 RSI 선은 `useRSI`가 `buildRSIState`로 전체를 다시 돌려 그리고,
//   과매수·과매도 알림은 `useAlertMonitor`가 `tickRSI`로 한 틱씩 굴려 판정한다.
//   둘이 갈리면 **차트에 68이 떠 있는데 70 알림이 울린다.**

import test from "node:test";
import assert from "node:assert/strict";
import { toRsi, buildRSIState, tickRSI } from "../src/utils/rsi.js";

const P = 14;
const bars = (closes) => closes.map((c, i) => ({ t: i * 60000, c }));

// 값이 아니라 **모양**을 만든다 — 오르내림이 섞여야 ag·al 둘 다 0이 아니다
function walk(n, seed = 1) {
  const out = [];
  let x = 100, s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;   // 재현 가능한 난수
    x += ((s % 200) - 100) / 100;
    out.push(x);
  }
  return out;
}

test("toRsi — 손실이 없으면 100이다 (0으로 나누지 않는다)", () => {
  assert.equal(toRsi(1, 0), 100);
  assert.equal(toRsi(0, 0), 100);   // 움직임이 없는 구간도 여기로 온다
});

test("toRsi — 상승이 없으면 0이다", () => {
  assert.equal(toRsi(0, 1), 0);
});

test("toRsi — 상승과 하락이 같으면 50이다", () => {
  assert.equal(toRsi(2, 2), 50);
});

test("buildRSIState — 캔들이 period+1개보다 적으면 null이다", () => {
  assert.equal(buildRSIState(bars(walk(P)), P), null);        // 14개 = 변화 13개
  assert.notEqual(buildRSIState(bars(walk(P + 1)), P), null);  // 15개 = 변화 14개
});

test("계속 오르기만 하면 100, 계속 내리기만 하면 0이다", () => {
  const up   = bars(Array.from({ length: 40 }, (_, i) => 100 + i));
  const down = bars(Array.from({ length: 40 }, (_, i) => 100 - i));
  assert.equal(buildRSIState(up,   P).rsi, 100);
  assert.equal(buildRSIState(down, P).rsi, 0);
});

test("RSI는 언제나 0~100 안에 있다", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const st = buildRSIState(bars(walk(60, seed)), P);
    assert.ok(st.rsi >= 0 && st.rsi <= 100, `seed=${seed} rsi=${st.rsi}`);
  }
});

// ── 여기가 이 파일의 본론 ──────────────────────────────────────────────────
test("한 틱 굴린 값과 전체를 다시 돌린 값이 같다 (차트와 알림이 갈리지 않는다)", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const closes = walk(60, seed);
    const last   = closes[closes.length - 1];

    // ① 알림 경로: 마지막 봉을 뺀 상태에서 그 봉 하나를 굴린다
    const prev = buildRSIState(bars(closes.slice(0, -1)), P);
    const byTick = tickRSI(prev, closes[closes.length - 2], last, P);

    // ② 화면 경로: 마지막 봉까지 포함해 전체를 다시 돈다
    const byBuild = buildRSIState(bars(closes), P).rsi;

    assert.ok(Math.abs(byTick - byBuild) < 1e-9,
      `seed=${seed}  tick=${byTick}  build=${byBuild}`);
  }
});

test("tickRSI — 상태가 없으면 null이다 (캔들이 모자란 구간)", () => {
  assert.equal(tickRSI(null, 100, 101, P), null);
});

test("tickRSI는 상태를 바꾸지 않는다 — 같은 틱을 두 번 넣어도 답이 같다", () => {
  const st = buildRSIState(bars(walk(60, 7)), P);
  const before = { ...st };
  const a = tickRSI(st, 100, 101, P);
  const b = tickRSI(st, 100, 101, P);
  assert.equal(a, b);
  assert.deepEqual({ ...st }, before);
});
