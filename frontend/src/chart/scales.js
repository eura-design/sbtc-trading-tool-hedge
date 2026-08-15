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

// 로그 스케일에서도 선형과 동일한 시각적 여백을 만드는 Y 도메인 패딩
// 선형: [lo - range*p, hi + range*p]
// 로그: lo/(hi/lo)^p, hi*(hi/lo)^p
export function padYDomain(lo, hi, padFrac, isLog) {
  if (!isLog) return [lo - (hi - lo) * padFrac, hi + (hi - lo) * padFrac];
  const safeLo = Math.max(lo, 1);
  const safeHi = Math.max(hi, safeLo * 1.001);
  const logPad = Math.pow(safeHi / safeLo, padFrac);
  return [safeLo / logPad, safeHi * logPad];
}

// ⚠ **폴백 도메인은 "화면에 보일 봉"만 본다.** 되돌리지 말 것 (2026-08-15).
//   예전 y 폴백은 `d3.min/max(candles)` — 로드된 **전체 3000봉**의 고저였다.
//   x는 300봉인데 y는 3000봉 범위라, 도메인이 비어 있는 짧은 순간(도메인 리셋 직후,
//   TF 전환 중)마다 캔들이 세로로 눌려 그려졌다 = "차트가 납작하다".
//   휠을 굴리면 useChartInteraction이 보이는 봉으로 y를 다시 계산해 그때서야 정상으로 보였다.
//   폭(300)과 패딩(0.06)은 useChartRenderer의 applyInitialDomain과 **같은 값**이어야
//   폴백에서 확정 도메인으로 넘어갈 때 화면이 튀지 않는다
const FALLBACK_BARS = 300;

export function getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog = false) {
  if (!candles.length || IW <= 0 || IH <= 0) return null;
  const lastIdx = candles.length - 1;
  const xDom = xDomainRef.current ?? [lastIdx - FALLBACK_BARS, lastIdx + 50];
  let yDom = yDomainRef.current;
  if (!yDom) {
    const i0 = Math.max(0, Math.floor(xDom[0]));
    const i1 = Math.min(lastIdx, Math.ceil(xDom[1]));
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const c = candles[i];
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    if (lo === Infinity) { lo = candles[lastIdx].l; hi = candles[lastIdx].h; }
    yDom = padYDomain(lo, hi, 0.06, isLog);
  }
  const logYDom = isLog ? [Math.max(yDom[0], 1), yDom[1]] : yDom;
  return {
    xScale: d3.scaleLinear().domain(xDom).range([0, IW]),
    yScale: (isLog ? d3.scaleLog() : d3.scaleLinear()).domain(logYDom).range([IH, 0]),
  };
}
