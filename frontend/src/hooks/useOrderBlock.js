import { useMemo } from "react";

function detectSwings(candles, swingLb) {
  const highs = [], lows = [];
  for (let i = swingLb; i < candles.length - swingLb; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= swingLb; j++) {
      if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isHigh = false;
      if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isLow  = false;
    }
    if (isHigh) highs.push(i);
    if (isLow)  lows.push(i);
  }
  return { highs, lows };
}

function avgRange(candles, endIdx, period) {
  const start = Math.max(0, endIdx - period);
  let sum = 0, cnt = 0;
  for (let i = start; i < endIdx; i++) {
    sum += candles[i].h - candles[i].l;
    cnt++;
  }
  return cnt > 0 ? sum / cnt : 0;
}

export function useOrderBlock(candles, params = {}) {
  const swing_lb          = params.swing_lb          ?? 5;
  const bos_window        = params.bos_window        ?? 30;
  const ob_lookback       = params.ob_lookback       ?? 20;
  const max_display       = params.max_display       ?? 15;
  const scan_from         = params.scan_from         ?? 500;
  const mitigation_pct    = params.mitigation_pct    ?? 50;
  const disp_threshold    = params.disp_threshold    ?? 1.8;
  const disp_atr_period   = params.disp_atr_period   ?? 14;
  const displacement_only = params.displacement_only ?? false;
  const use_wick          = params.use_wick          ?? false;   // true=고저(wick) 포함 / false=body만

  return useMemo(() => {
    if (candles.length < 20) return [];

    const scanStart = Math.max(0, candles.length - scan_from);
    const scanSlice = candles.slice(scanStart);
    const { highs, lows } = detectSwings(scanSlice, swing_lb);
    const obs = [];
    const usedHighs = new Set(), usedLows = new Set();

    function lowerBound(arr, value) {
      let lo = 0, hi = arr.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < value) lo = mid + 1; else hi = mid; }
      return lo;
    }

    for (let i = swing_lb + 1; i < scanSlice.length; i++) {
      const c = scanSlice[i];
      const winStart = i - bos_window;

      const hFrom = lowerBound(highs, winStart);
      for (let hi_ = hFrom; hi_ < highs.length && highs[hi_] < i; hi_++) {
        const shIdx = highs[hi_];
        if (usedHighs.has(shIdx)) continue;
        if (c.c > scanSlice[shIdx].h) {
          usedHighs.add(shIdx);
          const lookStart = Math.max(shIdx, i - ob_lookback);
          let obIdx = -1;
          for (let k = i - 1; k >= lookStart; k--) {
            if (scanSlice[k].c < scanSlice[k].o) { obIdx = k; break; }
          }
          if (obIdx < 0) break;
          const ob = scanSlice[obIdx];
          // Displacement: BOS 캔들 body/ATR + 방향성 마감
          const absI = scanStart + i;
          const atr  = avgRange(candles, absI, disp_atr_period);
          const body = Math.abs(c.c - c.o);
          const rng  = c.h - c.l;
          const dispRatio = atr > 0 ? body / atr : 0;
          const dirClose  = rng > 0 && (c.h - c.c) / rng <= 0.25; // 상위 25% 마감
          const top    = use_wick ? ob.h : Math.max(ob.o, ob.c);
          const bottom = use_wick ? ob.l : Math.min(ob.o, ob.c);
          obs.push({
            type: "bull", top, bottom,
            idx: scanStart + obIdx, startIdx: absI,
            displacement: dispRatio >= disp_threshold && dirClose, dispRatio,
          });
          break;
        }
      }

      const lFrom = lowerBound(lows, winStart);
      for (let li_ = lFrom; li_ < lows.length && lows[li_] < i; li_++) {
        const slIdx = lows[li_];
        if (usedLows.has(slIdx)) continue;
        if (c.c < scanSlice[slIdx].l) {
          usedLows.add(slIdx);
          const lookStart = Math.max(slIdx, i - ob_lookback);
          let obIdx = -1;
          for (let k = i - 1; k >= lookStart; k--) {
            if (scanSlice[k].c > scanSlice[k].o) { obIdx = k; break; }
          }
          if (obIdx < 0) break;
          const ob = scanSlice[obIdx];
          const absI = scanStart + i;
          const atr  = avgRange(candles, absI, disp_atr_period);
          const body = Math.abs(c.c - c.o);
          const rng  = c.h - c.l;
          const dispRatio = atr > 0 ? body / atr : 0;
          const dirClose  = rng > 0 && (c.c - c.l) / rng <= 0.25; // 하위 25% 마감
          const top    = use_wick ? ob.h : Math.max(ob.o, ob.c);
          const bottom = use_wick ? ob.l : Math.min(ob.o, ob.c);
          obs.push({
            type: "bear", top, bottom,
            idx: scanStart + obIdx, startIdx: absI,
            displacement: dispRatio >= disp_threshold && dirClose, dispRatio,
          });
          break;
        }
      }
    }

    // 미티게이션: bull은 위에서 아래로, bear는 아래에서 위로 소비
    const mitFrac = mitigation_pct / 100;
    const alive = obs.filter(ob => {
      const threshold = ob.type === "bull"
        ? ob.top    - (ob.top - ob.bottom) * mitFrac
        : ob.bottom + (ob.top - ob.bottom) * mitFrac;
      for (let i = ob.startIdx; i < candles.length; i++) {
        const c = candles[i];
        if (ob.type === "bull" && c.l <= threshold) return false;
        if (ob.type === "bear" && c.h >= threshold) return false;
      }
      return true;
    });

    const filtered = displacement_only ? alive.filter(o => o.displacement) : alive;
    return filtered.slice(-max_display);
  }, [candles, swing_lb, bos_window, ob_lookback, max_display, scan_from, mitigation_pct, disp_threshold, disp_atr_period, displacement_only, use_wick]);
}
