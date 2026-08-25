import { useState, useCallback, useMemo, useRef } from "react";

const load = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
};

/**
 * 트렌드라인/채널/원 등 도형 데이터를 localStorage에 영구 저장하는 제네릭 훅
 * 공통 필드: id, opacity (0.1~1.0, 0.1 단위), locked (boolean), alert (boolean)
 *
 * @param storageKey 리플레이 모드에서는 다른 키가 들어온다 (연습용 도형을 실거래
 *   차트와 섞지 않기 위해서다 — replay/drawingKeys.js 참고). **키가 바뀌면 그 키의
 *   내용을 다시 읽는다.**
 * ※ 예전엔 readOnly 인자가 있었다 (리플레이 "기존 도형 보기"용). 그 기능이
 *   2026-08-15에 제거되면서 같이 뺐다 — 되살리려면 둘 다 다시 필요하다.
 * @param reloadToken 값이 바뀌면 **키가 그대로여도** localStorage에서 다시 읽는다.
 *   리플레이 🎲가 연습 도형을 지울 때 쓴다 — 그때는 키가 안 바뀌므로
 *   이게 없으면 지운 도형이 React 상태에 남아 있다가 다음 저장에 되살아난다.
 */
export function useDrawableStore(storageKey, reloadToken = 0) {
  const [raw, setRaw] = useState(() => load(storageKey));
  const timerRef = useRef(null);

  // ⚠ 키(또는 reloadToken)가 바뀌면 **렌더 도중에** 다시 읽는다 (useEffect가 아니라).
  //   useEffect로 하면 한 프레임 동안 이전 키의 도형이 그대로 그려진다 —
  //   리플레이로 들어가는 순간 실거래 도형이 한 번 깜빡이는데,
  //   그게 바로 이 기능이 막으려던 것이다.
  const [prev, setPrev] = useState({ key: storageKey, token: reloadToken });
  if (prev.key !== storageKey || prev.token !== reloadToken) {
    // ⚠ 대기 중인 debounce 저장을 **먼저 버린다.** 안 그러면 300ms 뒤에
    //   방금 버린 목록이 그대로 다시 쓰여 초기화가 무효가 된다
    clearTimeout(timerRef.current);
    setPrev({ key: storageKey, token: reloadToken });
    setRaw(load(storageKey));
  }

  const save = useCallback((list) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(list));
    }, 300);
  }, [storageKey]);

  const items = raw;
  const setItems = setRaw;

  // 전체 교체 (마이그레이션 등에서 사용)
  const replaceAll = useCallback((list) => {
    setRaw(list);
    localStorage.setItem(storageKey, JSON.stringify(list));
  }, [storageKey]);

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
