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

      // displacement: 진하게, 일반 FVG: 옅게
      const isDisp = gap.displacement;
      ctx.globalAlpha = isDisp ? 0.22 : 0.10;
      ctx.fillStyle   = CANVAS_C.NEUTRAL;
      ctx.fillRect(x1, yTop, IW - x1, h);

      ctx.globalAlpha = isDisp ? 0.8 : 0.4;
      ctx.fillStyle   = CANVAS_C.NEUTRAL;
      ctx.fillText(isDisp ? "FVG★" : "FVG", x1 + 3, yTop + 9);
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

      const isDisp = ob.displacement;
      ctx.globalAlpha = isDisp ? 0.22 : 0.10;
      ctx.fillStyle   = color;
      ctx.fillRect(x1, yTop, IW - x1, h);

      ctx.globalAlpha = isDisp ? 0.85 : 0.45;
      ctx.fillStyle   = color;
      ctx.fillText(isDisp ? "OB★" : "OB", x1 + 3, yTop + 9);
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

// ── Liquidity (Equal H/L + 스윕) ─────────────────────────────────────────────
// status:
//   'live'   — 살아있는 유동성 (bright, dashed)
//   'swept'  — ICT 스톱헌트 완료 (중요 신호: X 마커 + label에 ✕)
//   'broken' — 단순 추세 돌파 (매우 흐리게, 참고용)
export function renderLiquidity(ctx, liqData, xScale, yScale, IW, IH) {
  if (!liqData?.length) return;
  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.font = "600 9px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.textBaseline = "middle";
    const [iMin, iMax] = xScale.domain();

    for (const lq of liqData) {
      const y = yScale(lq.price);
      if (y < -5 || y > IH + 5) continue;
      const x0 = Math.max(0, xScale(Math.max(iMin, lq.startIdx)));
      const endI = lq.status !== "live" && lq.sweptIdx >= 0 ? lq.sweptIdx : Math.min(iMax, Math.ceil(iMax));
      const x1 = Math.min(IW, xScale(endI));
      if (x1 <= x0) continue;

      const color = lq.type === "EQH" ? CANVAS_C.BEAR_DARK : CANVAS_C.BULL_DARK;

      // 스타일 분기
      let lineW, alpha, dash, labelAlpha;
      if (lq.status === "live") {
        lineW = 1.5;  alpha = 0.85; dash = [6, 3]; labelAlpha = 1;
      } else if (lq.status === "swept") {
        lineW = 1.2;  alpha = 0.7;  dash = [2, 3]; labelAlpha = 0.9;
      } else { // broken
        lineW = 0.8;  alpha = 0.2;  dash = [1, 6]; labelAlpha = 0.35;
      }

      ctx.strokeStyle = color;
      ctx.lineWidth   = lineW;
      ctx.globalAlpha = alpha;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // 라벨
      ctx.globalAlpha = labelAlpha;
      ctx.fillStyle   = color;
      ctx.textAlign   = "left";
      const label = lq.status === "live"   ? `${lq.type}(${lq.touches})`
                  : lq.status === "swept"  ? `✕${lq.type}`
                  :                          `—${lq.type}`;
      ctx.fillText(label, x0 + 4, y - 7);

      // 스윕 마커 (swept 전용, broken은 생략 — 매매 의미 없음)
      if (lq.status === "swept" && lq.sweptIdx >= iMin - 1 && lq.sweptIdx <= iMax + 1) {
        const sx = xScale(lq.sweptIdx);
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        // 내부에 흰 점 (강조)
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(sx, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

// ── Market Structure (BOS/CHoCH) ────────────────────────────────────────────
export function renderMarketStructure(ctx, msData, xScale, yScale, IW, IH) {
  if (!msData?.length) return;
  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.font = "700 10px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.textBaseline = "alphabetic";
    const [iMin, iMax] = xScale.domain();

    for (const ev of msData) {
      if (ev.atIdx < iMin - 1 || ev.brokenIdx > iMax + 1) continue;
      const x0 = Math.max(0, xScale(ev.brokenIdx));
      const x1 = Math.min(IW, xScale(ev.atIdx));
      const y  = yScale(ev.brokenPrice);
      if (x1 <= x0) continue;

      const isBull  = ev.dir === "bull";
      const isChoch = ev.kind === "CHoCH";
      // BOS: 방향색 / CHoCH: 방향색 동일하되 실선+굵기로 BOS와 구분
      const color = isBull ? CANVAS_C.BULL_DARK : CANVAS_C.BEAR_DARK;

      // 돌파된 스윙 레벨선
      ctx.strokeStyle = color;
      ctx.lineWidth = isChoch ? 1.5 : 1;
      ctx.globalAlpha = 0.8;
      ctx.setLineDash(isChoch ? [] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // 라벨
      ctx.globalAlpha = 1;
      ctx.fillStyle   = color;
      ctx.textAlign   = "center";
      const tx = (x0 + x1) / 2;
      const ty = isBull ? y - 4 : y + 12;
      ctx.fillText(ev.kind, tx, ty);
    }
  });
}

// ── Premium / Discount Zone ──────────────────────────────────────────────────
export function renderPremiumDiscount(ctx, pdData, xScale, yScale, IW, IH) {
  if (!pdData) return;
  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.font = "700 10px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.textBaseline = "middle";
    const [iMin, iMax] = xScale.domain();

    const x0 = Math.max(0, xScale(Math.max(iMin, pdData.startIdx)));
    const x1 = Math.min(IW, xScale(iMax));
    if (x1 <= x0) return;

    const yHi  = yScale(pdData.high);
    const yMid = yScale(pdData.mid);
    const yLo  = yScale(pdData.low);

    // Premium 영역 (상단 = 빨강 틴트)
    ctx.globalAlpha = 0.06;
    ctx.fillStyle   = CANVAS_C.BEAR_DARK;
    ctx.fillRect(x0, yHi, x1 - x0, yMid - yHi);

    // Discount 영역 (하단 = 초록 틴트)
    ctx.globalAlpha = 0.06;
    ctx.fillStyle   = CANVAS_C.BULL_DARK;
    ctx.fillRect(x0, yMid, x1 - x0, yLo - yMid);

    // 경계선 3개
    const drawLine = (y, color, dash) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    drawLine(yHi,  CANVAS_C.BEAR_DARK, [4, 3]);
    drawLine(yMid, "#c084fc",           []);         // Equilibrium 실선
    drawLine(yLo,  CANVAS_C.BULL_DARK, [4, 3]);

    // 라벨 (우측)
    ctx.textAlign = "right";
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = CANVAS_C.BEAR_DARK;
    ctx.fillText("Premium",  x1 - 4, yHi + 10);
    ctx.fillStyle = "#c084fc";
    ctx.fillText("EQ 50%",   x1 - 4, yMid - 7);
    ctx.fillStyle = CANVAS_C.BULL_DARK;
    ctx.fillText("Discount", x1 - 4, yLo - 6);
  });
}
