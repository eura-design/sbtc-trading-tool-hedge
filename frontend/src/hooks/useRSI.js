import { useRef } from "react";

const toRsi = (ag, al) => al === 0 ? 100 : 100 - 100 / (1 + ag / al);

/**
 * RSI — Wilder's smoothing.
 * 각 포인트에 bar index(i) 포함.
 * params.period 로 기간 조절 가능 (기본 14).
 */
export function useRSI(candles, params = {}) {
  const period   = params.period ?? 14;
  const cacheRef = useRef(null);

  if (candles.length < period + 1) {
    cacheRef.current = null;
    return [];
  }

  const t0    = candles[0].t instanceof Date ? candles[0].t.getTime() : +candles[0].t;
  const cache = cacheRef.current;

  if (cache && cache.t0 === t0 && cache.period === period && candles.length >= cache.len && cache.len > 0) {
    const newLen = candles.length;

    if (newLen === cache.len) {
      const d  = candles[newLen - 1].c - candles[newLen - 2].c;
      const ag = (cache.ag_prev * (period - 1) + Math.max(d, 0)) / period;
      const al = (cache.al_prev * (period - 1) + Math.max(-d, 0)) / period;
      const newRsi = toRsi(ag, al);

      const lastRsi = cache.data[cache.data.length - 1]?.rsi ?? -1;
      if (Math.abs(lastRsi - newRsi) < 0.01) return cache.data;

      const result = [...cache.data.slice(0, -1), { t: candles[newLen - 1].t, i: newLen - 1, rsi: newRsi }];
      cache.ag = ag; cache.al = al; cache.data = result;
      return result;
    }

    if (newLen === cache.len + 1) {
      const { ag: prevAg, al: prevAl } = cache;
      const d  = candles[newLen - 1].c - candles[newLen - 2].c;
      const ag = (prevAg * (period - 1) + Math.max(d, 0)) / period;
      const al = (prevAl * (period - 1) + Math.max(-d, 0)) / period;
      const result = [...cache.data, { t: candles[newLen - 1].t, i: newLen - 1, rsi: toRsi(ag, al) }];
      cacheRef.current = { t0, period, len: newLen, data: result, ag, al, ag_prev: prevAg, al_prev: prevAl };
      return result;
    }
  }

  // 전체 재계산 (period 변경 또는 캐시 미스)
  const closes = candles.map(c => c.c);
  const data   = [];
  let ag = 0, al = 0;

  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  data.push({ t: candles[period].t, i: period, rsi: toRsi(ag, al) });

  let ag_prev = ag, al_prev = al;
  for (let i = period + 1; i < closes.length; i++) {
    ag_prev = ag; al_prev = al;
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    data.push({ t: candles[i].t, i, rsi: toRsi(ag, al) });
  }

  cacheRef.current = { t0, period, len: closes.length, data, ag, al, ag_prev, al_prev };
  return data;
}
