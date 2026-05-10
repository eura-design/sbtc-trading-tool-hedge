import { M, CANVAS_C } from "../constants";
import { initCanvas, withClip, getVisibleRange } from "./canvasUtils";

// 모듈 레벨 Map 재사용 — 호출마다 new Map() 생성 방지 (GC 압박 제거)
const _volMap = new Map();

function renderVolumePanel(ctx, candles, xScale, IW, volH, isDark, volColorMode) {
  withClip(ctx, M.left, 0, IW, volH, () => {
    // 배경
    ctx.globalAlpha = 0.55;
    ctx.fillStyle   = isDark ? "#060a12" : "#f8fafc";
    ctx.fillRect(0, 0, IW, volH);

    // 구분선
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = CANVAS_C.AXIS;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(IW, 0);
    ctx.stroke();

    const [i0, i1] = getVisibleRange(xScale, candles.length);
    const pxPerBar = xScale(1) - xScale(0);
    const barW     = Math.max(1, pxPerBar * 0.6);

    let maxVol = 0;
    for (let i = i0; i <= i1; i++) { if (candles[i].v > maxVol) maxVol = candles[i].v; }
    if (!maxVol) return;

    const useCandle = volColorMode === "candle";
    ctx.globalAlpha = useCandle ? 0.7 : 0.5;
    const bullColor = isDark ? CANVAS_C.BULL_DARK : CANVAS_C.BULL_LIGHT;
    const bearColor = isDark ? CANVAS_C.BEAR_DARK : CANVAS_C.BEAR_LIGHT;

    if (pxPerBar < 2) {
      // 압축 모드 — 픽셀당 최대 거래량 봉의 방향으로 색상 결정
      _volMap.clear();
      for (let i = i0; i <= i1; i++) {
        const px = Math.round(xScale(i));
        const isUp = candles[i].c >= candles[i].o;
        const ex = _volMap.get(px);
        if (ex === undefined || candles[i].v > ex.v) _volMap.set(px, { v: candles[i].v, isUp });
      }
      if (!useCandle) {
        ctx.fillStyle = CANVAS_C.NEUTRAL;
        ctx.beginPath();
        for (const [px, { v }] of _volMap) {
          const h = Math.max(1, (v / maxVol) * volH);
          ctx.rect(px - 0.5, Math.round(volH - h), 1, Math.round(h));
        }
        ctx.fill();
      } else {
        for (const [px, { v, isUp }] of _volMap) {
          ctx.fillStyle = isUp ? bullColor : bearColor;
          const h = Math.max(1, (v / maxVol) * volH);
          ctx.fillRect(px - 0.5, Math.round(volH - h), 1, Math.round(h));
        }
      }
    } else {
      const hw = barW / 2;
      const w = Math.max(1, Math.round(barW));
      if (!useCandle) ctx.fillStyle = CANVAS_C.NEUTRAL;
      for (let i = i0; i <= i1; i++) {
        const h = Math.max(1, (candles[i].v / maxVol) * volH);
        if (useCandle) ctx.fillStyle = candles[i].c >= candles[i].o ? bullColor : bearColor;
        ctx.fillRect(Math.round(xScale(i) - hw), Math.round(volH - h), w, Math.round(h));
      }
    }

    ctx.globalAlpha  = 0.55;
    ctx.fillStyle    = isDark ? CANVAS_C.XTICK : "#9ca3af";
    ctx.font         = "10px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.textBaseline = "top";
    ctx.textAlign    = "left";
    ctx.fillText("VOL", 4, 2);
  });
}

export function renderVolumeCanvas(canvas, candles, xScale, IW, volH, isDark, volColorMode) {
  if (!canvas || !candles.length || volH <= 0) return;
  const logW = IW + M.left + M.right;
  const ctx  = initCanvas(canvas, logW, volH);
  renderVolumePanel(ctx, candles, xScale, IW, volH, isDark, volColorMode || "neutral");
}
