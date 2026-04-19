import { tsToIdx } from "../chart/scales";

/**
 * 점 (px, py)에서 선분 (x1,y1)-(x2,y2)까지의 최단 거리.
 */
export function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2-x1, dy = y2-y1, lenSq = dx*dx+dy*dy;
  if (lenSq === 0) return Math.hypot(px-x1, py-y1);
  const t = Math.max(0, Math.min(1, ((px-x1)*dx+(py-y1)*dy)/lenSq));
  return Math.hypot(px-(x1+t*dx), py-(y1+t*dy));
}

/**
 * 선분 배열에서 클릭된 선을 찾는다.
 * timestamp(t1/t2) → tsToIdx → xScale(barIndex) 변환으로 현재 타임프레임에 정확히 매핑.
 */
export function findHitLine(px, py, lines, xScale, yScale, candles, threshold = 8, isLog = false) {
  return lines.find(ln => {
    const i1 = tsToIdx(ln.t1, candles);
    const i2 = tsToIdx(ln.t2, candles);
    const ax = xScale(i1), ay = yScale(ln.p1);
    const bx = xScale(i2), by = yScale(ln.p2);
    if (!isLog) return distToSeg(px, py, ax, ay, bx, by) < threshold;
    // 로그 모드: 지수 보간 폴리라인의 각 세그먼트에 대해 히트 테스트
    const N = 20;
    for (let i = 0; i < N; i++) {
      const a0 = i / N, a1 = (i + 1) / N;
      const x0 = xScale(i1 + (i2 - i1) * a0);
      const x1 = xScale(i1 + (i2 - i1) * a1);
      const y0 = yScale(ln.p1 * Math.pow(ln.p2 / ln.p1, a0));
      const y1 = yScale(ln.p1 * Math.pow(ln.p2 / ln.p1, a1));
      if (distToSeg(px, py, x0, y0, x1, y1) < threshold) return true;
    }
    return false;
  });
}
