// 브라우저 저장소 감싸기 — **쓰기 실패를 놓치지 않으려고 있다** (2026-08-26)
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────────
// `localStorage.setItem`은 던진다: 용량이 찼을 때(보통 5MB), 시크릿 모드, 브라우저
// 설정이 사이트 저장을 막았을 때. 그전까지 **읽기는 전부 try/catch로 감싸져 있었는데
// 쓰기는 13곳 중 한 곳만** 감싸져 있었다.
//
// 가장 나빴던 자리는 `useDrawableStore.save` — 300ms debounce라 예외가 **setTimeout
// 안에서** 터진다. 그러면 아무 데도 안 잡히고, 그려 둔 도형이 저장되지 않은 것을
// **새로고침해서 사라진 걸 보고 나서야** 안다.
//
// ── 실패를 어떻게 알리나 ───────────────────────────────────────────────────
// 콘솔 + 백엔드 로그(`CLIENT_ERROR`)로 남긴다. **화면에는 아무것도 띄우지 않는다** —
// 화면 문구를 새로 만드는 건 사용자 확인이 필요한 일이라 여기서 정하지 않았다.
// 띄우고 싶어지면 `notify` 자리에 토스트를 걸면 된다 (한 곳만 고치면 된다).
//
// ⚠ **같은 키는 한 번만 알린다.** debounce 저장은 몇 초마다 다시 시도하므로,
//   막아두지 않으면 로그가 같은 줄로 도배된다.

// ⚠ `.js` 확장자를 빼지 말 것 — node가 이 파일을 못 읽어 `tests/drawingKeys.test.js`가
//   통째로 죽는다. Vite는 둘 다 해석하므로 화면은 그대로다 (calc.js와 같은 이유)
import { clientLog } from "../api/clientLog.js";

const warned = new Set();

function onFail(op, key, e) {
  const id = `${op}:${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  const msg = e?.name === "QuotaExceededError"
    ? "저장 공간이 가득 찼습니다"
    : (e?.message || String(e));
  console.error(`[storage] ${op} 실패 — ${key}: ${msg}`);
  // 백엔드 로그로도 보낸다 — 브라우저 콘솔은 닫으면 사라진다
  try { clientLog("CLIENT_ERROR", { where: "localStorage", op, key, msg }); } catch { /* 로그가 실패해도 조용히 */ }
}

/** 읽기 — 실패하면 null (저장이 막힌 환경에서도 앱은 돌아야 한다) */
export function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** 쓰기 — 성공 여부를 돌려준다. 부르는 쪽이 무시해도 실패는 로그에 남는다 */
export function lsSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch (e) { onFail("쓰기", key, e); return false; }
}

/** 지우기 — 실패해도 앱을 멈추지 않는다 */
export function lsRemove(key) {
  try { localStorage.removeItem(key); return true; }
  catch (e) { onFail("삭제", key, e); return false; }
}

/** JSON 읽기 — 없거나 깨졌으면 fallback */
export function lsGetJSON(key, fallback = null) {
  const raw = lsGet(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** JSON 쓰기 */
export function lsSetJSON(key, value) {
  try { return lsSet(key, JSON.stringify(value)); }
  catch (e) { onFail("직렬화", key, e); return false; }
}
