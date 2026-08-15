import { M, CANVAS_C } from "../constants";
import { withClip } from "./canvasUtils";
import { tsToIdx } from "./scales";

// RSI 과매수/과매도 구간 배경의 진하기 (2026-08-13 사용자 요청으로 0.13/0.10 → 상향).
// 캔들이 globalAlpha 0.7로 그려지므로 여기를 더 올리면 캔들이 파랗게 물들기 시작한다.
// 라이트 테마가 더 낮은 이유: 흰 배경에서는 같은 알파가 더 진하게 보인다
const RSI_ZONE_ALPHA = { dark: 0.22, light: 0.17 };

// 마지막으로 계산한 구간 목록 — 지표 메뉴가 "검출된 구간 N개"를 읽어간다.
// ZZ의 getZzChochTotal과 같은 이유로 모듈 상태다: 계산이 캔버스 렌더 경로에만 있어
// React 상태로 올라오지 않는다 (메뉴 여는 시점의 스냅샷)
let _zoneCache = { data: null, ob: null, os: null, zones: [] };

/**
 * RSI가 과매수(≥ob) / 과매도(≤os)인 **연속 봉 구간** 목록 `[{ s, e, kind }]` (bar index).
 * `kind`는 `"ob"`(과매수) | `"os"`(과매도) — 2026-08-13부터 색이 달라 구분이 필요하다.
 * 과매수 구간과 과매도 구간이 봉 하나 차이로 붙어도 **다른 구간으로 끊는다**
 * (안 끊으면 한 사각형이 두 상태를 덮어 색을 정할 수 없다).
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
  let s = null, e = null, kind = null;
  for (const d of rsiData) {
    const k = d.rsi >= ob ? "ob" : d.rsi <= os ? "os" : null;
    if (k) {
      // 바로 다음 봉이면서 **같은 종류**일 때만 이어 붙인다
      if (s !== null && d.i === e + 1 && k === kind) e = d.i;
      else { if (s !== null) zones.push({ s, e, kind }); s = d.i; e = d.i; kind = k; }
    } else if (s !== null) {
      zones.push({ s, e, kind }); s = null;
    }
  }
  if (s !== null) zones.push({ s, e, kind });

  _zoneCache = { data: rsiData, ob, os, zones };
  return zones;
}

// 지표가 꺼지면 0개가 되어야 한다 — 안 비우면 껐는데도 메뉴에 옛 개수가 남는다
export function clearRsiZones() {
  if (_zoneCache.zones.length) _zoneCache = { data: null, ob: null, os: null, zones: [] };
}

export function getRsiZoneCount() { return _zoneCache.zones.length; }

/**
 * 화면에 칠할 구간을 고른다 — **마지막 구간과 같은 종류로 연속된 꼬리**만 남긴다.
 * (2026-08-15 사용자 지정, "개수 조절"을 대체한 규칙)
 *
 * 예) 목록이 `… ob ob os os os` 이면 → 뒤의 `os os os` 셋만.
 *     반대 종류(ob)를 만나는 순간 끊는다 — "과매수 직전까지".
 *     마지막 두 개의 종류가 다르면 자연히 **하나만** 남는다.
 *
 * ⚠ 개수(N개) 방식으로 되돌리지 말 것. 그때는 지금 흐름과 무관한 옛 구간까지
 *   같이 물들었고, 몇 개를 보여줄지가 데이터가 아니라 사용자 설정에 달려 있었다.
 *   지금은 "지금 이어지고 있는 국면"만 나오고 조절할 노브가 필요 없다
 */
export function lastRsiZoneRun(zones) {
  if (!zones.length) return zones;
  const kind = zones[zones.length - 1].kind;
  let i = zones.length - 1;
  while (i > 0 && zones[i - 1].kind === kind) i--;
  return zones.slice(i);
}

