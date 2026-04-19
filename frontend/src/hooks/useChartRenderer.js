import { useState, useEffect, useCallback, useRef } from "react";

// 로그 스케일 패딩: 로그 공간에서 비율로 패딩 적용 (선형과 동등한 시각적 여백)
// 선형: [lo - range*p, hi + range*p]
// 로그: [(hi/lo)^p 만큼 로그 공간에서 양쪽 확장] → lo/(hi/lo)^p, hi*(hi/lo)^p
// 분봉처럼 range가 좁아도 선형과 동일한 픽셀 비율로 패딩됨
function padYDomain(lo, hi, padFrac, isLog) {
  if (!isLog) return [lo - (hi - lo) * padFrac, hi + (hi - lo) * padFrac];
  const safeLo = Math.max(lo, 1);
  const safeHi = Math.max(hi, safeLo * 1.001);
  const logPad = Math.pow(safeHi / safeLo, padFrac);
  return [safeLo / logPad, safeHi * logPad];
}
import * as d3 from "d3";
import { getScales } from "../chart/scales";
import { renderCandles, renderVolumeCanvas, renderRSICanvas } from "../chart/candleRenderer";

export function useChartRenderer({ candles, candlesRef, interval_, isDark, IW, IH, canvasRef, volCanvasRef, rsiCanvasRef, isLog = false, overlaysRef }) {
  const xDomainRef         = useRef(null);
  const yDomainRef         = useRef(null);
  const scalesRef          = useRef(null); // 마지막으로 계산된 scales 캐시
  const prevCandleCountRef = useRef(0);
  const isInitialLoadRef   = useRef(true);
  const [renderTick, setRenderTick] = useState(0);
  const forceUpdate = () => setRenderTick(n => n + 1);

  // 틱 RAF에서 호출 — 메인 캔버스만 재드로우 (볼륨 제외)
  const redrawCanvas = useCallback(() => {
    const c = candlesRef.current;
    const scales = getScales(c, xDomainRef, yDomainRef, IW, IH, isLog);
    if (!scales || !canvasRef.current) return;
    scalesRef.current = scales; // 캐시 갱신
    renderCandles(canvasRef.current, c, scales.xScale, scales.yScale, IW, IH, interval_, isDark, overlaysRef);
  }, [interval_, IW, IH, isDark, isLog]); // eslint-disable-line react-hooks/exhaustive-deps

  // 볼륨 캔버스만 재드로우 — 틱과 무관, pan/zoom/candle close 시에만 호출
  const redrawVolume = useCallback(() => {
    const ov = overlaysRef?.current ?? {};
    if (!volCanvasRef?.current || !scalesRef.current || !ov.showVol || ov.volH <= 0) return;
    renderVolumeCanvas(volCanvasRef.current, candlesRef.current, scalesRef.current.xScale, IW, ov.volH, isDark, ov.volColorMode);
  }, [IW, isDark]); // eslint-disable-line react-hooks/exhaustive-deps

  // RSI 캔버스만 재드로우 — pan/zoom 중 RSI가 즉시 따라오도록 (volume과 동일 패턴)
  const redrawRSI = useCallback(() => {
    const ov = overlaysRef?.current ?? {};
    if (!rsiCanvasRef?.current || !scalesRef.current || !ov.showRsi || ov.rsiH <= 0) return;
    renderRSICanvas(rsiCanvasRef.current, ov.rsiData, scalesRef.current.xScale, IW, ov.rsiH, isDark, ov.rsiParams);
  }, [IW, isDark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Canvas + SVG 오버레이 동기화 (pan 종료, 줌, 데이터 변경 시 사용)
  const redrawChart = useCallback(() => {
    redrawCanvas();
    redrawVolume();
    redrawRSI();
    forceUpdate();
  }, [redrawCanvas, redrawVolume, redrawRSI]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!candles.length) return;

    if (!xDomainRef.current || isInitialLoadRef.current) {
      const lastIdx = candles.length - 1;
      xDomainRef.current = [lastIdx - 300, lastIdx + 50];
      const i0 = Math.max(0, lastIdx - 300);
      const visible = candles.slice(i0);
      const yC = visible.length > 0 ? visible : candles;
      const lo = d3.min(yC, d => d.l), hi = d3.max(yC, d => d.h);
      yDomainRef.current = padYDomain(lo, hi, 0.06, isLog);
      isInitialLoadRef.current   = false;
      prevCandleCountRef.current = candles.length;
      redrawChart(); return;
    }

    if (candles.length !== prevCandleCountRef.current) {
      prevCandleCountRef.current = candles.length;
      const lastIdx = candles.length - 1;
      const [i0, i1] = xDomainRef.current;
      if (lastIdx > i1) {
        const span = i1 - i0;
        xDomainRef.current = [lastIdx - span + 50, lastIdx + 50];
      }
      redrawChart(); return;
    }

    // 틱 업데이트는 useCandles의 onTickRef 콜백(RAF)이 직접 처리 — 여기서는 아무것도 하지 않음
  }, [candles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { redrawChart(); }, [IW, IH]);    // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                  // eslint-disable-line react-hooks/exhaustive-deps
    const c = candlesRef.current;
    if (!c.length || !xDomainRef.current) { redrawChart(); return; }
    const [i0, i1] = xDomainRef.current;
    const vi0 = Math.max(0, Math.floor(i0));
    const vi1 = Math.min(c.length - 1, Math.ceil(i1));
    const vis = c.slice(vi0, vi1 + 1);
    const yC  = vis.length > 0 ? vis : c;
    const lo  = d3.min(yC, d => d.l), hi = d3.max(yC, d => d.h);
    const zr  = (i1 - i0) / (c.length - 1 || 1);
    const padFrac = Math.max(0.08, zr * 0.5);
    yDomainRef.current = padYDomain(lo, hi, padFrac, isLog);
    redrawChart();
  }, [isLog]);
  useEffect(() => { redrawChart(); }, [isDark]);    // eslint-disable-line react-hooks/exhaustive-deps

  const resetDomain = useCallback(() => {
    isInitialLoadRef.current   = true;
    prevCandleCountRef.current = 0;
    xDomainRef.current         = null;
    yDomainRef.current         = null;
    scalesRef.current          = null;
  }, []);

  return { xDomainRef, yDomainRef, scalesRef, redrawCanvas, redrawChart, redrawVolume, redrawRSI, resetDomain, renderTick };
}
