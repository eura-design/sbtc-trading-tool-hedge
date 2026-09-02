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

import { lsGet, lsRemove, lsSet } from "../utils/storage.js";
import { DEFAULT_SYMBOL } from "../constants.js";

const PREFIX = "replay_";

export const DRAWING_KEYS = ["trendLines", "trendChannels", "trendCircles", "fibs", "measures", "structures"];
// 플랜 박스는 스토어(uiSlice)가 따로 들고 있지만 **이사는 같이 간다** — 아래 migrate 참고
const BOX_KEYS = ["drawing"];

/**
 * @param base     원래 키 ("trendLines" 등)
 * @param replayOn 리플레이 모드인가
 *
 * ※ 예전엔 "기존 도형 보기"(showLive) 인자가 있어서, 켜면 실거래 키를 **읽기 전용**으로
 *   읽었다. 2026-08-15 사용자 요청으로 기능째 제거됐다 — 리플레이는 항상 연습용 키만 쓴다.
 *   되살리려면 이 인자와 `useDrawableStore`의 readOnly가 같이 필요하다
 */
// ── 심볼별 분리 (2026-09-02) ───────────────────────────────────────────────
// 도형 좌표는 timestamp라 전 TF 공유인데, **가격은 심볼마다 완전히 다르다.**
// BTC의 70,000 추세선이 ETH 차트(3,000대)에 뜨면 화면 밖 어딘가로 사라지고,
// DOGE(0.2)에서는 아예 좌표계가 다르다. 그래서 심볼이 키에 들어간다.
//
// 키 모양:  `BTCUSDT:trendLines`  /  `replay_BTCUSDT:trendLines`
// ⚠ `replay_` 접두사를 **앞에** 둔다 — 기존 규칙(연습용은 replay_로 시작)을 그대로 두면
//   "replay_로 시작하는 것이 연습용"이라는 한 줄 규칙이 계속 성립한다
export function drawingKey(base, replayOn, symbol = DEFAULT_SYMBOL) {
  return (replayOn ? PREFIX : "") + symbol + ":" + base;
}

// ── 이사 (2026-09-02) ──────────────────────────────────────────────────────
// 심볼이 키에 들어가기 전에 저장된 도형은 전부 BTCUSDT 것이다(그때는 그것만 거래했다).
// 안 옮기면 **그려둔 게 전부 사라진 것처럼 보인다.**
//
// ⚠ **옛 키를 지우지 않는다.** 복사만 한다 — 되돌릴 여지를 남기고, 브라우저 저장소
//   백업(backend/backups)에도 그대로 남아 있게 하려는 것이다. 몇 개 안 되고 작다.
// ⚠ 대상 키가 **이미 있으면 건드리지 않는다** — 두 번 돌아도 덮어쓰지 않는다.
const MIGRATED_FLAG = "drawingsSymbolScoped";

export function migrateDrawingsToSymbol(symbol = DEFAULT_SYMBOL) {
  if (lsGet(MIGRATED_FLAG)) return 0;
  let moved = 0;
  for (const base of [...DRAWING_KEYS, ...BOX_KEYS]) {
    for (const replayOn of [false, true]) {
      const from = (replayOn ? PREFIX : "") + base;          // 옛 키
      const to   = drawingKey(base, replayOn, symbol);        // 새 키
      const v = lsGet(from);
      if (v == null || lsGet(to) != null) continue;
      lsSet(to, v);
      moved++;
    }
  }
  lsSet(MIGRATED_FLAG, String(Date.now()));
  return moved;
}

// ⚠ **심볼을 가리지 않고 전부 지운다.** `성적 초기화`는 "연습 흔적을 없앤다"는 뜻이라,
//   지금 보고 있는 심볼만 지우면 다른 코인에서 연습한 선이 남아 있다가 나중에 튀어나온다
export function clearReplayDrawings() {
  for (const k of replayDrawingKeys()) lsRemove(k);
}

export function hasReplayDrawings() {
  return replayDrawingKeys().some(k => {
    try { return JSON.parse(lsGet(k) || "[]").length > 0; }
    catch { return false; }
  });
}

/** localStorage에 실제로 있는 연습용 도형 키 — 심볼을 모르므로 훑어서 찾는다 */
function replayDrawingKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const base = k.slice(k.indexOf(":") + 1);
      if (k.includes(":") && DRAWING_KEYS.includes(base)) out.push(k);
      // 심볼이 붙기 전(2026-09-02 이전)의 키도 같이 치운다
      else if (!k.includes(":") && DRAWING_KEYS.includes(k.slice(PREFIX.length))) out.push(k);
    }
  } catch { /* 저장소를 못 읽어도 초기화가 죽으면 안 된다 */ }
  return out;
}
