import * as d3 from "d3";

/**
 * timestamp → fractional bar index (TradingView 표준 방식)
 * openTime <= t 를 만족하는 마지막 캔들을 찾고,
 * 다음 캔들까지의 비율로 소수 부분을 보간하여 반환.
 * t가 범위 밖이면 0 또는 length-1로 클램프.
 */
export function tsToIdx(t, candles) {
  if (!candles.length) return 0;
  const ts = t instanceof Date ? t.getTime() : +t;

  const ct0 = candles[0].t instanceof Date ? candles[0].t.getTime() : +candles[0].t;
  if (ts <= ct0) {
    // 첫 캔들 이전: 캔들 간격으로 과거 방향 외삽 (미래 외삽과 대칭)
    if (candles.length >= 2) {
      const ct1 = candles[1].t instanceof Date ? candles[1].t.getTime() : +candles[1].t;
      const interval = ct1 - ct0;
      if (interval > 0) return (ts - ct0) / interval; // 음수 인덱스 가능
    }
    return 0;
  }

  const ctN = candles[candles.length - 1].t instanceof Date
    ? candles[candles.length - 1].t.getTime()
    : +candles[candles.length - 1].t;
  if (ts >= ctN) {
    // 마지막 캔들 이후: 캔들 간격으로 외삽 (미래 영역)
    if (candles.length >= 2) {
      const ctPrev = candles[candles.length - 2].t instanceof Date
        ? candles[candles.length - 2].t.getTime()
        : +candles[candles.length - 2].t;
      const interval = ctN - ctPrev;
      if (interval > 0) return (candles.length - 1) + (ts - ctN) / interval;
    }
    return candles.length - 1;
  }

  // 이진 탐색: openTime <= ts 를 만족하는 마지막 인덱스 (floor)
  let lo = 0, hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1; // ceiling mid
    const ct  = candles[mid].t instanceof Date ? candles[mid].t.getTime() : +candles[mid].t;
    if (ct <= ts) lo = mid;
    else          hi = mid - 1;
  }

  // 소수점 보간: lo ~ lo+1 캔들 사이의 비율로 fractional index 계산
  // 이를 통해 timestamp가 두 캔들 사이에 있을 때 정확한 위치를 반환
  if (lo < candles.length - 1) {
    const tLo = candles[lo].t instanceof Date ? candles[lo].t.getTime() : +candles[lo].t;
    const tHi = candles[lo + 1].t instanceof Date ? candles[lo + 1].t.getTime() : +candles[lo + 1].t;
    if (tHi > tLo) return lo + (ts - tLo) / (tHi - tLo);
  }

  return lo;
}

export function getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog = false) {
  if (!candles.length || IW <= 0 || IH <= 0) return null;
  const lastIdx = candles.length - 1;
  const xDom = xDomainRef.current ?? [lastIdx - 150, lastIdx + 50];
  const yDom = yDomainRef.current ?? [d3.min(candles, d => d.l)*0.999, d3.max(candles, d => d.h)*1.001];
  const logYDom = isLog ? [Math.max(yDom[0], 1), yDom[1]] : yDom;
  return {
    xScale: d3.scaleLinear().domain(xDom).range([0, IW]),
    yScale: (isLog ? d3.scaleLog() : d3.scaleLinear()).domain(logYDom).range([IH, 0]),
  };
}
