import { useMemo } from "react";

// ICT 시장 구조: BOS (추세 지속) vs CHoCH (추세 전환)
//
// Protected swing 로직:
//   - Bullish 추세 중에는 pendingHigh(BOS 후보)를 "더 높은 HH가 나올 때만" 갱신
//     → 풀백 중의 작은 swing high(internal structure)는 무시
//   - pendingLow(CHoCH 후보)는 항상 최신 swing low로 갱신 → 즉각 전환 감지
//   - Bearish 추세에선 대칭
//   - trend가 null이면 양쪽 모두 최신 스윙으로 갱신 (초기 구조 탐색 단계)
//
// 돌파 기준: 종가 (c.c > pendingHigh.price OR c.c < pendingLow.price)
export function useMarketStructure(candles, params = {}) {
  const swing_lb    = params.swing_lb    ?? 5;
  const scan_from   = params.scan_from   ?? 500;
  const max_display = params.max_display ?? 15;
  const close_only  = params.close_only  ?? true;  // true=봉마감 기준(보수적) / false=꼬리 기준(적극적)
  const show_bos    = params.show_bos    ?? true;  // false면 CHoCH만 표시

  return useMemo(() => {
    if (candles.length < swing_lb * 2 + 1) return [];

    const scanStart = Math.max(swing_lb, candles.length - scan_from);

    // 1) 스윙 선검출 (시간 순)
    const swings = [];
    for (let i = scanStart; i < candles.length - swing_lb; i++) {
      let isHigh = true, isLow = true;
      for (let j = 1; j <= swing_lb; j++) {
        if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isHigh = false;
        if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isLow  = false;
      }
      if (isHigh) swings.push({ type: "H", i, price: candles[i].h });
      if (isLow)  swings.push({ type: "L", i, price: candles[i].l });
    }
    swings.sort((a, b) => a.i - b.i);

    // 2) 시간 순 진행하며 protected swing 추적 + 돌파 이벤트 생성
    let trend = null;            // 'bull' | 'bear' | null
    let pendingHigh = null;       // { i, price }
    let pendingLow  = null;
    let swingPtr = 0;
    const events = [];

    for (let i = scanStart; i < candles.length; i++) {
      // swing은 i + swing_lb 시점에 확정됨
      while (swingPtr < swings.length && swings[swingPtr].i + swing_lb <= i) {
        const sw = swings[swingPtr++];
        if (sw.type === "H") {
          // 추세가 bull이면 HH(더 높은 고점)일 때만 갱신 → internal structure 필터
          // 그 외(null/bear)엔 항상 최신 high로 갱신
          if (trend === "bull") {
            if (!pendingHigh || sw.price > pendingHigh.price) pendingHigh = sw;
          } else {
            pendingHigh = sw;
          }
        } else {
          if (trend === "bear") {
            if (!pendingLow || sw.price < pendingLow.price) pendingLow = sw;
          } else {
            pendingLow = sw;
          }
        }
      }

      const c = candles[i];
      const breakHigh = close_only ? c.c > pendingHigh?.price : c.h > pendingHigh?.price;
      const breakLow  = close_only ? c.c < pendingLow?.price  : c.l < pendingLow?.price;
      if (pendingHigh && breakHigh) {
        const kind = trend === "bear" ? "CHoCH" : "BOS";
        events.push({ kind, dir: "bull", brokenPrice: pendingHigh.price, brokenIdx: pendingHigh.i, atIdx: i });
        trend = "bull";
        pendingHigh = null;
      }
      if (pendingLow && breakLow) {
        const kind = trend === "bull" ? "CHoCH" : "BOS";
        events.push({ kind, dir: "bear", brokenPrice: pendingLow.price, brokenIdx: pendingLow.i, atIdx: i });
        trend = "bear";
        pendingLow = null;
      }
    }

    const filtered = show_bos ? events : events.filter(e => e.kind === "CHoCH");
    return filtered.slice(-max_display);
  }, [candles, swing_lb, scan_from, max_display, close_only, show_bos]);
}
