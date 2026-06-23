// 캔들 인덱스 → 타임스탬프 변환 (미래 및 과거 영역 외삽 포함)
export function idxToTimestamp(rawIdx, candles) {
  const lastIdx = candles.length - 1;
  if (lastIdx < 0) return 0;

  if (candles.length >= 2) {
    const t0 = +candles[0].t;
    const t1 = +candles[1].t;
    const interval = t1 - t0;

    if (rawIdx > lastIdx) {
      const di = Math.round(rawIdx) - lastIdx;
      const tLast = +candles[lastIdx].t;
      return tLast + di * interval;
    }
    if (rawIdx < 0) {
      const di = Math.round(rawIdx);
      return t0 + di * interval;
    }
  }

  const idx = Math.max(0, Math.min(Math.round(rawIdx), lastIdx));
  return +candles[idx].t;
}

// 캔들 간격(ms) 계산
export function getCandleMs(candles) {
  return candles.length > 1 ? +candles[1].t - +candles[0].t : 3600000;
}
