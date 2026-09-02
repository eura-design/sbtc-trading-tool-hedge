import { API_BASE } from "../constants";
import { clientLog } from "./clientLog";

// ── 리플레이 안전장치 ─────────────────────────────────────────────────────
// 리플레이 모드에서는 **상태를 바꾸는 요청을 여기서 전부 막는다.**
//
// 페이퍼 트레이딩은 orderSlice가 paperBroker로 갈아타는 방식이라, 원래대로면
// 이 가드가 없어도 실주문이 나갈 일이 없다. 그래도 두는 이유:
// 주문 경로가 12개(진입·TP/SL·추가진입·분할TP·청산·취소…)나 되고 앞으로도 늘 텐데,
// **하나라도 빠뜨리면 과거 차트를 보면서 실제 돈이 나간다.** 그 사고의 비용이
// 비대칭적으로 크므로, 모든 경로가 반드시 지나는 이 한 곳에서 한 번 더 막는다.
//
// GET은 통과시킨다 — 잔고·통계 조회는 화면을 망가뜨리지 않고, 막으면 리플레이를
// 켜는 순간 사이드바가 통째로 에러가 된다.
//
// ⚠ 이 파일은 store를 import하지 않는다 (store → api 방향이라 순환이 된다).
//   그래서 replaySlice가 setReplayGuard로 값을 밀어 넣는다.
let _replayGuard = false;

// ── 심볼 (2026-09-02) ─────────────────────────────────────────────────────
// 모든 요청에 **지금 보고 있는 심볼**을 실어 보낸다. 백엔드는 없으면 기본 심볼로
// 떨어지므로 안 실으면 조용히 BTCUSDT로 나간다.
//
// ⚠ **호출부마다 넣지 않고 여기 한 곳에서 넣는다.** 주문 액션이 16개가 넘는데
//   하나만 빠뜨려도 그 경로가 다른 코인 화면에서 BTC 주문을 낸다 — 리플레이 가드와
//   로그를 여기 둔 것과 정확히 같은 이유다.
// ⚠ **호출부가 직접 넣은 symbol이 이긴다.** 이미 걸린 주문을 취소할 때처럼
//   "화면이 아니라 그 주문의 심볼"이어야 하는 경우가 있다.
// ⚠ store를 import하지 않는다 (store → api 방향이라 순환) — replayGuard와 같은 방식으로
//   settingsSlice가 밀어 넣는다
let _symbol = null;
export function setApiSymbol(sym) { _symbol = sym; }

// ⚠ 가드의 목적은 **실주문 차단**이지 "쓰기 금지"가 아니다.
// 계좌와 무관한 UI 설정은 리플레이 중에도 저장돼야 한다 — 지표 파라미터가 그렇다.
// (한때 막혀 있었는데 useIndicatorParams가 `.catch(() => {})`로 삼켜서,
//  연습 중에 바꾼 지표 설정이 아무 말 없이 사라졌다)
// 리플레이 중에도 통과시킬 경로 — **계좌와 무관한 UI 설정**만 넣을 것.
// ※ 지금은 비어 있다. 유일한 항목이던 `/api/indicator-params`가 2026-08-26에 사라졌다
//   (지표 설정이 브라우저로 옮겨가 백엔드에 보낼 것이 없어졌다).
//   ⚠ **그 항목이 왜 있었는지는 기억해 둘 것** — 막아 뒀더니 `useIndicatorParams`가
//     `.catch(() => {})`로 삼켜서, 연습 중에 바꾼 지표 설정이 아무 말 없이 사라졌다.
//     앞으로도 "계좌와 무관한데 백엔드에 쓰는 것"이 생기면 여기에 넣어야 한다.
// ※ 브라우저 저장소 백업(`api/backup.js`)은 이 목록과 무관하다 — `api()`를 안 쓰고
//   raw fetch라 애초에 가드를 지나지 않는다 (clientLog와 같다)
const ALLOW_IN_REPLAY = [];

export function setReplayGuard(on) { _replayGuard = on; }

export async function api(method, path, body) {
  // ⚠ **상태를 바꾸는 요청은 전부 여기서 기록한다** (2026-08-25).
  //   주문 액션이 12개가 넘는데 각각에 로그를 넣으면 하나씩 빠뜨린다 —
  //   **모든 경로가 반드시 지나는 이 한 곳**에 두면 새 액션이 생겨도 저절로 남는다
  //   (리플레이 가드를 여기 둔 것과 같은 이유)
  // ⚠ GET은 기록하지 않는다 — 폴링이 초당 여러 번이라 로그가 조회로 뒤덮인다
  const logged = method !== "GET";
  const t0 = logged ? Date.now() : 0;

  if (_replayGuard && method !== "GET" && !ALLOW_IN_REPLAY.some(p => path.startsWith(p))) {
    // 거래소에 닿지도 못한 요청 — **백엔드 로그에는 흔적이 없다.** 여기서만 남는다
    clientLog("API_BLOCKED", { level: "warn", method, path, reason: "replay" });
    throw new Error("리플레이 모드에서는 실제 주문을 보낼 수 없습니다 (연습 계좌로 처리됩니다)");
  }
  try {
    // GET은 쿼리로, 나머지는 본문으로. 이미 들어 있으면 건드리지 않는다
    let url = `${API_BASE}${path}`;
    let sendBody = body;
    if (_symbol) {
      if (method === "GET") {
        if (!/[?&]symbol=/.test(url)) url += (url.includes("?") ? "&" : "?") + "symbol=" + _symbol;
      } else if (!body || body.symbol == null) {
        sendBody = { ...(body ?? {}), symbol: _symbol };
      }
    }
    const res = await fetch(url, {
      method,
      headers: sendBody ? { "Content-Type": "application/json" } : {},
      body: sendBody ? JSON.stringify(sendBody) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg;
      try { msg = JSON.parse(text).error || text; }
      catch { msg = text || `HTTP ${res.status}`; }
      if (logged) clientLog("API_CALL", { level: "error", method, path, body: body ?? null,
        status: res.status, ok: false, msg, ms: Date.now() - t0 });
      const err = new Error(msg);
      err._logged = true;   // 아래 catch가 **같은 실패를 두 번 남기지 않게**
      throw err;
    }
    const json = await res.json();
    if (logged) clientLog("API_CALL", { method, path, body: body ?? null,
      status: res.status, ok: true, ms: Date.now() - t0 });
    return json;
  } catch (e) {
    // fetch 자체가 실패한 경우(백엔드 꺼짐·네트워크 끊김) — 응답이 아예 없어서
    // 위 `!res.ok` 분기를 안 탄다. 백엔드 로그에도 흔적이 없으므로 여기서만 남는다
    if (logged && !e._logged) {
      clientLog("API_CALL", { level: "error", method, path, body: body ?? null,
        status: null, ok: false, msg: String(e.message || e), ms: Date.now() - t0 });
    }
    throw e;
  }
}
