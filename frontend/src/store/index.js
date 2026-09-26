import { create } from "zustand";
import { setReplayGuardSource } from "../api/client.js";
import { createServerSlice }   from "./serverSlice";
import { createSettingsSlice } from "./settingsSlice";
import { createUiSlice }       from "./uiSlice";
import { createOrderSlice }    from "./orderSlice";
import { createReplaySlice }   from "./replaySlice";

export const useStore = create((...a) => ({
  ...createServerSlice(...a),
  ...createSettingsSlice(...a),
  ...createUiSlice(...a),
  ...createOrderSlice(...a),
  ...createReplaySlice(...a),
}));

// ── 실주문 차단 가드의 정본은 **이 스토어의 `replayOn`**이다 (2026-09-27) ────
//
// `api/client.js`는 스토어를 import할 수 없다 (store → api 방향이라 순환이 된다).
// 그래서 **읽는 함수를 여기서 등록한다.** 예전에는 `setReplayOn`이 boolean을 밀어 넣었는데,
// 그러면 값이 두 벌이 되어 어긋난다 — 실제로 어긋나서 실거래인데 실계좌 주문이
// "리플레이 모드"라고 막혔다 (api/client.js 머리 주석 참고).
// ⚠ 이 등록을 지우지 말 것. 지우면 가드가 늘 false가 되어, 액션별 `paperActions` 위임
//   한 겹만 남는다 (그 위임을 빠뜨린 액션이 생기면 연습 중에 실주문이 나간다).
setReplayGuardSource(() => useStore.getState().replayOn);
