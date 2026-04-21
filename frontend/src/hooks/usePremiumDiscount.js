import { useMemo } from "react";

// ICT Premium/Discount: 최근 dealing range(가장 최근 protected swing H ↔ L)의 fib 50% 기준
// 상단 = Premium(숏 편향), 하단 = Discount(롱 편향), 중앙선 = Equilibrium
//
// "가장 최근 의미있는 range" 구성:
//   - lookback 내 확정 스윙을 시간순 수집
//   - 가장 최근 swing H, 가장 최근 swing L을 뽑아 그 쌍을 dealing range로 사용
//   - 두 스윙 중 먼저 나온 쪽이 range 시작점
export function usePremiumDiscount(candles, params = {}) {
  const swing_lb = params.swing_lb ?? 5;
  const lookback = params.lookback ?? 200;

  return useMemo(() => {
    if (candles.length < swing_lb * 2 + 1) return null;

    const start = Math.max(swing_lb, candles.length - lookback);
    let lastHiIdx = -1, lastHiPrice = 0;
    let lastLoIdx = -1, lastLoPrice = 0;

    for (let i = start; i < candles.length - swing_lb; i++) {
      let isHigh = true, isLow = true;
      for (let j = 1; j <= swing_lb; j++) {
        if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isHigh = false;
        if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isLow  = false;
      }
      // 최신 스윙으로 계속 덮어씀 → 루프 종료 후 가장 최근 값만 남음
      if (isHigh) { lastHiIdx = i; lastHiPrice = candles[i].h; }
      if (isLow)  { lastLoIdx = i; lastLoPrice = candles[i].l; }
    }

    if (lastHiIdx < 0 || lastLoIdx < 0) return null;

    const mid      = (lastHiPrice + lastLoPrice) / 2;
    const startIdx = Math.min(lastHiIdx, lastLoIdx);
    return {
      high: lastHiPrice, low: lastLoPrice, mid,
      highIdx: lastHiIdx, lowIdx: lastLoIdx, startIdx,
    };
  }, [candles, swing_lb, lookback]);
}
