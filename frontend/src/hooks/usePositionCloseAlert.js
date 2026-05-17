import { useEffect, useRef } from "react";

export function usePositionCloseAlert(position, onAlert) {
  const prevLongRef  = useRef(null);
  const prevShortRef = useRef(null);

  useEffect(() => {
    // position 자체가 null/undefined면 첫 로드 전 또는 일시적 미반영 → 비교 스킵
    if (position == null) return;

    const hasLong  = !!position.long;
    const hasShort = !!position.short;

    // 초기 마운트 시 기록만 하고 종료
    if (prevLongRef.current === null) {
      prevLongRef.current  = hasLong;
      prevShortRef.current = hasShort;
      return;
    }

    if (prevLongRef.current  && !hasLong)  onAlert("롱 포지션 종료");
    if (prevShortRef.current && !hasShort) onAlert("숏 포지션 종료");

    prevLongRef.current  = hasLong;
    prevShortRef.current = hasShort;
  }, [position?.long, position?.short]); // eslint-disable-line react-hooks/exhaustive-deps
}
