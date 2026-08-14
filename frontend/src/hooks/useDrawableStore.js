import { useState, useCallback, useMemo, useRef } from "react";

const load = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
};

/**
 * 트렌드라인/채널/원 등 도형 데이터를 localStorage에 영구 저장하는 제네릭 훅
 * 공통 필드: id, opacity (0.25~1.0), locked (boolean), alert (boolean)
 *
 * @param storageKey 리플레이 모드에서는 다른 키가 들어온다 (연습용 도형을 실거래
 *   차트와 섞지 않기 위해서다 — replay/drawingKeys.js 참고). **키가 바뀌면 그 키의
 *   내용을 다시 읽는다.**
 * @param readOnly true면 모든 변경이 무시되고 항목이 잠긴 것으로 보인다.
 *   리플레이 중 "기존 도형 보기"에서 쓴다 — 연습하다 실수로 실제 분석선을
 *   끌어 옮기면 원본이 조용히 바뀐다.
 */
export function useDrawableStore(storageKey, readOnly = false) {
  const [raw, setRaw] = useState(() => load(storageKey));

  // ⚠ 키가 바뀌면 **렌더 도중에** 다시 읽는다 (useEffect가 아니라).
  //   useEffect로 하면 한 프레임 동안 이전 키의 도형이 그대로 그려진다 —
  //   리플레이로 들어가는 순간 실거래 도형이 한 번 깜빡이는데,
  //   그게 바로 이 기능이 막으려던 것이다.
  const [prevKey, setPrevKey] = useState(storageKey);
  if (prevKey !== storageKey) {
    setPrevKey(storageKey);
    setRaw(load(storageKey));
  }

  const timerRef = useRef(null);

  const save = useCallback((list) => {
    if (readOnly) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(list));
    }, 300);
  }, [storageKey, readOnly]);

  // 읽기 전용일 때는 잠긴 것으로 보여 준다 — 드래그 핸들러가 locked를 이미 존중한다
  const items = useMemo(
    () => (readOnly ? raw.map(it => ({ ...it, locked: true })) : raw),
    [raw, readOnly],
  );

  const setItems = useCallback((fn) => {
    if (readOnly) return;
    setRaw(fn);
  }, [readOnly]);

  // 전체 교체 (마이그레이션 등에서 사용)
  const replaceAll = useCallback((list) => {
    if (readOnly) return;
    setRaw(list);
    localStorage.setItem(storageKey, JSON.stringify(list));
  }, [storageKey, readOnly]);

  const add = useCallback((props) => {
    setItems(prev => {
      const next = [...prev, { id: Date.now(), opacity: 1.0, locked: false, alert: false, ...props }];
      save(next);
      return next;
    });
  }, [save, setItems]);

  const remove = useCallback((id) => {
    setItems(prev => {
      const next = prev.filter(item => item.id !== id);
      save(next);
      return next;
    });
  }, [save, setItems]);

  const update = useCallback((id, patch) => {
    setItems(prev => {
      const next = prev.map(item => {
        if (item.id !== id) return item;
        return { ...item, ...(typeof patch === "function" ? patch(item) : patch) };
      });
      save(next);
      return next;
    });
  }, [save, setItems]);

  const setOpacity   = useCallback((id, opacity) => update(id, { opacity }), [update]);
  const toggleLock   = useCallback((id) => update(id, item => ({ locked: !item.locked })), [update]);
  const toggleAlert  = useCallback((id) => update(id, item => ({ alert: !item.alert })), [update]);
  const setAlertOff  = useCallback((id) => update(id, { alert: false }), [update]);

  return { items, add, remove, update, replaceAll, setOpacity, toggleLock, toggleAlert, setAlertOff };
}