/**
 * RSI 과매수/과매도 구간을 메인 차트에 세로 밴드로 칠한다.
 *
 * @param zones computeRsiZones 결과 (전 구간). 실제로 칠하는 건 `lastRsiZoneRun`이 고른
 *              **마지막 연속 구간**뿐이다
 *
 * 설계 메모 (2026-08-13, 사용자 요청 — 되돌리기 전에 확인할 것):
 * - **메인 차트에만** 칠한다. RSI 패널은 선 색으로 이미 구분되므로 건드리지 않는다
 *   (사용자가 "메인 차트만"을 명시적으로 선택했다)
 * - **과매수 = 빨강 / 과매도 = 파랑** (2026-08-13 사용자 요청으로 변경).
 *   그전에는 둘 다 파랑이었고 "어느 쪽인지는 RSI 패널이 답한다"였는데, 과매수는 붉은
 *   계열이 직관적이라 색을 나눴다. RSI 패널의 선 색도 같은 토큰이라 함께 바뀐다
 *   (`CANVAS_C.RSI_ZONE_OB` / `RSI_ZONE_OS` — 한쪽만 바꾸면 패널과 배경이 어긋난다)
 * - **봉 단위로 끊는다** — RSI 선처럼 임계값 교차점을 보간하지 않는다.
 *   밴드는 캔들과 나란히 놓이는 배경이라 봉 경계에서 끊겨야 어느 봉이 과매수였는지가
 *   눈으로 맞아떨어진다. 보간하면 밴드 경계가 봉 중간을 가르며 반 칸씩 어긋나 보인다
 * - 연속 구간을 하나의 사각형으로 합친다(computeRsiZones) — 봉마다 fillRect하면
 *   경계에서 알파가 겹쳐 세로 줄무늬가 생긴다 (반투명 사각형을 이어 붙일 때의 고전적 문제)
 * - **표시 대상은 "마지막 구간과 같은 종류로 연속된 꼬리"뿐**이다 (2026-08-15 사용자 지정).
 *   개수를 고르는 슬라이더(`rsi.zone_max`)를 대체했다 — 지금 이어지고 있는 국면만 나오고,
 *   반대 종류를 만나면 거기서 끊긴다. 판정은 **화면이 아니라 전체 목록 기준**이라
 *   스크롤해도 밴드가 다른 데 찍히지 않는다 (그 원칙은 그대로다)
 * - ⚠ rsiData는 React `candles` 기반이라 **진행 중 봉은 반영되지 않는다**(봉마감 시 갱신).
 *   RSI 패널도 같은 데이터를 쓰므로 둘은 항상 일치한다 — 여기만 candlesRef로 앞서가게
 *   만들면 패널의 선과 배경이 어긋나 보인다
 */
export function renderRsiZones(ctx, zones, xScale, IW, IH, isDark) {
  if (!zones.length) return;
  const list = lastRsiZoneRun(zones);

  const [iMin, iMax] = xScale.domain();
  const half = (xScale(1) - xScale(0)) / 2;   // 봉 하나의 폭 절반 (밴드를 봉 중앙 기준으로 확장)

  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.globalAlpha = isDark ? RSI_ZONE_ALPHA.dark : RSI_ZONE_ALPHA.light;

    for (const z of list) {
      if (z.e < iMin - 1 || z.s > iMax + 1) continue;
      // 과매수 = 빨강 / 과매도 = 파랑 (kind 없는 옛 캐시는 파랑으로 폴백)
      ctx.fillStyle = z.kind === "ob" ? CANVAS_C.RSI_ZONE_OB : CANVAS_C.RSI_ZONE_OS;
      const x = xScale(z.s) - half;
      ctx.fillRect(x, 0, Math.max(xScale(z.e) + half - x, 1), IH);
    }

    ctx.globalAlpha = 1;
  });
}

