import { useRef, useCallback } from "react";
import * as d3 from "d3";
import { M, RSI_GAP, VOL_GAP } from "../constants";
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

const UP = "#0ecb81", DN = "#f6465d";
// ⚠ 여기 있던 `NB`(U+00A0 공백)와 `LEG_ROW_H`(줄 간격)는 **2026-09-26에 지웠다** —
//   레그 hover 라벨의 거래량 줄을 tspan으로 이어 붙일 때 쓰던 값이고, 그 기능이
//   없어지면서 쓰는 곳이 사라졌다.
//   ※ `NB`가 필요했던 이유는 SVG 기본 공백 처리(xml:space="default")가 tspan 경계의
//     일반 공백을 없애 숫자들이 붙어버리기 때문이었다. tspan을 다시 쓸 일이 생기면
//     그 함정부터 떠올릴 것

// 지그재그 레그 등락률(%)의 글자 크기 — **캔들 몸통 등락률(bodyPct)과 같은 13px**
// (2026-08-24 사용자 요청). 예전엔 11px이라 같은 `%` 값인데 둘의 크기가 달랐다.
// 겹쳐 보일 걱정은 없다: 레그 라벨은 한 줄 아래에 따로 놓이므로 자리로 이미 갈린다.
//
// ⚠ **ChartSvg의 `<text>` fontSize와 반드시 같아야 한다** — ChartSvg가 이 상수를 가져다 쓴다.
//   ※ 2026-09-26까지는 이 값으로 거래량 줄의 x도 계산했다(LEG_PCT_CH). 그 기능은 지웠다
export const LEG_PCT_FS = 13;

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
  // 담는 것은 `pct`(등락률) 하나다. ChartSvg가 콜백 ref로 채운다.
  // ⚠ 2026-09-26까지는 여기에 거래량 줄 요소 15개가 더 있었다
  //   (`{key}Text` / `{key}{Up,UpD,Dn,DnD}`). 그 기능을 지우면서 같이 없앴다 —
  //   ref 하나에 모아 담는 방식은 그때 요소가 16개였기 때문이고, 지금은 하나뿐이라
  //   굳이 풀지 않았다(ChartSvg의 콜백 ref 배선을 그대로 두는 편이 변경이 적다).
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
      legRefs.current.pct?.setAttribute("display", "none");
    }
  }, []);

  /**
   * 지그재그 레그 hover 라벨 — 커서 아래쪽에 작게 **등락률 한 줄**. pct가 null이면 숨긴다.
   * 가격 라벨(priceText)보다 한 줄 아래에 두어 겹치지 않게 한다.
   *
   *   +2.41%
   *   └등락률
   *
   * ⚠ 여기 있던 **거래량 비교 세 줄(상위3·평균·총량)은 2026-09-26에 기능째 지웠다**
   *   (사용자 요청). 되살리지 말 것 — 되살리려면 `chart/legVolume.js`(계산)부터 다시
   *   만들어야 하고, `findHoveredLeg`의 `showVol`·`prev`, 구조별 `showLegVol` 토글,
   *   `zz.show_legvol`, ChartSvg의 tspan 줄까지 전부 딸려 온다.
   *   그 기능이 담고 있던 결정들(테이커 줄 제거·같은 쪽끼리만 비교·세 지표로 나눈 근거)은
   *   커밋 메시지에 옮겨 적었다.
   */
  const showLegPct = useCallback(({ x, y, IH, pct }) => {
    const el = legRefs.current.pct;
    if (!el) return;
    if (pct == null) {
      el.setAttribute("display", "none");
      return;
    }
    // 커서가 패널 맨 아래에 있으면 라벨이 밖으로 넘친다 → 커서 **위**로 뒤집는다.
    // IH를 안 넘겨주면 뒤집지 않고 아래로만 간다
    const flip = IH != null && y + 30 > IH;

    el.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
    el.setAttribute("fill", pct >= 0 ? UP : DN);
    el.setAttribute("x", M.left + x + 8);
    el.setAttribute("y", M.top + y + (flip ? -10 : 30));
    el.setAttribute("display", "inline");
  }, []);

  const hide = useCallback(() => {
    vLineRef.current?.setAttribute("display", "none");
    hLineMainRef.current?.setAttribute("display", "none");
    hLineRsiRef.current?.setAttribute("display", "none");
    bodyPctRef.current?.setAttribute("display", "none");
    hideTags(axisTagRefs.current);
    legRefs.current.pct?.setAttribute("display", "none");
  }, []);

  return {
    vLineRef, hLineMainRef, hLineRsiRef, bodyPctRef, legRefs, axisTagRefs,
    updateCrosshair: update, hideCrosshair: hide, showLegPct,
  };
}
