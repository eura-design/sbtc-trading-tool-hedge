import { useEffect, useRef } from "react";

export function usePositionCloseAlert(position, onAlert) {
  const prevHasPosRef = useRef(null);
  const prevSideRef   = useRef(null);

  useEffect(() => {
    const hasPos = position?.open === true;

    // 초기 마운트 시에는 이전 상태가 없으므로 기록만 하고 종료
    if (prevHasPosRef.current === null) {
      prevHasPosRef.current = hasPos;
      if (hasPos) prevSideRef.current = position.side;
      return;
    }

    // true → false 전환 = 포지션 종료
    if (prevHasPosRef.current === true && hasPos === false) {
      const side  = prevSideRef.current;
      const label = side === "LONG" ? "롱 포지션 종료" : side === "SHORT" ? "숏 포지션 종료" : "포지션 종료";
      onAlert(label);
    }

    prevHasPosRef.current = hasPos;
    if (hasPos) prevSideRef.current = position.side;
  }, [position?.open]); // eslint-disable-line react-hooks/exhaustive-deps
}
