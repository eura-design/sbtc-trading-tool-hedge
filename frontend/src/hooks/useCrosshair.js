import { useRef, useCallback } from "react";
import { M, RSI_GAP, VOL_GAP } from "../constants";

function fmtPrice(p) {
  return (p / 1000).toFixed(1) + "k";
}

export function useCrosshair() {
  const vLineRef      = useRef(null);
  const hLineMainRef  = useRef(null);
  const hLineRsiRef   = useRef(null);
  const priceTextRef  = useRef(null);
  const bodyPctRef    = useRef(null);
  // 지그재그 레그(수동 구조 / 자동 ZZ) 위에 올렸을 때의 등락률.
  // 크로스헤어와 같은 imperative 레이어에 둔다 — 마우스 이동마다 React 상태를
  // 갱신하면 SVG 오버레이 전체가 리렌더된다.
  const legPctRef     = useRef(null);

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
        bodyPctEl.setAttribute("fill", bodyPct >= 0 ? "#0ecb81" : "#f6465d");
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
      legPctRef.current?.setAttribute("display", "none");   // RSI 패널엔 지그재그가 없다
    }
  }, []);

  /**
   * 지그재그 레그 등락률 — 커서 아래쪽에 작게. pct가 null이면 숨긴다.
   * 가격 라벨(priceText)보다 한 줄 아래에 두어 겹치지 않게 한다.
   */
  const showLegPct = useCallback(({ x, y, pct }) => {
    const el = legPctRef.current;
    if (!el) return;
    if (pct == null) { el.setAttribute("display", "none"); return; }
    const sign = pct >= 0 ? "+" : "";
    el.textContent = `${sign}${pct.toFixed(2)}%`;
    el.setAttribute("fill", pct >= 0 ? "#0ecb81" : "#f6465d");
    el.setAttribute("x", M.left + x + 8);
    el.setAttribute("y", M.top  + y + 30);
    el.setAttribute("display", "inline");
  }, []);

  const hide = useCallback(() => {
    vLineRef.current?.setAttribute("display", "none");
    hLineMainRef.current?.setAttribute("display", "none");
    hLineRsiRef.current?.setAttribute("display", "none");
    priceTextRef.current?.setAttribute("display", "none");
    bodyPctRef.current?.setAttribute("display", "none");
    legPctRef.current?.setAttribute("display", "none");
  }, []);

  return {
    vLineRef, hLineMainRef, hLineRsiRef, priceTextRef, bodyPctRef, legPctRef,
    updateCrosshair: update, hideCrosshair: hide, showLegPct,
  };
}
