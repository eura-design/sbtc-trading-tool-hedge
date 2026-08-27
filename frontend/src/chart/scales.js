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

// ⚠ **세로 범위는 "화면에 보일 봉"만 본다.** 되돌리지 말 것 (2026-08-15).
//   예전엔 로드된 **전체 3000봉**의 고저를 썼다. x는 300봉인데 y는 3000봉 범위라
//   캔들이 세로로 눌려 그려졌다 = "차트가 납작하다" (실측: 화면 세로의 12% → 89%).
//
// ⚠ **첫 화면·폴백·휠·팬·로그 전환이 전부 아래 두 함수만 쓴다** (2026-08-27).
//   예전엔 그 다섯 자리가 같은 반복문을 각자 갖고 있었고 **여백 식이 두 벌**이었다:
//   첫 화면·폴백은 6% 고정, 나머지 셋은 `max(0.08, 보이는칸수 ÷ 전체봉수 × 0.5)`.
//   봉이 많은 TF에서는 두 식의 답이 6%와 8%로 비슷해 아무도 눈치채지 못했지만,
//   **월봉은 캔들이 84개뿐이라** 그 비율이 4.2가 되어 여백이 210%까지 튀었다 →
//   첫 화면은 세로 89%인데 휠·팬을 하는 순간 23%로 바뀌었다 (2026-08-27 사용자 신고).
//   자리마다 식을 다시 쓰지 말 것 — 그게 이 증상의 원인이다
const VIEW_BARS = 300;
const Y_PAD     = 0.06;

// 처음 볼 구간. ⚠ **있는 캔들보다 넓게 잡지 않는다** (2026-08-27).
//   예전엔 봉 개수와 무관하게 350칸 고정이라, 84개뿐인 월봉은 캔들이 가로의 24%에만
//   몰려 위아래로 늘어난 것처럼 보였다. 1주봉(365개) 이상은 전부 300을 넘어 영향이 없다
export function initialXDomain(candles) {
  const lastIdx = candles.length - 1;
  const past    = Math.max(1, Math.min(VIEW_BARS, lastIdx)); // 최소 1 — 폭이 0이면 xScale이 죽는다
  return [lastIdx - past, lastIdx + Math.round(past / 6)];   // 오른쪽 여백 = 폭의 1/6 (300봉이면 50칸, 예전과 같은 값)
}

// 보이는 봉의 고저 + 여백. ⚠ slice·d3.min/max 대신 직접 루프 — 팬·휠에서 매 프레임 돈다
export function fitYDomain(candles, xDom, isLog = false) {
  const lastIdx = candles.length - 1;
  const i0 = Math.max(0, Math.floor(xDom[0]));
  const i1 = Math.min(lastIdx, Math.ceil(xDom[1]));
  let lo = Infinity, hi = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const c = candles[i];
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
  }
  if (lo === Infinity) { lo = candles[lastIdx].l; hi = candles[lastIdx].h; }
  return padYDomain(lo, hi, Y_PAD, isLog);
}

export function getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog = false) {
  if (!candles.length || IW <= 0 || IH <= 0) return null;
  const xDom = xDomainRef.current ?? initialXDomain(candles);
  const yDom = yDomainRef.current ?? fitYDomain(candles, xDom, isLog);
  const logYDom = isLog ? [Math.max(yDom[0], 1), yDom[1]] : yDom;
  return {
    xScale: d3.scaleLinear().domain(xDom).range([0, IW]),
    yScale: (isLog ? d3.scaleLog() : d3.scaleLinear()).domain(logYDom).range([IH, 0]),
  };
}
