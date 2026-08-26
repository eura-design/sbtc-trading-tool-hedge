// 지그재그 꼭짓점 판정 — **자동 ZZ 지표와 커스텀 구조의 자동 이어그리기가 함께 쓴다**
//
// 원래 chart/structureZigzag.js 안에만 있던 것을 2026-08-26에 꺼냈다. 커스텀 구조에
// "내가 찍은 마지막 점 이후는 자동으로 꼭짓점을 찾아준다"가 생기면서(chart/structAutoPivots.js)
// 같은 판정이 두 곳에서 필요해졌기 때문이다.
//
// ⚠ **규칙을 복사해 두 벌로 만들지 말 것.** 한쪽만 고치면 같은 차트에서 자동 지그재그와
//   커스텀 구조의 자동 구간이 서로 다른 자리에 꼭짓점을 찍는다. 둘을 나란히 켜고
//   "자동이 잡은 자리가 내가 본 자리와 같은가"를 눈으로 맞춰보는 게 이 기능의 쓸모라,
//   어긋나는 순간 쓸모 자체가 사라진다.
//
// 여기 담는 것은 **판정 규칙뿐**이다. "그래서 무엇을 그릴 것인가"(CHoCH·bias·세그먼트)는
// 부르는 쪽이 각자 갖는다 — 지표는 forward-only 누적이고, 커스텀 구조는 deriveStructure가
// 꼭짓점 목록에서 매번 다시 뽑는다. 그 차이가 있어서 step() 통째로는 공유할 수 없다.

// 파라미터 기본값 — **두 곳의 시작 값이 같아야 한다**.
// ⚠ 시작 값만 같고 **설정 자체는 공유하지 않는다** (2026-08-26 사용자 확정):
//   자동 구조 지표는 `indicatorParams.zz`(전역 하나), 커스텀 구조의 자동 이어그리기는
//   `structures[].autoParams`(구조마다). 구조마다 다른 설정을 쓰려는 것이 요구사항이라
//   전역 값 하나로는 애초에 성립하지 않는다.
//   여기서 기본값을 바꾸면 **양쪽 처음 값이 같이 움직인다** — 그게 의도다.
//   ⚠ 다만 **이미 저장된 값이 기본값을 이긴다.** 지표 쪽은 브라우저의 `indicatorParams`,
//     커스텀 구조 쪽은 `structures[].autoParams`가 원본이다 — 기본값만 바꾸면
//     이미 쓰던 브라우저는 그대로다.
export function resolveZzParams(params = {}) {
  return {
    // 2026-08-26 사용자 지정: 피벗 감지 2봉 / ATR 배수 1.0 / ATR 기간 14.
    // 자동 구조 지표와 커스텀 자동 이어그리기의 **처음 값이 같아야** 한다 —
    // 여기를 바꾸면 양쪽이 같이 움직인다(그게 의도다).
    left_bars:  params.left_bars  ?? 2,
    use_filter: params.use_filter ?? true,
    atr_mult:   params.atr_mult   ?? 1.0,
    atr_period: params.atr_period ?? 14,
  };
}

export function trueRange(candles, i) {
  const c = candles[i];
  if (i === 0) return c.h - c.l;
  const pc = candles[i - 1].c;
  return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
}

// Wilder's ATR (Pine `ta.atr` = RMA of True Range, SMA 시드) — 전 구간 1회 계산
export function wilderATR(candles, period) {
  const n   = candles.length;
  const atr = new Array(n).fill(NaN);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const tr = trueRange(candles, i);
    if (i < period) {
      sum += tr;
      if (i === period - 1) atr[i] = sum / period;
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + tr) / period;
    }
  }
  return atr;
}

// 직전(확정) 봉 ATR에서 한 칸 전진. 진행 중 봉은 매 틱 다시 구해야 하므로
// 확정된 값을 훼손하지 않도록 부르는 쪽이 어디에 담을지 정한다.
export function atrStep(prevAtr, candles, i, period) {
  if (i < period) return NaN;
  if (prevAtr === undefined || Number.isNaN(prevAtr)) return NaN;
  return (prevAtr * (period - 1) + trueRange(candles, i)) / period;
}

/**
 * 봉 i가 피벗인가 — **오른쪽 확인봉 없이 왼쪽 leftBars 봉만 본다**.
 *   ph = high > highest(high[1], leftBars)
 *   pl = low  < lowest(low[1],  leftBars)
 * 판정은 종가가 아니라 **꼬리(고가/저가)** 기준이다 — 꼭짓점이 꼬리 끝에 놓이므로.
 *
 * 고가와 저가가 동시에 피벗일 수 있다(둘 다 null이 아님). 부르는 쪽이 고점 먼저,
 * 저점 나중 순서로 처리한다 — 순서를 바꾸면 같은 봉에서 잡히는 꼭짓점이 달라진다.
 */
export function pivotAt(candles, i, leftBars) {
  if (i < leftBars) return { ph: null, pl: null };
  const c = candles[i];
  let hh = -Infinity, ll = Infinity;
  for (let j = 1; j <= leftBars; j++) {
    const q = candles[i - j];
    if (q.h > hh) hh = q.h;
    if (q.l < ll) ll = q.l;
  }
  return {
    ph: c.h > hh ? c.h : null,
    pl: c.l < ll ? c.l : null,
  };
}

/**
 * 노이즈 필터 — 직전 꼭짓점에서 ATR × 배수만큼은 움직여야 꼭짓점으로 인정한다.
 *
 * @param getAtr 함수로 받는다(값이 아니라). ATR 계산은 필터가 켜져 있고 직전 꼭짓점이
 *               있을 때만 필요한데, 미리 구하면 그 계산이 매 봉 헛돈다.
 */
export function passesNoiseFilter(price, lastPointPrice, getAtr, atrMult, useFilter) {
  if (!useFilter || Number.isNaN(lastPointPrice)) return true;
  const a = getAtr();
  if (a === undefined || Number.isNaN(a)) return true;
  return Math.abs(price - lastPointPrice) >= a * atrMult;
}
