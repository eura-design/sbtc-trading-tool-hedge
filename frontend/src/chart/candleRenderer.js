import * as d3 from "d3";
import { M, CANVAS_C } from "../constants";
import { initCanvas, withClip, getVisibleRange } from "./canvasUtils";
import { renderFVG, renderOrderBlock, renderSRLines, renderEMA, renderMarketStructure } from "./overlayRenderers";

export { renderVolumeCanvas } from "./volumeRenderer";
export { renderRSICanvas }    from "./rsiRenderer";

const OPACITY = 0.7;
const _upMap = new Map();
const _dnMap = new Map();

function fmtTime(t, interval_) {
  const d = t instanceof Date ? t : new Date(t);
  return (interval_ === "1d" || interval_ === "1w")
    ? d3.timeFormat("%m/%d")(d)
    : d3.timeFormat("%d일 %H:%M")(d);
}

export function renderCandles(canvas, candles, xScale, yScale, IW, IH, interval_, isDark, overlaysRef) {
  if (!canvas || !candles.length) return;

  const logW = IW + M.left + M.right;
  const logH = IH + M.top  + M.bottom;
  const ctx  = initCanvas(canvas, logW, logH);

  const upColor   = isDark ? CANVAS_C.BULL_DARK : CANVAS_C.BULL_LIGHT;
  const downColor = isDark ? CANVAS_C.BEAR_DARK : CANVAS_C.BEAR_LIGHT;

  const [i0, i1] = getVisibleRange(xScale, candles.length);
  const bw        = Math.max((xScale(1) - xScale(0)) * 0.65, 1);
  const pxPerBar  = xScale(1) - xScale(0);

  // ── 캔들 ──────────────────────────────────────────────────────────────────
  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.globalAlpha = OPACITY;

    if (pxPerBar < 2) {
      // 압축 렌더: 픽셀 컬럼별 min/max 병합
      _upMap.clear();
      _dnMap.clear();
      for (let i = i0; i <= i1; i++) {
        const c   = candles[i];
        const px  = Math.round(xScale(i));
        const map = c.c >= c.o ? _upMap : _dnMap;
        const ex  = map.get(px);
        if (!ex) { map.set(px, { lo: c.l, hi: c.h }); }
        else      { ex.lo = Math.min(ex.lo, c.l); ex.hi = Math.max(ex.hi, c.h); }
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = upColor;
      ctx.beginPath();
      for (const [px, { lo, hi }] of _upMap) { ctx.moveTo(px, yScale(hi)); ctx.lineTo(px, yScale(lo)); }
      ctx.stroke();
      ctx.strokeStyle = downColor;
      ctx.beginPath();
      for (const [px, { lo, hi }] of _dnMap) { ctx.moveTo(px, yScale(hi)); ctx.lineTo(px, yScale(lo)); }
      ctx.stroke();
    } else {
      // 일반 렌더: 색상별 4-batch
      const hw = bw / 2;
      ctx.lineWidth = 1;

      ctx.strokeStyle = upColor;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const c = candles[i];
        if (c.c < c.o) continue;
        const x = xScale(i);
        ctx.moveTo(x, yScale(c.h));
        ctx.lineTo(x, yScale(c.l));
      }
      ctx.stroke();

      ctx.strokeStyle = downColor;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const c = candles[i];
        if (c.c >= c.o) continue;
        const x = xScale(i);
        ctx.moveTo(x, yScale(c.h));
        ctx.lineTo(x, yScale(c.l));
      }
      ctx.stroke();

      ctx.fillStyle = upColor;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const c = candles[i];
        if (c.c < c.o) continue;
        const yTop  = yScale(c.c);
        const bodyH = Math.max(Math.abs(yScale(c.o) - yScale(c.c)), 1);
        ctx.rect(xScale(i) - hw, yTop, bw, bodyH);
      }
      ctx.fill();

      ctx.fillStyle = downColor;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const c = candles[i];
        if (c.c >= c.o) continue;
        const yTop  = yScale(c.o);
        const bodyH = Math.max(Math.abs(yScale(c.o) - yScale(c.c)), 1);
        ctx.rect(xScale(i) - hw, yTop, bw, bodyH);
      }
      ctx.fill();
    }
  });

  // ── Canvas 오버레이 ────────────────────────────────────────────────────────
  ctx.globalAlpha = 1;
  const ov = overlaysRef?.current ?? {};
  if (!ov._panning) {
    if (ov.showFVG && ov.fvgData?.length)   renderFVG(ctx, ov.fvgData, xScale, yScale, IW, IH);
    if (ov.showOB  && ov.obData?.length)    renderOrderBlock(ctx, ov.obData, xScale, yScale, IW, IH);
    if (ov.showSR  && ov.srLevels?.length)  renderSRLines(ctx, ov.srLevels, yScale, IW, IH, isDark);
    if (ov.showEMA && ov.emaData?.length)   renderEMA(ctx, ov.emaData, xScale, yScale, IW, IH);
    if (ov.showMS  && ov.msData?.length)    renderMarketStructure(ctx, ov.msData, xScale, yScale, IW, IH);
  }

  // ── X 축 ──────────────────────────────────────────────────────────────────
  ctx.globalAlpha  = 1;
  ctx.lineWidth    = 1;
  ctx.font         = "12px 'JetBrains Mono', 'Fira Code', 'Courier New', monospace";

  ctx.strokeStyle  = CANVAS_C.AXIS;
  ctx.beginPath();
  ctx.moveTo(M.left, M.top + IH);
  ctx.lineTo(M.left + IW, M.top + IH);
  ctx.stroke();

  ctx.strokeStyle  = CANVAS_C.AXIS;
  ctx.beginPath();
  const xTicks = xScale.ticks(6);
  for (const tickIdx of xTicks) {
    const x = M.left + xScale(tickIdx);
    ctx.moveTo(x, M.top + IH);
    ctx.lineTo(x, M.top + IH + 4);
  }
  ctx.stroke();

  ctx.fillStyle    = CANVAS_C.XTICK;
  ctx.textAlign    = "center";
  ctx.textBaseline = "top";
  for (const tickIdx of xTicks) {
    const ci = Math.max(0, Math.min(Math.round(tickIdx), candles.length - 1));
    const x  = M.left + xScale(tickIdx);
    ctx.fillText(fmtTime(candles[ci].t, interval_), x, M.top + IH + 6);
  }

  // ── Y 축 ──────────────────────────────────────────────────────────────────
  ctx.strokeStyle  = CANVAS_C.AXIS;
  ctx.beginPath();
  ctx.moveTo(M.left + IW, M.top);
  ctx.lineTo(M.left + IW, M.top + IH);

  const yTicks = yScale.ticks(7);
  for (const v of yTicks) {
    const y = M.top + yScale(v);
    ctx.moveTo(M.left + IW, y);
    ctx.lineTo(M.left + IW + 4, y);
  }
  ctx.stroke();

  ctx.fillStyle    = CANVAS_C.YTICK;
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  for (const v of yTicks) {
    ctx.fillText(d3.format(",.0f")(v), M.left + IW + 6, M.top + yScale(v));
  }
}
