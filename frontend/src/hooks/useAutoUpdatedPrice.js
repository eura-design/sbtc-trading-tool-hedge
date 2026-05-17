import { useState, useEffect, useRef, useCallback } from "react";

// 사이드바 액션 카드(추가진입/분할TP)의 가격 입력 공통 훅
// - 5초마다 compute()를 호출해 가격을 자동 갱신
// - 사용자가 입력하면 lockMs 동안 자동갱신 잠금
// - enabled=false면 갱신 중단 (예: ScaleIn의 MARKET 모드)
export function useAutoUpdatedPrice(initialPrice, compute, { intervalMs = 5000, lockMs = 60000, enabled = true } = {}) {
  const [price, setPriceRaw] = useState(() => String(Math.round(initialPrice || 0)));
  const userEditedRef  = useRef(false);
  const computeRef     = useRef(compute);
  computeRef.current   = compute;
  const resumeTimerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    userEditedRef.current = false;
    clearTimeout(resumeTimerRef.current);
    const tick = () => {
      if (userEditedRef.current) return;
      const v = computeRef.current();
      if (v != null && Number.isFinite(v)) setPriceRaw(String(Math.round(v)));
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { clearInterval(id); clearTimeout(resumeTimerRef.current); };
  }, [enabled, intervalMs, lockMs]);

  const setPrice = useCallback((v) => {
    userEditedRef.current = true;
    setPriceRaw(v);
    clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => { userEditedRef.current = false; }, lockMs);
  }, [lockMs]);

  return [price, setPrice];
}
