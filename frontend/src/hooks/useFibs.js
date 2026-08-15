import { useState, useCallback } from "react";
import { useDrawableStore } from "./useDrawableStore";
import { drawingKey } from "../replay/drawingKeys";
import { normFibLevels, FIB_DEFAULT_LEVELS } from "../chart/fib";

/**
 * 피보나치 되돌림 도형 스토어 + 그리기 상태.
 *
 * 데이터: `{ id, t1, p1, t2, p2, opacity, locked, alert, levels }` — localStorage `"fibs"`
 *   t1/p1 = 추세 시작(레벨 1), t2/p2 = 추세 끝(레벨 0). 순서가 곧 방향이다 (chart/fib.js [F5])
 *   levels = 표시할 레벨 배열. **도형별**이고 더블클릭 팝업에서 고른다 ([F1], 2026-08-15).
 *     undefined면 FIB_DEFAULT_LEVELS — 기존에 저장된 도형이 새 필드 때문에
 *     선이 하나도 없는 채로 뜨면 안 된다 (구조의 showChoch와 같은 규칙)
 *
 * 원(circle)과 같은 2클릭 도형이라 상태 구성도 같다: 첫 클릭 = 시작점,
 * 마우스 이동 = 프리뷰, 둘째 클릭 = 확정.
 */
// @param mode { replayOn, gen } — replay/drawingKeys.js 참고
export function useFibs(mode = {}) {
  const { replayOn = false } = mode;
  const store = useDrawableStore(drawingKey("fibs", replayOn), mode.gen ?? 0);
  const [fibMode,       setFibMode]       = useState(false);
  const [fibStart,      setFibStart]      = useState(null);
  const [fibPreview,    setFibPreview]    = useState(null);
  const [selectedFibId, setSelectedFibId] = useState(null);

  const cancelFibDraw = useCallback(() => {
    setFibMode(false); setFibStart(null); setFibPreview(null);
  }, []);

  const addFib = useCallback((t1, p1, t2, p2) => {
    // 두 앵커가 같은 가격이면 모든 레벨이 한 줄로 겹쳐 아무 의미가 없다 → 버린다
    // (클릭이 두 번 같은 자리에 들어간 경우. 확정 대신 그리기 상태만 정리한다)
    if (p1 !== p2) store.add({ t1, p1, t2, p2 });
    setFibMode(false); setFibStart(null); setFibPreview(null);
  }, [store]);

  const deleteFib = useCallback((id) => {
    store.remove(id); setSelectedFibId(null);
  }, [store]);

  const updateFibEndpoint = useCallback((id, endpoint, t, p) => {
    store.update(id, endpoint === "start" ? { t1: t, p1: p } : { t2: t, p2: p });
  }, [store]);

  const setFibPosition = useCallback((id, t1, p1, t2, p2) => {
    store.update(id, { t1, p1, t2, p2 });
  }, [store]);

  // 레벨 하나 켜고 끄기 — 팝업의 체크박스. **정렬은 여기(쓰기 경로)서 끝낸다**
  // (normFibLevels가 FIB_ALL_LEVELS로 filter). 읽는 쪽은 배열을 그대로 쓴다
  const toggleFibLevel = useCallback((id, r) => {
    store.update(id, item => {
      const cur  = Array.isArray(item.levels) ? item.levels : FIB_DEFAULT_LEVELS;
      const next = cur.includes(r) ? cur.filter(v => v !== r) : [...cur, r];
      return { levels: normFibLevels(next) };
    });
  }, [store]);

  const resetFibLevels = useCallback((id) => {
    store.update(id, { levels: FIB_DEFAULT_LEVELS });
  }, [store]);

  return {
    fibs: store.items,
    fibMode,       setFibMode,
    fibStart,      setFibStart,
    fibPreview,    setFibPreview,
    selectedFibId, setSelectedFibId,
    cancelFibDraw, addFib, deleteFib, updateFibEndpoint, setFibPosition,
    toggleFibLevel, resetFibLevels,
    setFibOpacity:  store.setOpacity,
    toggleFibLock:  store.toggleLock,
    toggleFibAlert: store.toggleAlert,
    setFibAlertOff: store.setAlertOff,
  };
}
