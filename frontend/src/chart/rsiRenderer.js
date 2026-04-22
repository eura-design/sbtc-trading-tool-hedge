import * as d3 from "d3";
import { M } from "../constants";

const RSI_OB_C  = "#60a5fa";
const RSI_OS_C  = "#60a5fa";
const RSI_MID_C = "#888888";

function getRsiColor(v, ob, os) {
  return v >= ob ? RSI_OB_C : v <= os ? RSI_OS_C : RSI_MID_C;
}

export function renderRSICanvas(canvas, rsiData, xScale, IW, rsiH, isDark, rsiParams = {}) {
  if (!canvas || !rsiData?.length || !xScale || rsiH <= 0) return;
  const ob     = rsiParams.overbought ?? 70;
  const os     = rsiParams.oversold   ?? 30;
  const period = rsiParams.period     ?? 14;

  canvas.width  = M.left + IW + M.right;
  canvas.height = rsiH;

  const ctx = canvas.getContext("2d");
  ctx.save();

  ctx.beginPath();
  ctx.rect(M.left, 0, IW, rsiH);
  ctx.clip();
  ctx.translate(M.left, 0);

  const yScale = d3.scaleLinear().domain([0, 100]).range([rsiH, 0]);

  ctx.globalAlpha = 0.55;
  ctx.fillStyle   = isDark ? "#060a12" : "#f8fafc";
  ctx.fillRect(0, 1, IW, rsiH - 1);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = isDark ? "#1f2937" : "#cbd5e1";
  ctx.lineWidth   = 1;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(0, 0.5); ctx.lineTo(IW, 0.5);
  ctx.stroke();

  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 4]);

  const yOb  = yScale(ob);
  const yOs  = yScale(os);
  const yMid = yScale(50);

  ctx.strokeStyle = RSI_OB_C;  ctx.globalAlpha = 0.4;
  ctx.beginPath(); ctx.moveTo(0, yOb);  ctx.lineTo(IW, yOb);  ctx.stroke();

  ctx.strokeStyle = isDark ? "#374151" : "#94a3b8"; ctx.globalAlpha = 0.3;
  ctx.beginPath(); ctx.moveTo(0, yMid); ctx.lineTo(IW, yMid); ctx.stroke();

  ctx.strokeStyle = RSI_OS_C;  ctx.globalAlpha = 0.4;
  ctx.beginPath(); ctx.moveTo(0, yOs);  ctx.lineTo(IW, yOs);  ctx.stroke();

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const [iMin, iMax] = xScale.domain();
  const vis = rsiData.filter(d => d.i >= iMin - 1 && d.i <= iMax + 1);
  if (vis.length >= 2) {
    let curColor = getRsiColor(vis[0].rsi, ob, os);
    let pts = [vis[0]];

    const flush = (color, points) => {
      if (points.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth   = color === RSI_MID_C ? 0.8 : 1.2;
      ctx.beginPath();
      for (let j = 0; j < points.length; j++) {
        const x = xScale(points[j].i);
        const y = yScale(points[j].rsi);
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    for (let k = 1; k < vis.length; k++) {
      const prev = vis[k - 1];
      const curr = vis[k];
      const nextColor = getRsiColor(curr.rsi, ob, os);

      if (curColor === nextColor) {
        pts.push(curr);
      } else {
        const thresh = Math.abs(curr.rsi - ob) < Math.abs(curr.rsi - os) ? ob : os;
        const ratio  = (thresh - prev.rsi) / (curr.rsi - prev.rsi);
        const cross  = (ratio >= 0 && ratio <= 1)
          ? { i: prev.i + (curr.i - prev.i) * ratio, rsi: thresh }
          : null;
        if (cross) pts.push(cross);
        flush(curColor, pts);
        curColor = nextColor;
        pts = cross ? [cross, curr] : [curr];
      }
    }
    flush(curColor, pts);
  }

  ctx.font = "600 10px 'JetBrains Mono','Fira Code','Courier New',monospace";
  ctx.textBaseline = "middle";
  ctx.globalAlpha  = 0.55;

  ctx.fillStyle = isDark ? "#374151" : "#94a3b8";
  ctx.textAlign = "left";
  ctx.fillText(`RSI ${period}`, 4, 8);

  ctx.globalAlpha = 0.5;
  ctx.fillStyle   = RSI_OB_C; ctx.fillText(ob, 4, yOb + 3.5);
  ctx.fillStyle   = RSI_OS_C; ctx.fillText(os, 4, yOs + 3.5);

  const last = vis[vis.length - 1]?.rsi ?? rsiData[rsiData.length - 1]?.rsi;
  if (last != null) {
    ctx.globalAlpha = 1;
    ctx.fillStyle   = getRsiColor(last, ob, os);
    ctx.textAlign   = "right";
    ctx.font        = "700 11px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.fillText(last.toFixed(1), IW - 2, Math.max(yScale(last) + 3.5, 10));
  }

  ctx.restore();
}
