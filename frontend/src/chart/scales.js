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

// 로그 눈금이 계산할 수 없는 값(0 이하)을 막는 **바닥**. 네 곳이 이 하나를 나눠 쓴다
// (`padYDomain` · `getScales` · `shiftYDomain` · `zoomYDomain`).
//
// ⚠ **이 값을 1로 되돌리지 말 것** (2026-09-06에 고쳤다). 예전 값이 `1`(=1달러)이었다.
//   BTC(70,000)·ETH(3,000)는 바닥 근처에 갈 일이 없어 아무 문제가 없었지만,
//   **1달러 미만 코인은 가격 전체가 바닥보다 아래**라 세로 범위가 통째로 1달러 근처로
//   끌려 올라갔다. 실측(2026-09-06): DOGE 0.2에서 로그를 켜면 화면이 보여주는 범위가
//   `0.99994 ~ 1.00106`이 되고, 최고가는 화면 500px 중 **715,068px 자리**에 찍혔다 —
//   차트가 통째로 비어 보인다. XRP(0.5)도 같았다.
// ⚠ 상대값(예: 최고가의 1만분의 1)으로 두지 말 것 — 10만 배 움직인 코인을 긴 구간으로
//   보면 **정상 범위를 잘라먹는다**. 실제 가격보다 한참 아래인 절대값이 안전하다
//   (가장 잘게 쪼개지는 호가 단위도 1e-8이다)
const LOG_MIN = 1e-12;

// 세로 범위 계산의 안전망 — 결과가 **무한대나 NaN이면 바꾸지 않는다** (2026-09-06)
//
// ⚠ 왜: 세로 범위에 무한대가 한 번 들어가면 축·캔들·도형이 통째로 안 그려지고,
//   그 뒤로는 확대해도 되돌아오지 않는다 (무한대는 계산해도 무한대다).
//   실측: `zoomYDomain`을 로그 눈금에서 **50번 연속** 축소로 부르면 그렇게 된다.
// ※ 지금 화면에서는 도달하지 않는다 — 가로 축이 "가진 캔들 전부"에서 멈추므로
//   연속 축소가 6번에서 끊긴다(실측). 이 줄은 **평소에 한 번도 실행되지 않는 안전망**이고,
//   나중에 다른 곳에서 이 함수를 부를 때를 위한 것이다.
// ※ 막았을 때의 화면: 그 호출만 무시되어 **더 이상 축소되지 않고 멈춘다**
const finiteOr = (out, fallback) =>
  (Number.isFinite(out[0]) && Number.isFinite(out[1])) ? out : fallback;

