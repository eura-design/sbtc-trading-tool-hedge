// 리플레이 시작 날짜를 상장일로 밀어 올리기
//
// ⚠ `replay_start_ms`는 **심볼별이 아니라 하나뿐이다.** 저장된 값이 그 코인의
//   상장일보다 앞서면, 바이낸스는 빈 배열이 아니라 **가장 이른 캔들**을 준다 —
//   시계는 2021년인데 화면은 2023년 캔들이 되어 **조용히 어긋난다**.
//   실측(2026-09-03): 저장값 2021-01-16에서 1000BONK는 1040일, 1000FLOKI는 840일 차이.
//   거래 가능한 526개 중 470개(89%)가 이 상황이었다.

import test from "node:test";
import assert from "node:assert/strict";
import { clampToListing, sessionEnd, SESSION_MAX_MS } from "../src/store/replaySlice.js";

const BTC   = Date.UTC(2019, 8,  8);   // 2019-09-08
const DOGE  = Date.UTC(2020, 6, 10);   // 2020-07-10
const BONK  = Date.UTC(2023, 10, 22);  // 2023-11-22
const STORED = Date.UTC(2021, 0, 16);  // 실제로 저장돼 있던 값

test("상장 전 날짜는 상장일로 밀어 올린다", () => {
  assert.equal(clampToListing(STORED, BONK), BONK, "상장 전인데 그대로 갔다");
  assert.equal(clampToListing(BTC, DOGE), DOGE);
});

test("상장 이후 날짜는 그대로 둔다", () => {
  assert.equal(clampToListing(STORED, BTC),  STORED, "멀쩡한 날짜를 옮겼다");
  assert.equal(clampToListing(STORED, DOGE), STORED);
  assert.equal(clampToListing(BONK, BONK),   BONK, "상장일 당일은 그대로여야 한다");
});

test("상장일을 아직 못 받았으면 **손대지 않는다**", () => {
  // ⚠ 모르면서 옮기는 것보다 그대로 두는 쪽이 맞다.
  //   값은 useSymbolFilters가 exchangeInfo에서 받아 준다 (처음 몇 프레임은 null)
  for (const unknown of [null, undefined, 0, NaN]) {
    assert.equal(clampToListing(STORED, unknown), STORED, `onboardMs=${unknown}에서 옮겼다`);
  }
});

test("시작 시각이 없으면 그대로 돌려준다 (그때는 부르는 쪽이 채운다)", () => {
  for (const empty of [null, undefined, 0]) {
    assert.equal(clampToListing(empty, BONK), empty);
  }
});

test("밀어 올린 뒤 끝 시각도 그 값에서 다시 잡힌다", () => {
  // ⚠ 옛 시작으로 끝을 잡으면 구간 전체가 그 코인이 없던 때가 된다
  const start = clampToListing(STORED, BONK);
  const end   = sessionEnd(start);
  assert.ok(end > start, "끝이 시작보다 앞이다");
  assert.ok(end - start <= SESSION_MAX_MS, "세션 상한을 넘었다");
  assert.ok(start >= BONK, "상장 전 구간이 남았다");
});

test("실제 사고 재현 — 저장값 2021-01-16 + BONK", () => {
  // 고치기 전에는 이 조합이 1040일 어긋난 캔들을 재생했다
  const start = clampToListing(STORED, BONK);
  const gapDays = Math.round((start - STORED) / 86_400_000);
  assert.equal(gapDays, 1040, `밀어 올린 폭이 다르다: ${gapDays}일`);
  assert.ok(start >= BONK);
});
