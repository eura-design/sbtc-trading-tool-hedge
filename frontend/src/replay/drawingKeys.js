// 리플레이용 도형 저장 키 — 연습용 도형을 실거래 차트와 분리한다
//
// ── 왜 분리하나 ──────────────────────────────────────────────────────────
// 도형은 좌표가 timestamp라 전 TF·전 구간에 그대로 뜬다. 그래서 리플레이를 켜면
// 예전에 그어둔 추세선이 재생 구간 위에 같이 나타난다.
//
// ⚠ **"미래 좌표만 숨기면 된다"로는 안 풀린다.** 5월 저점 두 개를 이은 선은
//   좌표가 전부 과거지만 **8월에 그은 것**이다. 그 선이 나중에 지켜졌다는 걸
//   이미 알고 그었으므로, 좌표가 과거여도 hindsight다.
//   결국 판단 기준은 좌표가 아니라 **"언제 그렸나"**이고, 실거래 모드에서 그린 것은
//   전부 재생 시점 이후에 그린 것이다. 그래서 통째로 분리한다.
//
// 반대 방향도 같이 해결된다 — 연습하다 그은 선이 실거래 차트에 남지 않는다.
//
// ── 키 이름 규칙 ─────────────────────────────────────────────────────────
// 접두사만 붙인다. 리플레이 구간(시작 날짜)별로 나누지 않는 이유는, 구간을 바꿀
// 때마다 새 키가 생겨 localStorage에 쓰레기가 쌓이고 "아까 그린 게 어디 갔나"가
// 되기 때문이다. 연습용은 한 벌이면 충분하고, 지우고 싶으면 clearReplayDrawings.

import { lsGet, lsRemove } from "../utils/storage.js";

const PREFIX = "replay_";

export const DRAWING_KEYS = ["trendLines", "trendChannels", "trendCircles", "fibs", "structures"];

/**
 * @param base     원래 키 ("trendLines" 등)
 * @param replayOn 리플레이 모드인가
 *
 * ※ 예전엔 "기존 도형 보기"(showLive) 인자가 있어서, 켜면 실거래 키를 **읽기 전용**으로
 *   읽었다. 2026-08-15 사용자 요청으로 기능째 제거됐다 — 리플레이는 항상 연습용 키만 쓴다.
 *   되살리려면 이 인자와 `useDrawableStore`의 readOnly가 같이 필요하다
 */
export function drawingKey(base, replayOn) {
  return replayOn ? PREFIX + base : base;
}

export function clearReplayDrawings() {
  for (const k of DRAWING_KEYS) lsRemove(PREFIX + k);
}

export function hasReplayDrawings() {
  return DRAWING_KEYS.some(k => {
    try { return JSON.parse(lsGet(PREFIX + k) || "[]").length > 0; }
    catch { return false; }
  });
}
