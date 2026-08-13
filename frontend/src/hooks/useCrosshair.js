import { useRef, useCallback } from "react";
import { M, RSI_GAP, VOL_GAP } from "../constants";

function fmtPrice(p) {
  return (p / 1000).toFixed(1) + "k";
}

// 구분 공백은 U+00A0 — SVG 기본 공백 처리(xml:space="default")가 tspan 경계의
// 일반 공백을 없애버려서 숫자들이 붙어 버린다
const NB = " ";
const UP = "#0ecb81", DN = "#f6465d";

export function useCrosshair() {
  const vLineRef      = useRef(null);
  const hLineMainRef  = useRef(null);
  const hLineRsiRef   = useRef(null);
  const priceTextRef  = useRef(null);
  const bodyPctRef    = useRef(null);

  // 지그재그 레그(수동 구조 / 자동 ZZ) hover 라벨의 SVG 요소들.
  // 크로스헤어와 같은 imperative 레이어에 둔다 — 마우스 이동마다 React 상태를
  // 갱신하면 SVG 오버레이 전체가 리렌더된다.
  //
  // 요소가 6개라 **ref 하나에 모아 담는다** (prop을 그만큼 ChartArea →
  // ChartSvg로 내려보내지 않으려고). ChartSvg가 콜백 ref로 채운다.
  //   pct                            등락률
  //   volText / vol{Up,UpD,Dn,DnD}   캔들 색 기준 피크 줄
  // ※ 테이커 기준 줄(tkr*)은 2026-08-13 제거 — legVolume.js [LV5]
  //
  // tspan 4개인 이유 — 색이 **두 축으로** 갈리기 때문이다:
  //   값(▲3.2K)    = 매수 쪽인가 매도 쪽인가 (JSX 고정)
  //   증감률(↓63%)  = 직전 대비 늘었나 줄었나 (매번 설정)
  // 실측 126쌍 중 62개(49%)가 이 둘의 색이 갈린다. 한 색으로 묶으면 절반이 틀린 색이 된다.
  // ※ tspan을 쓰면 **가로 위치가 자동으로 이어진다** — 별도 <text>로 나누면
  //   문자폭을 추정해 x를 계산해야 하고, 값 길이가 바뀔 때마다 어긋난다.
  const legRefs = useRef({});

  const update = useCallback(({ x, y, inRsi, IW, IH, rsiH, volH, price, bodyPct }) => {
    const vLine     = vLineRef.current;
    const hLineMain = hLineMainRef.current;
    const hLineRsi  = hLineRsiRef.current;
    const priceText = priceTextRef.current;
    const bodyPctEl = bodyPctRef.current;
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

    const x1 = M.left, x2 = M.left + IW;

    if (!inRsi) {
      const svgY = M.top + y;
      hLineMain.setAttribute("x1", x1); hLineMain.setAttribute("x2", x2);
      hLineMain.setAttribute("y1", svgY); hLineMain.setAttribute("y2", svgY);
      hLineMain.setAttribute("display", "inline");
      hLineRsi.setAttribute("display", "none");

      if (priceText && price != null) {
        priceText.textContent = fmtPrice(price);
        priceText.setAttribute("x", svgX + 8);
        priceText.setAttribute("y", svgY + 14);
        priceText.setAttribute("display", "inline");
      }

      if (bodyPctEl && bodyPct != null) {
        const sign   = bodyPct >= 0 ? "+" : "";
        bodyPctEl.textContent = `${sign}${bodyPct.toFixed(2)}%`;
        bodyPctEl.setAttribute("fill", bodyPct >= 0 ? UP : DN);
        // 모노스페이스 13px 기준 문자당 약 8px (getComputedTextLength는 강제 레이아웃 유발)
        const priceW = priceText ? priceText.textContent.length * 8 : 40;
        bodyPctEl.setAttribute("x", svgX + 8 + priceW + 5);
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
      priceText?.setAttribute("display", "none");
      bodyPctEl?.setAttribute("display", "none");
      // RSI 패널엔 지그재그가 없다
      const L = legRefs.current;
      L.pct?.setAttribute("display", "none");
      L.volText?.setAttribute("display", "none");
    }
  }, []);

  /**
   * 지그재그 레그 hover 라벨 — 커서 아래쪽에 작게. pct가 null이면 숨긴다.
   * 가격 라벨(priceText)보다 한 줄 아래에 두어 겹치지 않게 한다.
   *
   *   +2.41%   피크 ▲3.2K ↓63%     ← 상승 레그면 ▲만 / 하락 레그면 ▼만 ([LV6])
   *   └등락률       └직전 동일방향 레그의 같은 쪽 피크 대비
   *
   * **합계가 아니라 피크**다 (legVolume.js [LV2]). "피크"라고 써 붙이는 이유도
   * 그것 — 숫자만 있으면 합계로 읽힌다.
   *
   * [LV5] 한때 아래에 **테이커(체결 주체) 기준** 줄을 나란히 두고 비교했다.
   *   2026-08-13 사용자 요청으로 제거 — 캔들 색 기준 한 줄만 남긴다. 되살리지 말 것.
   *
   * ── 색 규칙 (두 축이 섞여 있으니 헷갈리지 말 것) ────────────────────────────
   *   **값**(▲3.2K)   = 매수 쪽인가 매도 쪽인가  — 초록 / 빨강 (JSX 고정)
   *   **증감률**(↓63%) = 직전 대비 늘었나 줄었나  — 증가 초록 / 감소 빨강 (매번 설정)
   * 그래서 `▼1.8K ↑12%`처럼 **한 쌍 안에서 색이 갈리는 게 정상**이다
   * (매도 쪽 피크인데 직전보다 늘었다는 뜻). 실측 126쌍 중 62개(49%)가 갈린다.
   * 해석은 글자로 단정하지 않는다 — 상승 레그인데 매수 피크 ↓면 동력 약화지만,
   * 그 판단은 사용자 몫이다.
   *
   * 해당 봉이 없는 레그는 그쪽을 **비운다** (0으로 채우면 "피크 0"으로 읽힌다).
   */
  const showLegPct = useCallback(({ x, y, pct, row }) => {
    const L  = legRefs.current;
    const el = L.pct;
    if (!el) return;
    if (pct == null) {
      el.setAttribute("display", "none");
      L.volText?.setAttribute("display", "none");
      return;
    }
    const sign = pct >= 0 ? "+" : "";
    const text = `${sign}${pct.toFixed(2)}%`;
    el.textContent = text;
    el.setAttribute("fill", pct >= 0 ? UP : DN);
    el.setAttribute("x", M.left + x + 8);
    el.setAttribute("y", M.top  + y + 30);
    el.setAttribute("display", "inline");

    // 거래량 줄의 x는 등락률 폭에서 계산한다
    // (모노스페이스 11px 기준 문자당 약 6.6px — getComputedTextLength는 강제 레이아웃 유발)
    const rowX = M.left + x + 8 + text.length * 6.6 + 6;

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

    const textEl = L.volText;
    if (!textEl) return;
    const hasUp = fillSide(L.volUp, L.volUpD, row?.up, "▲", "");
    const hasDn = fillSide(L.volDn, L.volDnD, row?.dn, "▼", hasUp ? NB + NB : "");
    if (!hasUp && !hasDn) { textEl.setAttribute("display", "none"); return; }
    textEl.setAttribute("x", rowX);
    textEl.setAttribute("y", M.top + y + 30);
    textEl.setAttribute("display", "inline");
  }, []);

  const hide = useCallback(() => {
    vLineRef.current?.setAttribute("display", "none");
    hLineMainRef.current?.setAttribute("display", "none");
    hLineRsiRef.current?.setAttribute("display", "none");
    priceTextRef.current?.setAttribute("display", "none");
    bodyPctRef.current?.setAttribute("display", "none");
    const L = legRefs.current;
    L.pct?.setAttribute("display", "none");
    L.volText?.setAttribute("display", "none");
  }, []);

  return {
    vLineRef, hLineMainRef, hLineRsiRef, priceTextRef, bodyPctRef, legRefs,
    updateCrosshair: update, hideCrosshair: hide, showLegPct,
  };
}
