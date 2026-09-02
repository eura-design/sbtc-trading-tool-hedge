import { useRef, useCallback } from "react";
import * as d3 from "d3";
import { M, RSI_GAP, VOL_GAP } from "../constants";
import { LEG_VOL_METRICS } from "../chart/legVolume";
import { fmtPrice } from "../utils/price";
import { useStore } from "../store";

// ── 축 위의 크로스헤어 태그 (2026-08-24 사용자 요청 — 트레이딩뷰와 같은 자리) ──────
//
// 가격은 **오른쪽 가격축**, 시각은 **아래 날짜축**에 알약 모양으로 붙는다.
// 예전에는 커서 옆에 `62.9k`가 떠 있었다 — 그건 제거됐다:
//   ① 축 눈금과 나란히 놓여야 "지금 이 자리가 얼마인가"를 눈금과 바로 견줄 수 있고
//   ② 커서 옆 라벨은 캔들 위에 겹쳐 앉아 정작 보려던 봉을 가렸다
//   ③ `62.9k`는 $100 단위라 눈금(정수 달러)보다 거칠었다
//
// ⚠ 가격 형식은 **가격축 눈금과 같은 `,.0f`**로 맞춘다 (candleRenderer의 Y축).
//   태그만 소수점을 붙이면 같은 축에 두 가지 정밀도가 나란히 뜨고, 자릿수가 늘면
//   폭 72px(M.right) 밖으로 넘친다
// ⚠ 자릿수는 **호가 단위**가 정한다 (2026-09-02). `,.0f` 고정이면 DOGE(0.2)에서
//   태그에 `0`만 뜬다. 축(candleRenderer)은 눈금 간격에서 뽑는데, 여기는 스케일이
//   없고 가격만 인자로 받으므로 스토어의 tick을 본다 — 결과 자릿수는 같다

// ⚠ 날짜 태그에는 **한글을 쓰지 않는다** (X축 눈금의 `%d일 %H:%M`과 다른 점).
//   태그 폭을 글자 수 × 등폭 한 칸으로 계산하는데, 한글은 폴백 폰트라 두 칸을
//   차지해서 계산이 어긋난다 — 배경 알약이 글자보다 짧아진다.
//   눈금보다 정보는 더 준다: 눈금은 `%y/%m/%d`인데 태그는 연도를 네 자리로 적는다
function fmtTagTime(ts, interval_) {
  const d = new Date(ts);
  if (interval_ === "1M") return d3.timeFormat("%Y/%m")(d);
  if (interval_ === "1d" || interval_ === "1w") return d3.timeFormat("%Y/%m/%d")(d);
  return d3.timeFormat("%m/%d %H:%M")(d);
}

const TAG_H  = 18;    // 알약 높이
const TAG_FS = 12;    // 축 눈금과 같은 글자 크기
const TAG_CH = TAG_FS * 0.6;   // 등폭 한 글자 폭 (JetBrains Mono = 0.6em)
const TAG_PAD = 6;    // 날짜 태그 좌우 여백 (가격 태그는 축 눈금과 같은 6px 들여쓰기)

function hideTags(T) {
  T.priceBg?.setAttribute("display", "none");
  T.priceText?.setAttribute("display", "none");
  T.timeBg?.setAttribute("display", "none");
  T.timeText?.setAttribute("display", "none");
}

// 구분 공백은 U+00A0 — SVG 기본 공백 처리(xml:space="default")가 tspan 경계의
// 일반 공백을 없애버려서 숫자들이 붙어 버린다
const NB = " ";
const UP = "#0ecb81", DN = "#f6465d";

// 레그 hover 라벨의 거래량 줄 간격 (거래량 줄 fontSize 11 기준)
const LEG_ROW_H = 13;

// 지그재그 레그 등락률(%)의 글자 크기 — **캔들 몸통 등락률(bodyPct)과 같은 13px**
// (2026-08-24 사용자 요청). 예전엔 11px이라 같은 `%` 값인데 둘의 크기가 달랐다.
// 겹쳐 보일 걱정은 없다: 레그 라벨은 한 줄 아래에 따로 놓이므로 자리로 이미 갈린다.
//
// ⚠ **ChartSvg의 `<text>` fontSize와 반드시 같아야 한다** — 이 값은 그림이 아니라
//   거래량 줄의 x를 잡는 데 쓰인다(아래 rowX). 어긋나면 등락률 글자와 거래량 줄이
//   겹치거나 사이가 벌어진다. 그래서 ChartSvg가 이 상수를 가져다 쓴다
export const LEG_PCT_FS = 13;
const LEG_PCT_CH = LEG_PCT_FS * 0.6;   // 등폭 한 글자 폭 (JetBrains Mono = 0.6em)

function hideLegRows(L) {
  for (const { key } of LEG_VOL_METRICS) L[`${key}Text`]?.setAttribute("display", "none");
}

