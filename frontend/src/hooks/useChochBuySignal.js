import { useMemo } from "react";
import { useMarketStructure } from "./useMarketStructure";

export function useChochBuySignal(candles, msParams = {}, chochoParams = {}) {
  const msEvents = useMarketStructure(candles, { ...msParams, show_bos: true, max_display: 10000 });
  const lookback = chochoParams.lookback ?? 10;

  return useMemo(() => {
    const chochoEvents = [];
    let isLowUpdated = false;
    let lastBearIdx = 0;

    for (const ev of msEvents) {
      if (ev.dir === "bear") {
        isLowUpdated = true;
        lastBearIdx = ev.atIdx;
      } else if (ev.dir === "bull" && ev.kind === "CHoCH") {
        if (isLowUpdated) {
          // CHoCH 돌파 지점(ev.atIdx)과 돌파된 고점(ev.brokenIdx) 사이의 최저점(구조적 저점)을 찾음
          const searchStart = ev.brokenIdx;
          let minIdx = searchStart;
          let minLow = candles[searchStart]?.l ?? Infinity;

          for (let i = searchStart; i <= ev.atIdx; i++) {
            if (candles[i] && candles[i].l < minLow) {
              minLow = candles[i].l;
              minIdx = i;
            }
          }

          // 최저점(minIdx)이 그 이전 N개 캔들의 저점보다 낮아야 하는 조건 추가
          let isLowestOfLastN = true;
          const checkStart = Math.max(0, minIdx - lookback);
          
          for (let i = checkStart; i < minIdx; i++) {
            if (candles[i] && candles[i].l <= minLow) {
              isLowestOfLastN = false;
              break;
            }
          }

          if (isLowestOfLastN) {
            chochoEvents.push({
              ...ev,
              kind: "ChoCho",
            });
          }
        }
        isLowUpdated = false;
      } else if (ev.dir === "bull" && ev.kind === "BOS") {
        isLowUpdated = false;
      }
    }

    const max_display = msParams.max_display ?? 15;
    return chochoEvents.slice(-max_display);
  }, [msEvents, candles, msParams.max_display, lookback]);
}

