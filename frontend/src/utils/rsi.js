/**
 * RSI 순수 계산 함수 (Wilder's Smoothing)
 * useRSI.js와 useAlertMonitor.js 양쪽에서 공유합니다.
 */

/** ag/al → RSI 값 */
export const toRsi = (ag, al) => al === 0 ? 100 : 100 - 100 / (1 + ag / al);

/**
 * 캔들 배열로 초기 RSI 상태(ag, al, rsi)를 빌드합니다.
 * @param {Array}  candles  - { c: number } 배열
 * @param {number} period   - RSI 기간 (기본 14)
 * @returns {{ ag: number, al: number, rsi: number } | null}
 */
export function buildRSIState(candles, period) {
  if (candles.length < period + 1) return null;
  const cl = candles.map(c => c.c);
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = cl[i] - cl[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  return { ag, al, rsi: toRsi(ag, al) };
}

/**
 * 이전 RSI 상태에서 새 틱 가격 한 개를 적용해 현재 RSI를 반환합니다.
 * @param {{ ag: number, al: number }} state
 * @param {number} prevClose
 * @param {number} currClose
 * @param {number} period
 * @returns {number | null}
 */
export function tickRSI(state, prevClose, currClose, period) {
  if (!state) return null;
  const d  = currClose - prevClose;
  const ag = (state.ag * (period - 1) + Math.max(d, 0)) / period;
  const al = (state.al * (period - 1) + Math.max(-d, 0)) / period;
  return toRsi(ag, al);
}

/**
 * 캔들 배열 전체에 대한 RSI 배열({ t, rsi })을 빌드합니다.
 * useAlertMonitor의 다이버전스 감지에 사용됩니다.
 * @param {Array}  candles
 * @param {number} period
 * @returns {Array<{ t: Date, rsi: number }>}
 */
export function buildRSIArray(candles, period) {
  if (candles.length < period + 1) return [];
  const cl = candles.map(c => c.c);
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = cl[i] - cl[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  const data = [{ t: candles[period].t, rsi: toRsi(ag, al) }];
  for (let i = period + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    data.push({ t: candles[i].t, rsi: toRsi(ag, al) });
  }
  return data;
}
