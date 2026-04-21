import { useMemo } from "react";

// ICT 유동성: Equal High/Low 클러스터 + 스윕/돌파 판정
//   - 스윙을 찾아 비슷한 가격대(tolerance%)끼리 묶음 → 유동성 풀
//   - level = 풀의 실제 레벨 (EQH=클러스터 max / EQL=클러스터 min)
//     이 level은 스톱이 사실상 걸려있는 가격으로, 스윕 기준점 역할
//   - 상태 (status):
//       'live'   : 아직 터치 안 됨
//       'swept'  : wick이 level을 뚫고 종가가 level 내부로 돌아옴 = ICT 스톱헌트 (매매 기회)
//       'broken' : 종가가 level을 완전히 돌파 = 추세 돌파 (매매 관점 무의미)
export function useLiquidity(candles, params = {}) {
  const swing_lb      = params.swing_lb      ?? 5;
  const tolerance_pct = params.tolerance_pct ?? 0.15;
  const scan_from     = params.scan_from     ?? 500;
  const max_display   = params.max_display   ?? 10;
  const min_touches   = params.min_touches   ?? 2;

  return useMemo(() => {
    if (candles.length < swing_lb * 2 + 1) return [];

    const scanStart = Math.max(swing_lb, candles.length - scan_from);
    const swingHighs = [], swingLows = [];

    for (let i = scanStart; i < candles.length - swing_lb; i++) {
      let isHigh = true, isLow = true;
      for (let j = 1; j <= swing_lb; j++) {
        if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isHigh = false;
        if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isLow  = false;
      }
      if (isHigh) swingHighs.push({ i, price: candles[i].h });
      if (isLow)  swingLows.push({ i, price: candles[i].l });
    }

    const tolFrac = tolerance_pct / 100;
    const result  = [];

    const makeClusters = (points, type) => {
      const used = new Set();
      for (let i = 0; i < points.length; i++) {
        if (used.has(i)) continue;
        const group = [points[i]];
        used.add(i);
        const ref = points[i].price;
        for (let j = i + 1; j < points.length; j++) {
          if (used.has(j)) continue;
          const diff = Math.abs(points[j].price - ref) / ref;
          if (diff <= tolFrac) { group.push(points[j]); used.add(j); }
        }
        if (group.length < min_touches) continue;

        let startIdx = Infinity, endIdx = -Infinity, maxP = -Infinity, minP = Infinity;
        for (const p of group) {
          if (p.i < startIdx) startIdx = p.i;
          if (p.i > endIdx)   endIdx   = p.i;
          if (p.price > maxP) maxP = p.price;
          if (p.price < minP) minP = p.price;
        }
        // 스톱이 사실상 걸려있는 레벨: EQH=클러스터 max, EQL=클러스터 min
        const level = type === "EQH" ? maxP : minP;

        // 상태 판정: 마지막 터치 이후 스윙이 level에 어떻게 작용했는지
        let status = "live", sweptIdx = -1;
        for (let k = endIdx + 1; k < candles.length; k++) {
          const c = candles[k];
          if (type === "EQH") {
            if (c.c > level) { status = "broken"; sweptIdx = k; break; }  // 종가 돌파 = 완전 돌파
            if (c.h > level) { status = "swept";  sweptIdx = k; break; }  // 꼬리만 돌파 = 스톱헌트
          } else {
            if (c.c < level) { status = "broken"; sweptIdx = k; break; }
            if (c.l < level) { status = "swept";  sweptIdx = k; break; }
          }
        }
        result.push({ type, price: level, startIdx, endIdx, status, sweptIdx, touches: group.length });
      }
    };

    makeClusters(swingHighs, "EQH");
    makeClusters(swingLows,  "EQL");

    // 최근 것부터 우선 표시
    return result.sort((a, b) => b.endIdx - a.endIdx).slice(0, max_display);
  }, [candles, swing_lb, tolerance_pct, scan_from, max_display, min_touches]);
}