export function useCrosshair(interval_) {
  const vLineRef      = useRef(null);
  const hLineMainRef  = useRef(null);
  const hLineRsiRef   = useRef(null);
  const bodyPctRef    = useRef(null);

  // 축 태그 4개(가격 알약 배경·글자 / 날짜 알약 배경·글자)를 **ref 하나에 모은다** —
  // legRefs와 같은 이유다 (ChartArea → ChartSvg로 prop을 넷 더 내리지 않으려고).
  // ChartSvg가 콜백 ref로 채운다
  const axisTagRefs = useRef({});

  // interval_은 렌더마다 바뀔 수 있는데 update는 useCallback으로 고정돼 있다 →
  // ref에 담아 읽는다 (deps에 넣으면 크로스헤어 콜백이 TF마다 새로 만들어진다)
  const intervalRef = useRef(interval_);
  intervalRef.current = interval_;

  // 지그재그 레그(수동 구조 / 자동 ZZ) hover 라벨의 SVG 요소들.
  // 크로스헤어와 같은 imperative 레이어에 둔다 — 마우스 이동마다 React 상태를
  // 갱신하면 SVG 오버레이 전체가 리렌더된다.
  //
  // 요소가 16개라 **ref 하나에 모아 담는다** (prop을 그만큼 ChartArea →
  // ChartSvg로 내려보내지 않으려고). ChartSvg가 콜백 ref로 채운다.
  //   pct                                        등락률
  //   {key}Text / {key}{Up,UpD,Dn,DnD}           거래량 줄 — key는 LEG_VOL_METRICS
  //                                              (top3 / mean / sum, 위→아래 순서도 그 배열)
  // ※ 테이커 기준 줄(tkr*)은 2026-08-13 제거 — legVolume.js [LV5]
  //
  // tspan 4개인 이유 — 색이 **두 축으로** 갈리기 때문이다:
  //   값(▲3.2K)    = 매수 쪽인가 매도 쪽인가 (JSX 고정)
  //   증감률(↓63%)  = 직전 대비 늘었나 줄었나 (매번 설정)
  // 실측 126쌍 중 62개(49%)가 이 둘의 색이 갈린다. 한 색으로 묶으면 절반이 틀린 색이 된다.
  // ※ tspan을 쓰면 **가로 위치가 자동으로 이어진다** — 별도 <text>로 나누면
  //   문자폭을 추정해 x를 계산해야 하고, 값 길이가 바뀔 때마다 어긋난다.
  const legRefs = useRef({});

  const update = useCallback(({ x, y, inRsi, IW, IH, rsiH, volH, price, ts, bodyPct }) => {
    const vLine     = vLineRef.current;
    const hLineMain = hLineMainRef.current;
    const hLineRsi  = hLineRsiRef.current;
    const bodyPctEl = bodyPctRef.current;
    const T         = axisTagRefs.current;
    if (!vLine || !hLineMain || !hLineRsi) return;

    const effectiveVolH = volH ?? 0;
    const effectiveRsiH = rsiH ?? 0;
    const containerH = M.top + IH + M.bottom
      + (effectiveRsiH > 0 ? RSI_GAP + effectiveRsiH : 0)
      + (effectiveVolH > 0 ? VOL_GAP + effectiveVolH : 0);
    const svgX       = M.left + x;

    vLine.setAttribute("x1", svgX);
    vLine.setAttribute("x2", svgX);
    vLine.setAttribute("y1", M.top);
    vLine.setAttribute("y2", containerH - M.bottom);
    vLine.setAttribute("display", "inline");

    // 날짜 태그 — 세로선이 보이는 동안은 **어느 패널에 있든** 함께 뜬다
    // (RSI·거래량 패널에서도 "지금 몇 시 봉인가"는 똑같이 궁금하다)
    if (T.timeBg && T.timeText && ts != null) {
      const label = fmtTagTime(ts, intervalRef.current);
      const w     = label.length * TAG_CH + TAG_PAD * 2;
      // 화면 좌우 끝에서는 알약을 안쪽으로 물린다 — 안 그러면 글자가 잘린다
      const bx = Math.max(M.left, Math.min(svgX - w / 2, M.left + IW + M.right - w));
      const by = M.top + IH + 3;         // 축선(M.top+IH) 바로 아래
      T.timeBg.setAttribute("x", bx);
      T.timeBg.setAttribute("y", by);
      T.timeBg.setAttribute("width", w);
      T.timeBg.setAttribute("height", TAG_H);
      T.timeBg.setAttribute("display", "inline");
      T.timeText.textContent = label;
      T.timeText.setAttribute("x", bx + w / 2);
      T.timeText.setAttribute("y", by + TAG_H / 2);
      T.timeText.setAttribute("display", "inline");
    } else {
      T.timeBg?.setAttribute("display", "none");
      T.timeText?.setAttribute("display", "none");
    }

    const x1 = M.left, x2 = M.left + IW;

    if (!inRsi) {
      const svgY = M.top + y;
      hLineMain.setAttribute("x1", x1); hLineMain.setAttribute("x2", x2);
      hLineMain.setAttribute("y1", svgY); hLineMain.setAttribute("y2", svgY);
      hLineMain.setAttribute("display", "inline");
      hLineRsi.setAttribute("display", "none");

      // 가격 태그 — **오른쪽 가격축 위**. 폭은 축 전체(M.right)를 덮고,
      // 글자는 눈금과 같은 자리에서 시작한다(+6)
      if (T.priceBg && T.priceText && price != null) {
        T.priceBg.setAttribute("x", M.left + IW);
        T.priceBg.setAttribute("y", svgY - TAG_H / 2);
        T.priceBg.setAttribute("width", M.right);
        T.priceBg.setAttribute("height", TAG_H);
        T.priceBg.setAttribute("display", "inline");
        // ⚠ update는 `useCallback(…, [])`이라 값을 가둔다. 호가 단위는 심볼을 바꿀 때만
        //   변하므로 **그 자리에서 스토어를 읽는다** (useCandles의 setLiveClose와 같은 방식) —
        //   ref를 하나 더 두는 것보다 읽는 곳이 분명하다
        const tick = useStore.getState().symbolFilters.tick;
        T.priceText.textContent = fmtPrice(price, tick);
        T.priceText.setAttribute("x", M.left + IW + 6);
        T.priceText.setAttribute("y", svgY);
        T.priceText.setAttribute("display", "inline");
      } else {
        T.priceBg?.setAttribute("display", "none");
        T.priceText?.setAttribute("display", "none");
      }

      // 캔들 몸통 등락률 — 커서 옆에 남는 유일한 라벨이다.
      // 가격이 축으로 떠난 자리를 그대로 물려받는다 (예전엔 가격 글자 폭만큼 밀려 있었다)
      if (bodyPctEl && bodyPct != null) {
        const sign   = bodyPct >= 0 ? "+" : "";
        bodyPctEl.textContent = `${sign}${bodyPct.toFixed(2)}%`;
        bodyPctEl.setAttribute("fill", bodyPct >= 0 ? UP : DN);
        bodyPctEl.setAttribute("x", svgX + 8);
        bodyPctEl.setAttribute("y", svgY + 14);
        bodyPctEl.setAttribute("display", "inline");
      } else {
        bodyPctEl?.setAttribute("display", "none");
      }
    } else {
      const svgY = containerH - rsiH + y;
      hLineRsi.setAttribute("x1", x1); hLineRsi.setAttribute("x2", x2);
      hLineRsi.setAttribute("y1", svgY); hLineRsi.setAttribute("y2", svgY);
      hLineRsi.setAttribute("display", "inline");
      hLineMain.setAttribute("display", "none");
      // RSI 패널에는 가격축이 없다 — 가격 태그만 감춘다 (날짜 태그는 위에서 이미 그렸다)
      T.priceBg?.setAttribute("display", "none");
      T.priceText?.setAttribute("display", "none");
      bodyPctEl?.setAttribute("display", "none");
      // RSI 패널엔 지그재그가 없다
      const L = legRefs.current;
      L.pct?.setAttribute("display", "none");
      hideLegRows(L);
    }
  }, []);

  /**
   * 지그재그 레그 hover 라벨 — 커서 아래쪽에 작게. pct가 null이면 숨긴다.
   * 가격 라벨(priceText)보다 한 줄 아래에 두어 겹치지 않게 한다.
   *
   *   +2.41%   상위3 ▲2.1K ↓41%    ← 상승 레그면 ▲만 / 하락 레그면 ▼만 ([LV6])
   *            평균  ▲1.4K ↑12%    └직전 동일방향 레그의 **같은 지표** 대비
   *            총량  ▲9.8K ↑37%
   *   └등락률
   *
   * 줄 이름을 반드시 써 붙인다 — 숫자만 있으면 무엇의 값인지 알 수 없다.
   *
   * [LV8][LV9] 세 줄인 이유: 한 값만 보면 그 값의 약점에 그대로 걸린다.
   *   평균·상위3은 레그 길이와 무관하고(상관계수 0.00 / 0.10), 총량은 길이에 휘둘린다(0.29).
   *   **셋이 갈리는 것 자체가 정보**다. 줄 수를 줄이지 말 것.
   *   ※ 피크(봉 하나) 줄은 2026-08-13 사용자가 뺐다 — 되살리지 말 것 (legVolume.js [LV9])
   *
   * [LV5] 한때 아래에 **테이커(체결 주체) 기준** 줄을 나란히 두고 비교했다.
   *   2026-08-13 사용자 요청으로 제거 — 캔들 색 기준 한 줄만 남긴다. 되살리지 말 것.
   *
   * ── 색 규칙 (두 축이 섞여 있으니 헷갈리지 말 것) ────────────────────────────
   *   **값**(▲3.2K)   = 매수 쪽인가 매도 쪽인가  — 초록 / 빨강 (JSX 고정)
   *   **증감률**(↓63%) = 직전 대비 늘었나 줄었나  — 증가 초록 / 감소 빨강 (매번 설정)
   * 그래서 `▼1.8K ↑12%`처럼 **한 쌍 안에서 색이 갈리는 게 정상**이다
   * (매도 쪽 값인데 직전보다 늘었다는 뜻). 실측 126쌍 중 62개(49%)가 갈린다.
   * 해석은 글자로 단정하지 않는다 — 상승 레그인데 매수 거래량 ↓면 동력 약화지만,
   * 그 판단은 사용자 몫이다.
   *
   * 해당 봉이 없는 레그는 그쪽을 **비운다** (0으로 채우면 "거래량 0"으로 읽힌다).
   */
  const showLegPct = useCallback(({ x, y, IH, pct, rows }) => {
    const L  = legRefs.current;
    const el = L.pct;
    if (!el) return;
    if (pct == null) {
      el.setAttribute("display", "none");
      hideLegRows(L);
      return;
    }
    // 세 줄이라 커서가 아래쪽에 있으면 패널 밖으로 넘친다 → 커서 **위**로 뒤집는다
    // (한 줄이던 시절엔 없던 문제. IH를 안 넘겨주면 뒤집지 않고 예전처럼 아래로만 간다)
    const span = (LEG_VOL_METRICS.length - 1) * LEG_ROW_H;
    const flip = IH != null && y + 30 + span > IH;
    const y0   = M.top + y + (flip ? -10 - span : 30);

    const sign = pct >= 0 ? "+" : "";
    const text = `${sign}${pct.toFixed(2)}%`;
    el.textContent = text;
    el.setAttribute("fill", pct >= 0 ? UP : DN);
    el.setAttribute("x", M.left + x + 8);
    el.setAttribute("y", y0);
    el.setAttribute("display", "inline");

    // 거래량 줄의 x는 등락률 폭에서 계산한다
    // (등폭이라 글자 수 × 한 글자 폭 — getComputedTextLength는 강제 레이아웃을 유발한다)
    const rowX = M.left + x + 8 + text.length * LEG_PCT_CH + 6;

    // 값 tspan과 증감률 tspan을 채운다.
    // ※ 증감률 색은 **값의 방향이 아니라 증감 자체**로 정한다
    const fillSide = (valEl, dEl, side, mark, lead) => {
      if (side?.vol == null) {
        if (valEl) valEl.textContent = "";
        if (dEl)   dEl.textContent   = "";
        return false;
      }
      if (valEl) valEl.textContent = `${lead}${mark}${side.vol}`;
      if (dEl) {
        if (side.delta == null) dEl.textContent = "";
        else {
          dEl.textContent = `${NB}${side.delta >= 0 ? "↑" : "↓"}${Math.abs(side.delta).toFixed(0)}%`;
          dEl.setAttribute("fill", side.delta >= 0 ? UP : DN);
        }
      }
      return true;
    };

    // 줄 순서는 LEG_VOL_METRICS 그대로 (상위3 → 평균 → 총량)
    LEG_VOL_METRICS.forEach(({ key }, i) => {
      const textEl = L[`${key}Text`];
      if (!textEl) return;
      const row   = rows?.[key];
      const hasUp = fillSide(L[`${key}Up`], L[`${key}UpD`], row?.up, "▲", "");
      const hasDn = fillSide(L[`${key}Dn`], L[`${key}DnD`], row?.dn, "▼", hasUp ? NB + NB : "");
      if (!hasUp && !hasDn) { textEl.setAttribute("display", "none"); return; }
      textEl.setAttribute("x", rowX);
      textEl.setAttribute("y", y0 + i * LEG_ROW_H);
      textEl.setAttribute("display", "inline");
    });
  }, []);

  const hide = useCallback(() => {
    vLineRef.current?.setAttribute("display", "none");
    hLineMainRef.current?.setAttribute("display", "none");
    hLineRsiRef.current?.setAttribute("display", "none");
    bodyPctRef.current?.setAttribute("display", "none");
    hideTags(axisTagRefs.current);
    const L = legRefs.current;
    L.pct?.setAttribute("display", "none");
    hideLegRows(L);
  }, []);

  return {
    vLineRef, hLineMainRef, hLineRsiRef, bodyPctRef, legRefs, axisTagRefs,
    updateCrosshair: update, hideCrosshair: hide, showLegPct,
  };
}
