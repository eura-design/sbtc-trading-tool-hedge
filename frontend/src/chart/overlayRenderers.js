import { M, CANVAS_C } from "../constants";
import { withClip } from "./canvasUtils";

const SR_OPACITY = { 4: 0.55, 3: 0.40, 2: 0.28, 1: 0.16 };

export function renderFVG(ctx, fvgData, xScale, yScale, IW, IH) {
  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.font = "600 10px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.textBaseline = "alphabetic";

    const [iMin, iMax] = xScale.domain();
    for (const gap of fvgData) {
      if (gap.idx < iMin - 1 || gap.idx > iMax + 1) continue;
      const x1 = Math.max(0, xScale(gap.idx));
      if (x1 >= IW) continue;
      const yTop = yScale(gap.top);
      const yBot = yScale(gap.bottom);
      const h    = Math.max(yBot - yTop, 2);

      ctx.globalAlpha = 0.15;
      ctx.fillStyle   = CANVAS_C.NEUTRAL;
      ctx.fillRect(x1, yTop, IW - x1, h);

      ctx.globalAlpha = 0.55;
      ctx.fillStyle   = CANVAS_C.NEUTRAL;
      ctx.fillText("FVG", x1 + 3, yTop + 9);
    }
  });
}

export function renderOrderBlock(ctx, obData, xScale, yScale, IW, IH) {
  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.font = "600 10px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.textBaseline = "alphabetic";

    const [iMin, iMax] = xScale.domain();
    for (const ob of obData) {
      if (ob.idx < iMin - 1 || ob.idx > iMax + 1) continue;
      const x1 = Math.max(0, xScale(ob.idx));
      if (x1 >= IW) continue;
      const color = ob.type === "bull" ? CANVAS_C.BULL_DARK : CANVAS_C.BEAR_DARK;
      const yTop  = yScale(ob.top);
      const yBot  = yScale(ob.bottom);
      const h     = Math.max(yBot - yTop, 2);

      ctx.globalAlpha = 0.15;
      ctx.fillStyle   = color;
      ctx.fillRect(x1, yTop, IW - x1, h);

      ctx.globalAlpha = 0.6;
      ctx.fillStyle   = color;
      ctx.fillText("OB", x1 + 3, yTop + 9);
    }
  });
}

export function renderSRLines(ctx, srLevels, yScale, IW, IH, isDark) {
  const labelColor = isDark ? "#b0b5bc" : "#4b5563";

  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.font      = "700 12px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";

    for (const lv of srLevels) {
      const px      = yScale(lv.price);
      if (px < -20 || px > IH + 20) continue;
      const opacity = SR_OPACITY[lv.stars] ?? 0.2;
      const label   = lv.density_pct != null
        ? `${Math.round(lv.density_pct)}%`
        : `${lv.stars}★`;

      ctx.globalAlpha  = opacity;
      ctx.strokeStyle  = CANVAS_C.NEUTRAL;
      ctx.lineWidth    = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(0,  px);
      ctx.lineTo(IW, px);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = opacity * 0.85;
      ctx.fillStyle   = CANVAS_C.NEUTRAL;
      ctx.fillRect(IW - 28, px - 9, 28, 16);

      ctx.globalAlpha = 1;
      ctx.fillStyle   = labelColor;
      ctx.fillText(label, IW - 4, px + 4);
    }
  });
}

export function renderEMA(ctx, emaDataList, xScale, yScale, IW, IH) {
  if (!emaDataList?.length) return;

  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.font = "600 9px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const [iMin, iMax] = xScale.domain();

    for (const ema of emaDataList) {
      if (!ema.data?.length) continue;
      if (ema.enabled === false) continue;

      const color = ema.color ?? CANVAS_C.NEUTRAL;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.75;
      ctx.setLineDash([]);

      ctx.beginPath();
      let started = false;
      let prevPx  = -Infinity;
      for (const pt of ema.data) {
        if (pt.i < iMin - 1 || pt.i > iMax + 1) { started = false; continue; }
        const x  = xScale(pt.i);
        const px = Math.round(x);
        if (px === prevPx) continue;
        prevPx = px;
        const y = yScale(pt.ema);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 우측 끝 라벨
      const iMaxCeil = Math.ceil(iMax);
      let lastPt = null;
      for (let k = ema.data.length - 1; k >= 0; k--) {
        if (ema.data[k].i <= iMaxCeil) { lastPt = ema.data[k]; break; }
      }
      if (lastPt) {
        const y = yScale(lastPt.ema);
        ctx.globalAlpha = 0.65;
        ctx.fillStyle   = color;
        ctx.fillText(`EMA${ema.period}`, IW - 2, y - 7);
      }
    }
  });
}