// FVG / 오더블록 박스의 **오른쪽 끝** — 화면 오른쪽 끝(IW)이 아니라 **최신 봉까지**다
// (2026-08-15 사용자 요청). 미래 영역(마지막 봉 오른쪽 빈 자리)까지 색이 깔리면
// 아직 오지 않은 구간에도 근거가 있는 것처럼 보인다.
// 봉 하나의 절반을 더해 마지막 봉의 오른쪽 가장자리에 맞춘다 (renderRsiZones와 같은 방식)
function boxRightEdge(xScale, barCount, IW) {
  if (!barCount) return IW;
  const half = (xScale(1) - xScale(0)) / 2;
  return Math.min(IW, xScale(barCount - 1) + half);
}

export function renderFVG(ctx, fvgData, xScale, yScale, IW, IH, barCount = 0) {
  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.font = "600 10px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.textBaseline = "alphabetic";

    const [iMin, iMax] = xScale.domain();
    const xEnd = boxRightEdge(xScale, barCount, IW);
    for (const gap of fvgData) {
      if (gap.idx < iMin - 1 || gap.idx > iMax + 1) continue;
      const x1 = Math.max(0, xScale(gap.idx));
      if (x1 >= xEnd) continue;          // 최신 봉보다 오른쪽이면 그릴 게 없다
      const yTop = yScale(gap.top);
      const yBot = yScale(gap.bottom);
      const h    = Math.max(yBot - yTop, 2);

      // displacement: 진하게, 일반 FVG: 옅게
      const isDisp = gap.displacement;
      ctx.globalAlpha = isDisp ? 0.22 : 0.10;
      ctx.fillStyle   = CANVAS_C.NEUTRAL;
      ctx.fillRect(x1, yTop, xEnd - x1, h);

      ctx.globalAlpha = isDisp ? 0.8 : 0.4;
      ctx.fillStyle   = CANVAS_C.NEUTRAL;
      ctx.fillText(isDisp ? "FVG★" : "FVG", x1 + 3, yTop + 9);
    }
  });
}

export function renderOrderBlock(ctx, obData, xScale, yScale, IW, IH, barCount = 0) {
  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.font = "600 10px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.textBaseline = "alphabetic";

    const [iMin, iMax] = xScale.domain();
    const xEnd = boxRightEdge(xScale, barCount, IW);   // FVG와 같은 규칙 — 최신 봉까지
    for (const ob of obData) {
      if (ob.idx < iMin - 1 || ob.idx > iMax + 1) continue;
      const x1 = Math.max(0, xScale(ob.idx));
      if (x1 >= xEnd) continue;
      const color = ob.type === "bull" ? CANVAS_C.BULL_DARK : CANVAS_C.BEAR_DARK;
      const yTop  = yScale(ob.top);
      const yBot  = yScale(ob.bottom);
      const h     = Math.max(yBot - yTop, 2);

      const isDisp = ob.displacement;
      ctx.globalAlpha = isDisp ? 0.22 : 0.10;
      ctx.fillStyle   = color;
      ctx.fillRect(x1, yTop, xEnd - x1, h);

      ctx.globalAlpha = isDisp ? 0.85 : 0.45;
      ctx.fillStyle   = color;
      ctx.fillText(isDisp ? "OB★" : "OB", x1 + 3, yTop + 9);
    }
  });
}

// ※ 구 S/R Levels(KDE 밀도 기반, 보라 점선)의 renderSRLines는 지표째로 제거됐다 (2026-08-13).
//   지지/저항은 아래 Pivot Levels가 담당한다

// Pivot Levels 진하기 — 터치 횟수가 곧 강도다 (숫자 라벨 없이 진하기로만 표현).
// 2터치가 최소 기본값이라 그 아래(1터치)는 보조 취급으로 확실히 옅게 둔다.
const PIVOT_OPACITY = { 1: 0.35, 2: 0.55, 3: 0.75, 4: 0.9 };

