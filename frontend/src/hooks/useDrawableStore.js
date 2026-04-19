import { useState, useCallback, useRef } from "react";

/**
 * 트렌드라인/채널/원 등 도형 데이터를 localStorage에 영구 저장하는 제네릭 훅
 * 공통 필드: id, opacity (0.25~1.0), locked (boolean), alert (boolean)
 */
export function useDrawableStore(storageKey) {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); }
    catch { return []; }
  });

  const timerRef = useRef(null);

  const save = useCallback((list) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(list));
    }, 300);
  }, [storageKey]);

  // 전체 교체 (마이그레이션 등에서 사용)
  const replaceAll = useCallback((list) => {
    setItems(list);
    localStorage.setItem(storageKey, JSON.stringify(list));
  }, [storageKey]);

  const add = useCallback((props) => {
    setItems(prev => {
      const next = [...prev, { id: Date.now(), opacity: 1.0, locked: false, alert: false, ...props }];
      save(next);
      return next;
    });
  }, [save]);

  const remove = useCallback((id) => {
    setItems(prev => {
      const next = prev.filter(item => item.id !== id);
      save(next);
      return next;
    });
  }, [save]);

  const update = useCallback((id, patch) => {
    setItems(prev => {
      const next = prev.map(item => {
        if (item.id !== id) return item;
        return { ...item, ...(typeof patch === "function" ? patch(item) : patch) };
      });
      save(next);
      return next;
    });
  }, [save]);

  const setOpacity   = useCallback((id, opacity) => update(id, { opacity }), [update]);
  const toggleLock   = useCallback((id) => update(id, item => ({ locked: !item.locked })), [update]);
  const toggleAlert  = useCallback((id) => update(id, item => ({ alert: !item.alert })), [update]);
  const setAlertOff  = useCallback((id) => update(id, { alert: false }), [update]);

  return { items, add, remove, update, replaceAll, setOpacity, toggleLock, toggleAlert, setAlertOff };
}
