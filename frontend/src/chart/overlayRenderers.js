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

// ── Structure Zigzag (지그재그 + CHoCH) ──────────────────────────────────────
// 선택 강조색 — 수동 구조(Structures.jsx의 SEL_COLOR)와 같은 금색
const ZZ_SEL_COLOR = "#f0b90b";

/**
 * @param opts { selected, opacity } — 지그재그 선의 색·굵기·투명도.
 *   수동 구조와 같은 규칙: 선택 시 금색 1.5px·투명도 0.95, 평소 회색 1px·설정 투명도.
 *   최종 알파는 둘 다 `0.8 * opacity` (지그재그는 배경처럼 깔린다).
 *   ※ CHoCH 마크는 투명도를 따르지 않는다 — 항상 100% (수동 구조 [R1]과 동일)
 */
export function renderStructureZigzag(ctx, zzData, xScale, yScale, IW, IH, opts = {}) {
  const segments = zzData?.segments;
  const chochs   = zzData?.chochs;
  if (!segments?.length && !chochs?.length) return;

  const selected = !!opts.selected;
  const opacity  = selected ? 0.95 : (opts.opacity ?? 1.0);

  withClip(ctx, M.left, M.top, IW, IH, () => {
    const [iMin, iMax] = xScale.domain();

    // 지그재그 선 (한 번의 path로 배치 스트로크)
    if (segments?.length) {
      ctx.strokeStyle = selected ? ZZ_SEL_COLOR : CANVAS_C.NEUTRAL;
      ctx.lineWidth   = selected ? 1.5 : 1;
      ctx.globalAlpha = 0.8 * opacity;
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const s of segments) {
        if (s.i2 < iMin - 1 || s.i1 > iMax + 1) continue;
        ctx.moveTo(xScale(s.i1), yScale(s.p1));
        ctx.lineTo(xScale(s.i2), yScale(s.p2));
      }
      ctx.stroke();
    }

    // CHoCH 마크 (돌파된 구조 레벨 + 라벨)
    if (chochs?.length) {
      ctx.font         = "700 10px 'JetBrains Mono','Fira Code','Courier New',monospace";
      ctx.textAlign    = "center";
      ctx.textBaseline = "alphabetic";

      // ※ 수동 구조(Structures.jsx의 ChochMarks)와 **픽셀 단위로 같은 규칙**이다.
      //   화면 밖 판정 / 최소 폭 2px / 불투명도 1 / 진행 중이면 점선 — 한쪽만 바꾸지 말 것.
      for (const ev of chochs) {
        const rawX0 = xScale(ev.fromIdx);
        const rawX1 = xScale(ev.toIdx);
        if (rawX1 < 0 || rawX0 > IW) continue;             // 화면 밖
        const x0 = Math.max(0, rawX0);
        // 돌파 지점이 레벨 시작점과 같은 화면 위치면 선이 사라지므로 최소 폭 확보
        const x1 = Math.max(Math.min(IW, rawX1), x0 + 2);
        const y  = yScale(ev.price);

        const isBull = ev.dir === "bull";
        const color  = isBull ? CANVAS_C.BULL_DARK : CANVAS_C.BEAR_DARK;

        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.5;
        ctx.globalAlpha = 1;
        // 진행 중 레그에서 나온 CHoCH는 확정분과 구분되게 점선
        ctx.setLineDash(ev.live ? [5, 3] : []);
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = color;
        ctx.fillText("CHoCH", (x0 + x1) / 2, isBull ? y - 4 : y + 12);
      }
    }
  });
}