// 로그 스케일에서도 선형과 동일한 시각적 여백을 만드는 Y 도메인 패딩
// 선형: [lo - range*p, hi + range*p]
// 로그: lo/(hi/lo)^p, hi*(hi/lo)^p
export function padYDomain(lo, hi, padFrac, isLog) {
  if (!isLog) return [lo - (hi - lo) * padFrac, hi + (hi - lo) * padFrac];
  const safeLo = Math.max(lo, LOG_MIN);
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

// 세로 범위를 **픽셀만큼 밀어준다** — 차트를 위아래로 끌 때 쓴다 (2026-09-06 사용자 요청)
//
// ⚠ **로그 눈금에서는 더하기가 아니라 곱하기다.** 로그 축은 같은 간격이 같은 **비율**이라,
//   선형에서 쓰던 "가격 = 픽셀 × 단가"를 그대로 쓰면 위로 갈수록 어긋난다.
//   (`padYDomain`이 여백을 만들 때 같은 이유로 곱셈을 쓴다 — 그 식과 짝이 맞아야 한다)
// ⚠ 부호: `dy`는 **화면 아래로 끈 거리**다. 캔들을 아래로 끌면 위쪽의 **더 높은 가격**이
//   드러나야 하므로 범위가 위로 올라간다.
// ⚠ 이 함수는 무엇도 제한하지 않는다 — 캔들이 화면 밖으로 나가도 그대로 민다.
//   되돌리는 길은 `A` 버튼 하나다 (트레이딩뷰와 같다)
export function shiftYDomain(yDom, dyPx, IH, isLog = false) {
  const [lo, hi] = yDom;
  if (!(IH > 0) || !Number.isFinite(lo) || !Number.isFinite(hi) || !dyPx) return [lo, hi];
  const r = dyPx / IH;
  if (!isLog) {
    const d = (hi - lo) * r;
    return finiteOr([lo + d, hi + d], yDom);
  }
  // 로그: 범위 전체에 같은 배율을 곱한다 (비율이 유지된다)
  const safeLo = Math.max(lo, LOG_MIN);
  const safeHi = Math.max(hi, safeLo * 1.000001);
  const f = Math.pow(safeHi / safeLo, r);
  return finiteOr([safeLo * f, safeHi * f], yDom);
}

// 세로 범위를 **커서 자리를 기준으로 같은 배율만큼** 넓히거나 좁힌다 (2026-09-06 사용자 요청)
//
// ⚠ 왜 필요한가: 화면 이동 모드(`A`)에서 휠로 축소했더니 **캔들이 세로로 길어 보였다**.
//   가로만 넓히고 세로를 그대로 두면 그림이 옆으로 눌린다 — 사용자가 원한 것은
//   "사진을 축소하듯" 가로세로가 **같은 비율로** 줄어드는 것이다.
// ⚠ 기준점은 커서다. 가로가 커서 아래의 봉을 붙잡고 확대하므로, 세로도 커서가 가리키는
//   가격을 붙잡아야 그 지점이 제자리에 남는다.
//
// @param ratioFromTop 커서가 캔들 영역의 위에서 몇 번째 비율에 있나 (0 = 맨 위, 1 = 맨 아래)
// @param factor       가로에 쓴 것과 **같은 값** (1보다 크면 축소, 작으면 확대)
export function zoomYDomain(yDom, factor, ratioFromTop, isLog = false) {
  const [lo, hi] = yDom;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(factor > 0)) return [lo, hi];
  const r = Math.min(1, Math.max(0, ratioFromTop));   // 커서가 캔들 영역 밖이면 가장자리로 본다
  if (!isLog) {
    const p = hi - (hi - lo) * r;                      // 커서가 가리키는 가격
    return finiteOr([p - (p - lo) * factor, p + (hi - p) * factor], yDom);
  }
  // 로그: 배율 공간(log)에서 같은 계산을 한다 — `shiftYDomain`이 곱셈을 쓰는 것과 같은 이유
  const safeLo = Math.max(lo, LOG_MIN);
  const safeHi = Math.max(hi, safeLo * 1.000001);
  const L = Math.log(safeLo), H = Math.log(safeHi);
  const P = H - (H - L) * r;
  return finiteOr([Math.exp(P - (P - L) * factor), Math.exp(P + (H - P) * factor)], yDom);
}

export function getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog = false) {
  if (!candles.length || IW <= 0 || IH <= 0) return null;
  const xDom = xDomainRef.current ?? initialXDomain(candles);
  const yDom = yDomainRef.current ?? fitYDomain(candles, xDom, isLog);
  // ⚠ 로그 축은 0 이하를 못 그린다 — 위아래 **둘 다** 막는다. 세로 범위는 사람이 끌어
  //   옮길 수 있어서(화면 이동 모드) 선형에서 0 아래로 내려간 채 로그를 켤 수 있다
  const logYDom = isLog
    ? [Math.max(yDom[0], LOG_MIN), Math.max(yDom[1], LOG_MIN * 1.001)]
    : yDom;
  return {
    xScale: d3.scaleLinear().domain(xDom).range([0, IW]),
    yScale: (isLog ? d3.scaleLog() : d3.scaleLinear()).domain(logYDom).range([IH, 0]),
  };
}
