import { useMemo } from "react";

// TradingView 방식 Market Structure (CHoCH / BOS)
//
// 감지 개념:
//   현재 JS(useMarketStructure): "이전 스윙 레벨을 종가로 돌파" → 돌파 봉에서 즉시 표시
//   이 훅(TV 방식):              "새 HH/LL 피벗이 형성" → 피벗 확정 시점에 표시
//
// TV 원본 로직:
//   - ta.pivothigh/pivotlow 로 좌우 비대칭 pivot 감지 가능 (leftBars / rightBars)
//   - lastConfirmedHigh/Low: 항상 최신 pivot으로 갱신
//   - isHH = 새 pivot > 이전 pivot → bias=1, 이전 bias=-1이면 CHoCH ↑
//   - isLL = 새 pivot < 이전 pivot → bias=-1, 이전 bias=1이면 CHoCH ↓
//   - Noise filter: 이전 레벨과 % 차이가 일정 미만이면 무시
//
// 출력 포맷: renderMarketStructure 와 동일
//   { kind: "CHoCH"|"BOS", dir: "bull"|"bear",
//     brokenPrice, brokenIdx, atIdx }
//
//   brokenPrice : 새 HH/LL가 경신한 이전 pivot 가격 (수평선이 그려지는 레벨)
//   brokenIdx   : 이전 pivot 봉 위치 (선 시작)
//   atIdx       : 새 pivot 확정 봉 위치 (선 끝, swing.i + rightBars)

export function useMarketStructureTV(candles, params = {}) {
  const leftBars      = params.left_bars      ?? params.swing_lb ?? 5;
  const rightBars     = params.right_bars     ?? params.swing_lb ?? 5;
  const scan_from     = params.scan_from      ?? 500;
  const max_display   = params.max_display    ?? 15;
  const show_bos      = params.show_bos       ?? true;
  const useNoiseFlt   = params.use_noise_filter ?? false;
  const minSwingPct   = params.min_swing_pct  ?? 0.5;  // %

  return useMemo(() => {
    const totalBars = leftBars + rightBars + 1;
    if (candles.length < totalBars) return [];

    const scanStart = Math.max(leftBars, candles.length - scan_from);

    // ── Phase 1: Pivot 감지 ──────────────────────────────────────────────────
    // TV의 ta.pivothigh(high, leftBars, rightBars) 와 동일
    // 좌우 비대칭 지원: 왼쪽 leftBars봉, 오른쪽 rightBars봉
    // 스윙 위치는 실제 pivot 봉(i), 확정 시점은 i + rightBars
    const swings = [];
    const end = candles.length - rightBars;

    for (let i = scanStart; i < end; i++) {
      let isHigh = true, isLow = true;

      for (let j = 1; j <= leftBars && (isHigh || isLow); j++) {
        if (candles[i].h <= candles[i - j].h) isHigh = false;
        if (candles[i].l >= candles[i - j].l) isLow  = false;
      }
      for (let j = 1; j <= rightBars && (isHigh || isLow); j++) {
        if (candles[i].h <= candles[i + j].h) isHigh = false;
        if (candles[i].l >= candles[i + j].l) isLow  = false;
      }

      // confirmIdx: TV에서 bar_index - rightBars 로 확정되는 시점
      const confirmIdx = i + rightBars;
      if (isHigh) swings.push({ type: "H", i, confirmIdx, price: candles[i].h });
      if (isLow)  swings.push({ type: "L", i, confirmIdx, price: candles[i].l });
    }

    // 확정 시점 기준 정렬 (같은 봉이면 H 먼저)
    swings.sort((a, b) => a.confirmIdx - b.confirmIdx || (a.type === "H" ? -1 : 1));

    // ── Phase 2: HH/LL 비교 → CHoCH / BOS 감지 ────────────────────────────
    // TV 원본과 동일: lastConfirmedHigh/Low 는 항상 최신 pivot 으로 갱신
    let lastH = null;   // { i, price } — 직전 pivot high
    let lastL = null;   // { i, price } — 직전 pivot low
    let bias  = 0;      // 0=초기, 1=bull, -1=bear

    const events = [];

    // Noise filter: 이전 pivot 대비 % 변화 미달이면 무시 (TV f_passesFilter 동일)
    const passesFilter = (newPrice, prevPrice) => {
      if (!useNoiseFlt || prevPrice == null) return true;
      return Math.abs(newPrice - prevPrice) / prevPrice * 100 >= minSwingPct;
    };

    for (const sw of swings) {
      if (sw.type === "H") {
        const prevPrice = lastH?.price ?? null;
        if (!passesFilter(sw.price, prevPrice)) continue;

        const isFirst = lastH === null;
        const isHH    = isFirst || sw.price > lastH.price;

        if (!isFirst && isHH) {
          // 새 HH 형성: 이전 pivot high 레벨을 경신
          const kind = bias === -1 ? "CHoCH" : "BOS";
          events.push({
            kind,
            dir:          "bull",
            brokenPrice:  lastH.price,      // 경신된 이전 pivot 가격 → 수평선
            brokenIdx:    lastH.i,          // 이전 pivot 봉 → 선 시작
            atIdx:        sw.confirmIdx,    // 새 pivot 확정 봉  → 선 끝
          });
          bias = 1;
        } else if (isFirst) {
          bias = 1; // 초기 방향 설정
        }

        lastH = sw; // 항상 최신 pivot으로 갱신 (TV lastConfirmedHigh := ph)

      } else {
        // type === "L"
        const prevPrice = lastL?.price ?? null;
        if (!passesFilter(sw.price, prevPrice)) continue;

        const isFirst = lastL === null;
        const isLL    = isFirst || sw.price < lastL.price;

        if (!isFirst && isLL) {
          const kind = bias === 1 ? "CHoCH" : "BOS";
          events.push({
            kind,
            dir:          "bear",
            brokenPrice:  lastL.price,
            brokenIdx:    lastL.i,
            atIdx:        sw.confirmIdx,
          });
          bias = -1;
        } else if (isFirst) {
          bias = -1;
        }

        lastL = sw;
      }
    }

    const filtered = show_bos ? events : events.filter(e => e.kind === "CHoCH");
    return filtered.slice(-max_display);

  }, [candles, leftBars, rightBars, scan_from, max_display, show_bos, useNoiseFlt, minSwingPct]);
}
