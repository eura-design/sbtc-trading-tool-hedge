import { useRef, useMemo } from "react";

function calcEMA(candles, period) {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const data = [];
  let ema = 0;
  for (let i = 0; i < period; i++) ema += candles[i].c;
  ema /= period;
  data.push({ i: period - 1, ema });
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].c * k + ema * (1 - k);
    data.push({ i, ema });
  }
  return data;
}

/**
 * 다중 EMA 계산.
 * emaList: [{ id, period, color }]
 * 반환: [{ id, period, color, data: [{ i, ema }] }]
 *
 * useMemo로 감싸 candles/emaList가 변하지 않는 한 동일 배열 참조 반환.
 * (참조가 매 렌더마다 바뀌면 useEffect deps가 매 렌더 발화 → redrawChart 무한루프)
 */
export function useEMA(candles, emaList) {
  const cacheRef = useRef(new Map());
  return useMemo(() => {
    if (!candles.length || !emaList?.length) return [];
    const t0  = candles[0].t instanceof Date ? candles[0].t.getTime() : +candles[0].t;
    const len = candles.length;
    const result = [];
    for (const { id, period, color, enabled } of emaList) {
      const cache = cacheRef.current.get(id);
      if (cache && cache.t0 === t0 && cache.period === period && cache.len === len) {
        result.push({ id, period, color, enabled, data: cache.data });
      } else {
        const data = calcEMA(candles, period);
        cacheRef.current.set(id, { t0, period, len, data });
        result.push({ id, period, color, enabled, data });
      }
    }
    return result;
  }, [candles, emaList]); // eslint-disable-line react-hooks/exhaustive-deps
}
