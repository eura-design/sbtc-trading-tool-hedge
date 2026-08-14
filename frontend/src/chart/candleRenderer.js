import * as d3 from "d3";
import { M, CANVAS_C, RSI_ZONE_MAX } from "../constants";
import { initCanvas, withClip, getVisibleRange } from "./canvasUtils";
import { renderFVG, renderOrderBlock, renderPivotLevels, renderEMA, renderStructureZigzag,
         computeRsiZones, clearRsiZones, renderRsiZones } from "./overlayRenderers";
import { computeStructureZigzag } from "./structureZigzag";
import { idxToTimestamp } from "../utils/coordUtils";

export { renderVolumeCanvas } from "./volumeRenderer";
export { renderRSICanvas }    from "./rsiRenderer";

const OPACITY = 0.7;
const _upMap = new Map();
const _dnMap = new Map();

function fmtTime(t, interval_) {
  const d = t instanceof Date ? t : new Date(t);
  if (interval_ === "1M") {
    return d3.timeFormat("%Y/%m")(d);
  }
  if (interval_ === "1d" || interval_ === "1w") {
    return d3.timeFormat("%y/%m/%d")(d);
  }
  return d3.timeFormat("%d일 %H:%M")(d);
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

  const ov = overlaysRef?.current ?? {};

  // ── RSI 과매수/과매도 구간 배경 ────────────────────────────────────────────
  // 캔들보다 **먼저** 그린다 — 배경이므로 캔들이 위에 얹혀야 한다.
  // 다른 오버레이와 달리 pan 중(_panning)에도 그린다: 사각형 몇 개라 비용이 없고,
  // 배경이 드래그할 때만 사라지면 구간이 깜빡이는 것처럼 보인다
  //
  // ※ 계산(computeRsiZones)은 **zone_bg가 꺼져 있어도** 돌린다 — 지표 메뉴가 보여주는
  //   "검출된 구간 N개"(= 개수 슬라이더 상한)가 배경을 끄면 0으로 주저앉으면 안 된다.
  //   캐시 덕에 봉마감 전까지는 재계산이 없으므로 비용도 없다
  //
  // ※ 표시 여부는 **showRsiZones**(= RSI 지표 ON && rsi.tfs에 현재 TF 포함)를 본다.
  //   `showRsi`(패널)와 나뉜 값이다 — 배경만 TF로 거르고 RSI 선은 전 TF에서 보인다
  //   (2026-08-14 사용자 확정). 다시 하나로 합치지 말 것.
  //   계산은 showRsi 기준으로 계속 돌린다: 배경을 안 그리는 TF에서도 메뉴의
  //   "검출된 구간 N개"(= 개수 슬라이더 상한)는 살아 있어야 미리 맞춰둘 수 있다
  if (ov.showRsi && ov.rsiData?.length) {
    const zones = computeRsiZones(ov.rsiData, ov.rsiParams);
    if (ov.showRsiZones && ov.rsiParams?.zone_bg !== false) {
      // zone_max: `undefined` = 미설정(기본 5) / `null` = **전체**(제한 없음) / 숫자 = 최근 N개.
      // ⚠ null이 "전체"라 `?? 5`로 기본값을 채우면 안 된다 (null을 5로 덮어씀) — `=== undefined` 검사를 쓸 것.
      // 숫자는 **RSI_ZONE_MAX(10)로 자른다** (2026-08-14 사용자 지정): 슬라이더가 10을 넘지
      // 못하게 막지만, 구버전이 10보다 큰 값을 저장해뒀을 수 있어 렌더에서도 한 번 더 건다.
      // "전체"는 캡의 예외다 — 사용자가 명시적으로 고른 값이라 자르지 않는다
      const zm = ov.rsiParams?.zone_max;
      const zoneMax = zm === undefined ? 5 : zm === null ? null : Math.min(zm, RSI_ZONE_MAX);
      renderRsiZones(ctx, zones, xScale, IW, IH, isDark, zoneMax);
    }
  } else {
    clearRsiZones();
  }

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
  if (!ov._panning) {
    if (ov.showFVG && ov.fvgData?.length)   renderFVG(ctx, ov.fvgData, xScale, yScale, IW, IH);
    if (ov.showOB  && ov.obData?.length)    renderOrderBlock(ctx, ov.obData, xScale, yScale, IW, IH);
    // 멀티 TF라 레벨 좌표가 timestamp다 → 변환에 현재 차트 캔들이 필요
    if (ov.showPivot && ov.pivotLevels?.length) renderPivotLevels(ctx, ov.pivotLevels, candles, xScale, yScale, IW, IH, isDark);
    if (ov.showEMA && ov.emaData?.length)   renderEMA(ctx, ov.emaData, xScale, yScale, IW, IH);
    // ZZ만 여기서 계산 — 진행 중 봉(candles 마지막 = candlesRef의 라이브 봉)까지 반영하기 위함
    if (ov.showZZ) {
      renderStructureZigzag(
        ctx, computeStructureZigzag(candles, ov.zzParams ?? {}), xScale, yScale, IW, IH,
        { selected: ov.zzSelected, opacity: ov.zzParams?.opacity },
      );
    }
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
    const ts = idxToTimestamp(tickIdx, candles);
    const x  = M.left + xScale(tickIdx);
    ctx.fillText(fmtTime(ts, interval_), x, M.top + IH + 6);
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