/**
 * Pivot Levels — 스윙 피벗이 뭉친 가격대를 가로선으로 (chart/pivotLevels.js 계산).
 * 청록/장미 **실선**, **레벨이 처음 생긴 봉부터** 오른쪽 끝까지, 현재가 기준 지지/저항 구분.
 *
 * [P3] 시작점을 그 레벨이 처음 생긴 시점(`firstT`)으로 두는 건 "언제 생긴 레벨인지"가
 *      선 길이로 보이게 하려는 것. 전 구간 가로선이면 오래된 레벨과 방금 생긴 레벨이
 *      똑같아 보인다.
 * [P5] 오른쪽 끝의 작은 TF 태그(`4h` 등)는 **멀티 TF라서 필요하다** — 여러 TF의 선이
 *      한 화면에 섞이면 색·진하기만으로는 어느 TF 레벨인지 알 수 없다.
 *      강도(터치 수)를 숫자로 적지 않는 것과 상충하지 않는다: 저건 진하기가 이미 말하는
 *      정보였고, TF는 다른 단서가 없다. 라벨 스타일은 EMA 우측 라벨과 같은 규칙
 *
 * ⚠ 좌표 변환에 **차트 캔들(candles)** 이 필요하다 — 레벨은 다른 TF에서 계산돼 봉 인덱스가
 *   아니라 timestamp를 들고 오기 때문 (수동 구조가 tsToIdx를 쓰는 것과 같다)
 */
export function renderPivotLevels(ctx, levels, candles, xScale, yScale, IW, IH, isDark) {
  if (!levels?.length || !candles?.length) return;

  const supColor = isDark ? CANVAS_C.PIVOT_SUP_DARK : CANVAS_C.PIVOT_SUP_LIGHT;
  const resColor = isDark ? CANVAS_C.PIVOT_RES_DARK : CANVAS_C.PIVOT_RES_LIGHT;

  withClip(ctx, M.left, M.top, IW, IH, () => {
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.font         = "600 9px 'JetBrains Mono','Fira Code','Courier New',monospace";
    ctx.textAlign    = "right";
    ctx.textBaseline = "middle";

    for (const lv of levels) {
      const y = yScale(lv.price);
      if (y < -20 || y > IH + 20) continue;          // 화면 밖 (상위 TF 레벨에서는 흔하다)
      // 레벨이 생긴 시점이 화면 왼쪽 밖이면 왼쪽 끝부터 그린다
      const x0 = Math.max(0, xScale(tsToIdx(lv.firstT, candles)));
      if (x0 >= IW) continue;

      const color = lv.type === "sup" ? supColor : resColor;
      ctx.globalAlpha = PIVOT_OPACITY[Math.min(lv.touches, 4)] ?? 0.9;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(IW, y);
      ctx.stroke();

      if (lv.tf) {
        ctx.fillStyle = color;
        ctx.fillText(lv.tf, IW - 2, y - 6);
      }
    }

    ctx.globalAlpha = 1;
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
// ※ CHoCH 마크에는 **글자가 없다** — 가로선만 그린다 (2026-08-14 사용자 요청).
//   `"CHoCH"` → `"C"` → 제거 순으로 줄였다. 마크가 여러 개 붙으면 글자끼리 겹쳐
//   화면이 복잡해 보인다는 이유. 방향은 색(초록/빨강)과 선 위치가 이미 말해준다.
//   ⚠ 수동 구조(Structures.jsx)·`기타/structure_zigzag.pine`도 같이 지웠다 — 되살릴 거면 셋을 같이

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

    // CHoCH 마크 — 돌파된 구조 레벨에 **가로선 하나**. 글자는 없다 (위 주석 참고).
    if (chochs?.length) {
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

        ctx.strokeStyle = ev.dir === "bull" ? CANVAS_C.BULL_DARK : CANVAS_C.BEAR_DARK;
        ctx.lineWidth   = 1.5;
        ctx.globalAlpha = 1;
        // 진행 중 레그에서 나온 CHoCH는 확정분과 구분되게 점선
        ctx.setLineDash(ev.live ? [5, 3] : []);
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  });
}
