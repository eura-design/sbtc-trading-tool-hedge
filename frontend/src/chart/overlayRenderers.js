import { M, CANVAS_C } from "../constants";
import { withClip } from "./canvasUtils";

const SR_OPACITY = { 4: 0.55, 3: 0.40, 2: 0.28, 1: 0.16 };

// RSI 과매수/과매도 구간 배경의 진하기 (2026-08-13 사용자 요청으로 0.13/0.10 → 상향).
// 캔들이 globalAlpha 0.7로 그려지므로 여기를 더 올리면 캔들이 파랗게 물들기 시작한다.
// 라이트 테마가 더 낮은 이유: 흰 배경에서는 같은 알파가 더 진하게 보인다
const RSI_ZONE_ALPHA = { dark: 0.22, light: 0.17 };

// 마지막으로 계산한 구간 목록 — 지표 메뉴가 "검출된 구간 N개"를 읽어간다.
// ZZ의 getZzChochTotal과 같은 이유로 모듈 상태다: 계산이 캔버스 렌더 경로에만 있어
// React 상태로 올라오지 않는다 (메뉴 여는 시점의 스냅샷)
let _zoneCache = { data: null, ob: null, os: null, zones: [] };

/**
 * RSI가 과매수(≥ob) / 과매도(≤os)인 **연속 봉 구간** 목록 `[{ s, e }]` (bar index).
 *
 * **화면 범위가 아니라 로드된 전 구간**을 훑는다 — "최근 N개"가 뷰포트에 따라
 * 달라지면 안 되기 때문이다. 스크롤해서 과거를 보다가 돌아왔을 때 밴드가 다른 데
 * 찍혀 있으면 같은 지표로 보이지 않는다.
 *
 * rsiData는 봉마감 때만 새 배열이 되므로 참조 비교 캐시로 매 틱 재계산을 피한다.
 */
export function computeRsiZones(rsiData, rsiParams = {}) {
  const ob = rsiParams.overbought ?? 70;
  const os = rsiParams.oversold   ?? 30;
  if (_zoneCache.data === rsiData && _zoneCache.ob === ob && _zoneCache.os === os) {
    return _zoneCache.zones;
  }

  const zones = [];
  let s = null, e = null;
  for (const d of rsiData) {
    if (d.rsi >= ob || d.rsi <= os) {
      if (s !== null && d.i === e + 1) e = d.i;             // 바로 다음 봉이면 같은 구간
      else { if (s !== null) zones.push({ s, e }); s = d.i; e = d.i; }
    } else if (s !== null) {
      zones.push({ s, e }); s = null;
    }
  }
  if (s !== null) zones.push({ s, e });

  _zoneCache = { data: rsiData, ob, os, zones };
  return zones;
}

// 지표가 꺼지면 0개가 되어야 한다 — 안 비우면 껐는데도 메뉴에 옛 개수가 남는다
export function clearRsiZones() {
  if (_zoneCache.zones.length) _zoneCache = { data: null, ob: null, os: null, zones: [] };
}

export function getRsiZoneCount() { return _zoneCache.zones.length; }

/**
 * RSI 과매수/과매도 구간을 메인 차트에 세로 밴드로 칠한다.
 *
 * @param zones computeRsiZones 결과 (전 구간)
 * @param max   최근 몇 개만 그릴지. `null` = 전체
 *
 * 설계 메모 (2026-08-13, 사용자 요청 — 되돌리기 전에 확인할 것):
 * - **메인 차트에만** 칠한다. RSI 패널은 선 색으로 이미 구분되므로 건드리지 않는다
 *   (사용자가 "메인 차트만"을 명시적으로 선택했다)
 * - 과매수·과매도 **같은 파란색**(CANVAS_C.RSI_ZONE). 어느 쪽인지는 RSI 패널이 답한다
 * - **봉 단위로 끊는다** — RSI 선처럼 임계값 교차점을 보간하지 않는다.
 *   밴드는 캔들과 나란히 놓이는 배경이라 봉 경계에서 끊겨야 어느 봉이 과매수였는지가
 *   눈으로 맞아떨어진다. 보간하면 밴드 경계가 봉 중간을 가르며 반 칸씩 어긋나 보인다
 * - 연속 구간을 하나의 사각형으로 합친다(computeRsiZones) — 봉마다 fillRect하면
 *   경계에서 알파가 겹쳐 세로 줄무늬가 생긴다 (반투명 사각형을 이어 붙일 때의 고전적 문제)
 * - **최근 N개 제한은 화면이 아니라 전체 목록 기준**(zones.slice(-max)).
 *   기본 5개 — 과거 구간이 온통 파래지면 배경이 아니라 노이즈가 된다는 사용자 요청
 * - ⚠ rsiData는 React `candles` 기반이라 **진행 중 봉은 반영되지 않는다**(봉마감 시 갱신).
 *   RSI 패널도 같은 데이터를 쓰므로 둘은 항상 일치한다 — 여기만 candlesRef로 앞서가게
 *   만들면 패널의 선과 배경이 어긋나 보인다
 */
export function renderRsiZones(ctx, zones, xScale, IW, IH, isDark, max = null) {
  if (!zones.length) return;
  const list = max == null ? zones : zones.slice(-max);

  const [iMin, iMax] = xScale.domain();
  const half = (xScale(1) - xScale(0)) / 2;   // 봉 하나의 폭 절반 (밴드를 봉 중앙 기준으로 확장)

  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.globalAlpha = isDark ? RSI_ZONE_ALPHA.dark : RSI_ZONE_ALPHA.light;
    ctx.fillStyle   = CANVAS_C.RSI_ZONE;

    for (const z of list) {
      if (z.e < iMin - 1 || z.s > iMax + 1) continue;
      const x = xScale(z.s) - half;
      ctx.fillRect(x, 0, Math.max(xScale(z.e) + half - x, 1), IH);
    }

    ctx.globalAlpha = 1;
  });
}

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
