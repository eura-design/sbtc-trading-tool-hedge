import { useMemo } from "react";

// ICT Premium/Discount: 최근 dealing range(최신 스윙 H ↔ L)의 fib 50%를 기준으로
// 상단 = Premium(숏 편향), 하단 = Discount(롱 편향), 중앙선 = Equilibrium
export function usePremiumDiscount(candles, params = {}) {
  const swing_lb = params.swing_lb ?? 5;
  const lookback = params.lookback ?? 200;

  return useMemo(() => {
    if (candles.length < swing_lb * 2 + 1) return null;

    const start = Math.max(swing_lb, candles.length - lookback);
    let hiPrice = -Infinity, hiIdx = -1;
    let loPrice =  Infinity, loIdx = -1;

    // lookback 구간에서 가장 높은 swing high, 가장 낮은 swing low 탐색
    for (let i = start; i < candles.length - swing_lb; i++) {
      let isHigh = true, isLow = true;
      for (let j = 1; j <= swing_lb; j++) {
        if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isHigh = false;
        if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isLow  = false;
      }
      if (isHigh && candles[i].h > hiPrice) { hiPrice = candles[i].h; hiIdx = i; }
      if (isLow  && candles[i].l < loPrice) { loPrice = candles[i].l; loIdx = i; }
    }

    if (hiIdx < 0 || loIdx < 0) return null;

    const mid      = (hiPrice + loPrice) / 2;
    const startIdx = Math.min(hiIdx, loIdx);
    return { high: hiPrice, low: loPrice, mid, highIdx: hiIdx, lowIdx: loIdx, startIdx };
  }, [candles, swing_lb, lookback]);
}
