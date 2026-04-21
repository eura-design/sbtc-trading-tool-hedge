import { useMemo } from "react";

// Displacement 계산용 ATR (단순 평균)
function avgRange(candles, endIdx, period) {
  const start = Math.max(0, endIdx - period);
  let sum = 0, cnt = 0;
  for (let i = start; i < endIdx; i++) {
    sum += candles[i].h - candles[i].l;
    cnt++;
  }
  return cnt > 0 ? sum / cnt : 0;
}

export function useFVG(candles, params = {}) {
  const lookback          = params.lookback          ?? 400;
  const max_display       = params.max_display       ?? 20;
  const mitigation_pct    = params.mitigation_pct    ?? 50;
  const disp_threshold    = params.disp_threshold    ?? 1.8;   // 중간 캔들 body가 ATR의 N배 이상이면 displacement
  const disp_atr_period   = params.disp_atr_period   ?? 14;
  const displacement_only = params.displacement_only ?? false;

  return useMemo(() => {
    if (candles.length < 3) return [];

    const start = Math.max(2, candles.length - lookback);
    const gaps  = [];

    for (let i = start; i < candles.length; i++) {
      const a  = candles[i - 2];
      const mid = candles[i - 1];  // displacement 캔들
      const c  = candles[i];

      let type = null, top = 0, bottom = 0;
      if (c.l > a.h)       { type = "bull"; top = c.l; bottom = a.h; }
      else if (c.h < a.l)  { type = "bear"; top = a.l; bottom = c.h; }
      else continue;

      const atr = avgRange(candles, i - 1, disp_atr_period);
      const midBody  = Math.abs(mid.c - mid.o);
      const midRange = mid.h - mid.l;
      const dispRatio = atr > 0 ? midBody / atr : 0;
      // 방향성 마감: 불리시 FVG → 종가가 캔들 범위 상위 25% / 베어리시 → 하위 25%
      const dirClose = midRange > 0
        ? (type === "bull" ? (mid.h - mid.c) / midRange <= 0.25
                           : (mid.c - mid.l) / midRange <= 0.25)
        : false;
      const displacement = dispRatio >= disp_threshold && dirClose;

      gaps.push({ type, top, bottom, idx: i - 2, startIdx: i, displacement, dispRatio });
    }

    const mitFrac = mitigation_pct / 100;
    const unfilled = gaps.filter(gap => {
      const threshold = gap.type === "bull"
        ? gap.top - (gap.top - gap.bottom) * mitFrac
        : gap.bottom + (gap.top - gap.bottom) * mitFrac;
      for (let i = gap.startIdx + 1; i < candles.length; i++) {
        const c = candles[i];
        if (gap.type === "bull" && c.l <= threshold) return false;
        if (gap.type === "bear" && c.h >= threshold) return false;
      }
      return true;
    });

    const filtered = displacement_only ? unfilled.filter(g => g.displacement) : unfilled;
    return filtered.slice(-max_display);
  }, [candles, lookback, max_display, mitigation_pct, disp_threshold, disp_atr_period, displacement_only]);
}
