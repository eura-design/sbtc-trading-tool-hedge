import { useMemo } from "react";

export function useFVG(candles, params = {}) {
  const lookback       = params.lookback       ?? 400;
  const max_display    = params.max_display    ?? 20;
  const mitigation_pct = params.mitigation_pct ?? 50;

  return useMemo(() => {
    if (candles.length < 3) return [];

    const start = Math.max(2, candles.length - lookback);
    const gaps  = [];

    for (let i = start; i < candles.length; i++) {
      const a = candles[i - 2];
      const c = candles[i];

      if (c.l > a.h) {
        gaps.push({ type: "bull", top: c.l, bottom: a.h, idx: i - 2, startIdx: i });
      } else if (c.h < a.l) {
        gaps.push({ type: "bear", top: a.l, bottom: c.h, idx: i - 2, startIdx: i });
      }
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

    return unfilled.slice(-max_display);
  }, [candles, lookback, max_display, mitigation_pct]);
}
