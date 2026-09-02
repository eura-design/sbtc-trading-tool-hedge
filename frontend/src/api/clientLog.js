import { API_BASE } from "../constants.js";   // node로 검산하기 위해 확장자를 붙인다

/**
 * 화면에서 일어난 일을 백엔드 로그로 보낸다 (2026-08-25).
 *
 * 왜 필요한가 — 백엔드 로그만으로는 **"왜 이 주문이 나갔나"의 절반을 못 본다.**
 * 거래소에 닿기 전에 막힌 것(일일 한도·리플레이 가드·수량 계산 실패)과
 * 프론트에서 터진 예외는 백엔드에 흔적이 아예 없다.
 *
 * ⚠ **범위를 좁게 유지할 것.** 클릭·마우스·렌더·지표 토글까지 보내면
 *   소음이 백엔드 로그를 덮어서, 정작 사고를 찾을 때 못 찾는다.
 *   지금 보내는 것은 셋뿐이다:
 *     ① 상태를 바꾸는 API 요청과 그 결과 (GET 제외)
 *     ② 잡히지 않은 예외 / 거부된 Promise
 *     ③ 실거래 ↔ 연습 모드 전환 ("그때 연습 중이었나"가 자주 답이다)
 *
 * ⚠ **절대 예외를 던지지 않는다.** 로그가 화면을 망가뜨리면 안 된다 —
 *   전송 실패는 조용히 버린다 (백엔드가 꺼져 있을 때가 그렇다)
 *
 * ⚠ **모아서 보낸다.** 한 건마다 요청하면 주문 한 번에 fetch가 두 번이 된다
 */

// 페이지를 새로 열 때마다 새 id — 한 세션의 흐름을 묶는 열쇠
const SESSION = Math.random().toString(16).slice(2, 10);

const MAX_QUEUE = 100;   // 백엔드가 꺼져 있어도 메모리가 무한히 늘지 않게
const FLUSH_MS  = 2000;

let queue   = [];
let timer   = null;
let enabled = true;

function flush() {
  timer = null;
  if (!queue.length || !enabled) return;
  const batch = queue;
  queue = [];
  // ⚠ `api()`를 쓰지 않는다 — 저건 리플레이 가드에 걸리고, 실패 시 던진다.
  //   로그는 연습 중에도 남아야 하고(그때 뭘 했는지가 궁금한 경우가 많다)
  //   실패해도 조용해야 한다
  fetch(`${API_BASE}/api/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: SESSION, events: batch }),
    keepalive: true,   // 탭을 닫는 중에도 보내진다
  }).catch(() => { /* 백엔드가 꺼져 있으면 그냥 버린다 */ });
}

/** 이벤트 한 건 적재 — 즉시 보내지 않고 모았다가 2초 뒤에 보낸다 */
export function clientLog(event, fields = {}) {
  try {
    if (!enabled) return;
    if (queue.length >= MAX_QUEUE) queue.shift();   // 오래된 것부터 버린다
    queue.push({ ts: Date.now(), event, ...fields });
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  } catch { /* 로그가 화면을 망가뜨리면 안 된다 */ }
}

/** 탭을 닫거나 숨길 때 남은 것을 흘려보낸다 — 안 하면 마지막 동작이 유실된다 */
export function installClientLog() {
  try {
    window.addEventListener("error", (e) => {
      clientLog("CLIENT_ERROR", {
        level: "error",
        msg: String(e.message || e.error || "unknown"),
        src: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null,
      });
    });
    window.addEventListener("unhandledrejection", (e) => {
      clientLog("CLIENT_ERROR", {
        level: "error",
        msg: String(e.reason?.message || e.reason || "unhandledrejection"),
        src: null,
      });
    });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  } catch {}
}

export { SESSION as LOG_SESSION };
