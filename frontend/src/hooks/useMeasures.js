import { useState, useCallback } from "react";
import { useDrawableStore } from "./useDrawableStore";
import { drawingKey } from "../replay/drawingKeys";
import { DEFAULT_SYMBOL } from "../constants";

/**
 * 측정 박스(사각형) 스토어 + 그리기 상태 — 2026-08-26 사용자 요청.
 *
 * 데이터: `{ id, t1, p1, t2, p2, opacity, locked }` — localStorage `"measures"`
 *   t1/p1 = **드래그를 시작한 모서리**, t2/p2 = 놓은 모서리.
 *   ⚠ 순서가 곧 부호다 — 등락률은 `(p2 - p1) / p1`이라 두 점을 맞바꾸면 방향이 뒤집힌다
 *   (피보나치가 t1/p1을 추세 시작으로 두는 것과 같은 규칙, chart/fib.js [F5])
 *
 * ⚠ **그리기는 드래그다** (사용자 지정). 선·원·피보나치는 2클릭이지만 이건 사각형이라
 *   플랜 박스와 같은 조작이 자연스럽다. 그래서 그리기 상태가 `start/preview` 두 개가
 *   아니라 draft 하나다 — 드래그 중에는 네 모서리가 전부 정해져 있기 때문이다.
 *
 * ※ 근접 알림이 없다 — 측정은 "지금 얼마나 움직였나"를 읽는 도구지 가격을 지키는
 *   선이 아니다. 그래서 `alert`는 쓰지 않고 팝업에도 🔔이 없다 (LineOpacityPopup)
 */
// @param mode { replayOn, gen } — replay/drawingKeys.js 참고
export function useMeasures(mode = {}) {
  const { replayOn = false, symbol = DEFAULT_SYMBOL } = mode;
  // 심볼이 바뀌면 키가 달라져 useDrawableStore가 그 심볼의 도형을 다시 읽는다
  const store = useDrawableStore(drawingKey("measures", replayOn, symbol), mode.gen ?? 0);
  const [measureMode,       setMeasureMode]       = useState(false);
  const [measureDraft,      setMeasureDraft]      = useState(null);   // { t1, p1, t2, p2 }
  const [selectedMeasureId, setSelectedMeasureId] = useState(null);

  const cancelMeasureDraw = useCallback(() => {
    setMeasureMode(false); setMeasureDraft(null);
  }, []);

  const addMeasure = useCallback((t1, p1, t2, p2) => {
    // 같은 가격이거나 같은 봉이면 잴 게 없다 — 클릭이 드래그로 오해된 경우다
    if (p1 !== p2 && t1 !== t2) store.add({ t1, p1, t2, p2 });
    setMeasureMode(false); setMeasureDraft(null);
  }, [store]);

  const deleteMeasure = useCallback((id) => {
    store.remove(id); setSelectedMeasureId(null);
  }, [store]);

  // 모서리 하나 이동 — 어느 좌표를 고칠지는 부르는 쪽이 정한다
  // (사각형의 네 모서리는 t1/t2 × p1/p2 조합이라 키 두 개로 다 표현된다)
  const moveMeasureCorner = useCallback((id, tKey, pKey, t, p) => {
    store.update(id, { [tKey]: t, [pKey]: p });
  }, [store]);

  const setMeasurePosition = useCallback((id, t1, p1, t2, p2) => {
    store.update(id, { t1, p1, t2, p2 });
  }, [store]);

  return {
    measures: store.items,
    measureMode,       setMeasureMode,
    measureDraft,      setMeasureDraft,
    selectedMeasureId, setSelectedMeasureId,
    cancelMeasureDraw, addMeasure, deleteMeasure,
    moveMeasureCorner, setMeasurePosition,
    setMeasureOpacity: store.setOpacity,
    toggleMeasureLock: store.toggleLock,
  };
}
