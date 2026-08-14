import { useState, useCallback } from "react";
import { useDrawableStore } from "./useDrawableStore";

/**
 * 피보나치 되돌림 도형 스토어 + 그리기 상태.
 *
 * 데이터: `{ id, t1, p1, t2, p2, opacity, locked, alert }` — localStorage `"fibs"`
 *   t1/p1 = 추세 시작(레벨 1), t2/p2 = 추세 끝(레벨 0). 순서가 곧 방향이다 (chart/fib.js [F5])
 *
 * ※ 레벨 목록은 여기 없다 — **전역 파라미터**다 (indicatorParams.fib.levels, [F1]).
 *   도형마다 다른 레벨을 갖지 않으므로 스토어에 넣지 말 것.
 *
 * 원(circle)과 같은 2클릭 도형이라 상태 구성도 같다: 첫 클릭 = 시작점,
 * 마우스 이동 = 프리뷰, 둘째 클릭 = 확정.
 */
export function useFibs() {
  const store = useDrawableStore("fibs");
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

  return {
    fibs: store.items,
    fibMode,       setFibMode,
    fibStart,      setFibStart,
    fibPreview,    setFibPreview,
    selectedFibId, setSelectedFibId,
    cancelFibDraw, addFib, deleteFib, updateFibEndpoint, setFibPosition,
    setFibOpacity:  store.setOpacity,
    toggleFibLock:  store.toggleLock,
    toggleFibAlert: store.toggleAlert,
    setFibAlertOff: store.setAlertOff,
  };
}
