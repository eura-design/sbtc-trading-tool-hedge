import { API_BASE } from "../constants";

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

// ⚠ 가드의 목적은 **실주문 차단**이지 "쓰기 금지"가 아니다.
// 계좌와 무관한 UI 설정은 리플레이 중에도 저장돼야 한다 — 지표 파라미터가 그렇다.
// (한때 막혀 있었는데 useIndicatorParams가 `.catch(() => {})`로 삼켜서,
//  연습 중에 바꾼 지표 설정이 아무 말 없이 사라졌다)
const ALLOW_IN_REPLAY = ["/api/indicator-params"];

export function setReplayGuard(on) { _replayGuard = on; }

export async function api(method, path, body) {
  if (_replayGuard && method !== "GET" && !ALLOW_IN_REPLAY.some(p => path.startsWith(p))) {
    throw new Error("리플레이 모드에서는 실제 주문을 보낼 수 없습니다 (연습 계좌로 처리됩니다)");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg;
    try { msg = JSON.parse(text).error || text; }
    catch { msg = text || `HTTP ${res.status}`; }
    throw new Error(msg);
  }
  return res.json();
}
