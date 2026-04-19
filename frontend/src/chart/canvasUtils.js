/**
 * 공통 캔버스 유틸리티
 * - initCanvas: DPR 대응 캔버스 초기화 + ctx 반환
 * - withClip:   save → clip → translate → fn → restore 래퍼
 * - getVisibleRange: xScale 기반 가시 캔들 인덱스 범위 계산
 */

export function initCanvas(canvas, logW, logH) {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width  !== Math.round(logW * dpr) ||
      canvas.height !== Math.round(logH * dpr)) {
    canvas.width        = Math.round(logW * dpr);
    canvas.height       = Math.round(logH * dpr);
    canvas.style.width  = logW + "px";
    canvas.style.height = logH + "px";
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, logW, logH);
  return ctx;
}

// fn 내부 좌표는 (x, y) 기준 상대 좌표
export function withClip(ctx, x, y, w, h, fn) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  fn(ctx);
  ctx.restore();
}

export function getVisibleRange(xScale, candleCount) {
  const [dMin, dMax] = xScale.domain();
  return [Math.max(0, Math.floor(dMin)), Math.min(candleCount - 1, Math.ceil(dMax))];
}
