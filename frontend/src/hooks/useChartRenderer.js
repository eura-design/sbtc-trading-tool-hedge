import { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { getScales, fitYDomain, initialXDomain } from "../chart/scales";
import { renderCandles, renderVolumeCanvas, renderRSICanvas } from "../chart/candleRenderer";

export function useChartRenderer({ candles, candlesRef, interval_, isDark, IW, IH, canvasRef, volCanvasRef, rsiCanvasRef, isLog = false, overlaysRef }) {
  const xDomainRef         = useRef(null);
  const yDomainRef         = useRef(null);
  const scalesRef          = useRef(null); // 마지막으로 계산된 scales 캐시
  const prevCandleCountRef = useRef(0);
  const isInitialLoadRef   = useRef(true);
  const [renderTick, setRenderTick] = useState(0);

  // sync=true면 **캔버스와 같은 프레임 안에서** SVG 오버레이까지 커밋한다.
  //
  // ⚠ 캔버스는 동기, React는 비동기라 그냥 두면 **SVG가 한 프레임 이상 늦는다.**
  //   팬·줌처럼 좌표계 전체가 움직일 때 그 차이가 그대로 어긋남으로 보인다 —
  //   특히 꼭짓점이 캔들에 박혀 있는 도형(수동 구조·측정 박스)에서 눈에 띈다.
  //   직선(추세선)이나 수평선은 밀려도 자기 자신과 겹쳐서 티가 안 날 뿐 같이 늦는다.
  //   (한 좌표계를 캔버스와 SVG가 나눠 갖는 이상 우선순위로는 못 없앤다 —
  //    프레임워크 커밋을 렌더 루프에 종속시키는 것이 정석이다)
  //
  // ⚠ **rAF 안에서만 sync=true로 부를 것.** 이벤트 핸들러나 렌더 도중에 부르면
  //   React가 경고한다. 지금 부르는 곳은 팬(dragStateMachine)과 휠 줌 둘뿐이고
  //   둘 다 requestAnimationFrame 콜백 안이다.
  const forceUpdate = sync => {
    if (sync) flushSync(() => setRenderTick(n => n + 1));
    else setRenderTick(n => n + 1);
  };

  // ⚠ **candlesRef를 읽는 콜백은 deps에 candlesRef를 넣어야 한다** (2026-08-15, 실측 버그).
  //   `App.jsx`가 `replayOn ? replay : live`로 고르기 때문에 **모드를 바꾸면 ref 객체
  //   자체가 다른 것으로 바뀐다**(같은 ref의 .current만 바뀌는 게 아니다).
  //   deps에서 빠뜨리면 콜백이 전환 **이전** ref를 계속 붙들고, 그쪽은 비활성이라
  //   `.current`가 빈 배열이다 → renderVolumeCanvas가 `!candles.length`로 그냥 돌아간다.
  //   증상: **리플레이에서 휠 줌을 해도 거래량 패널만 그대로 멈춰 있다**(사용자 신고).
  //   메인 캔버스가 멀쩡했던 건 우연이다 — deps의 IH가 ReplayBar 높이 때문에 같이 바뀌어
  //   콜백이 어차피 새로 만들어졌다. RSI는 candlesRef를 아예 안 쓴다(overlaysRef의 rsiData).
  //   → "ref는 안정적이니 deps에 넣을 필요 없다"며 다시 빼지 말 것.

  // 틱 RAF에서 호출 — 메인 캔버스만 재드로우 (볼륨 제외)
  const redrawCanvas = useCallback(() => {
    const c = candlesRef.current;
    const scales = getScales(c, xDomainRef, yDomainRef, IW, IH, isLog);
    if (!scales || !canvasRef.current) return;
    scalesRef.current = scales; // 캐시 갱신
    renderCandles(canvasRef.current, c, scales.xScale, scales.yScale, IW, IH, interval_, isDark, overlaysRef);
  }, [interval_, IW, IH, isDark, isLog, candlesRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // 볼륨 캔버스만 재드로우 — 틱과 무관, pan/zoom/candle close 시에만 호출
  const redrawVolume = useCallback(() => {
    const ov = overlaysRef?.current ?? {};
    if (!volCanvasRef?.current || !scalesRef.current || !ov.showVol || ov.volH <= 0) return;
    renderVolumeCanvas(volCanvasRef.current, candlesRef.current, scalesRef.current.xScale, IW, ov.volH, isDark, ov.volColorMode);
  }, [IW, isDark, candlesRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // 틱 RAF에서 호출 — 진행 중 봉의 거래량 높이/색상(양봉↔음봉)을 실시간 반영
  // 진행 중 봉이 화면 밖(과거 구간을 보는 중)이면 바뀌는 게 없으므로 건너뛴다
  const redrawVolumeTick = useCallback(() => {
    const ov = overlaysRef?.current ?? {};
    if (!volCanvasRef?.current || !scalesRef.current || !ov.showVol || ov.volH <= 0) return;
    const c = candlesRef.current;
    if (!c.length) return;
    const [d0, d1] = scalesRef.current.xScale.domain();
    const lastIdx = c.length - 1;
    if (lastIdx < d0 - 1 || lastIdx > d1 + 1) return;
    renderVolumeCanvas(volCanvasRef.current, c, scalesRef.current.xScale, IW, ov.volH, isDark, ov.volColorMode);
  }, [IW, isDark, candlesRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // RSI 캔버스만 재드로우 — pan/zoom 중 RSI가 즉시 따라오도록 (volume과 동일 패턴)
  const redrawRSI = useCallback(() => {
    const ov = overlaysRef?.current ?? {};
    if (!rsiCanvasRef?.current || !scalesRef.current || !ov.showRsi || ov.rsiH <= 0) return;
    renderRSICanvas(rsiCanvasRef.current, ov.rsiData, scalesRef.current.xScale, IW, ov.rsiH, isDark, ov.rsiParams);
  }, [IW, isDark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Canvas + SVG 오버레이 동기화 (pan 종료, 줌, 데이터 변경 시 사용)
  const redrawChart = useCallback((sync = false) => {
    redrawCanvas();
    redrawVolume();
    redrawRSI();
    forceUpdate(sync);
  }, [redrawCanvas, redrawVolume, redrawRSI]); // eslint-disable-line react-hooks/exhaustive-deps

  // 최근 300봉(또는 있는 만큼) 기준으로 x/y 도메인을 처음부터 다시 잡는다.
  // 캔들이 아직 없으면 아무것도 하지 않고 false — 그때는 isInitialLoadRef를 true로 남겨
  // 캔들이 도착했을 때 아래 [candles] 이펙트가 잡게 한다
  const applyInitialDomain = useCallback((cIn) => {
    const c = cIn ?? candlesRef.current;
    if (!c?.length) return false;
    xDomainRef.current = initialXDomain(c);
    yDomainRef.current = fitYDomain(c, xDomainRef.current, isLog);
    isInitialLoadRef.current   = false;
    prevCandleCountRef.current = c.length;
    return true;
    // candlesRef가 deps에 있는 이유는 위 redrawCanvas 주석 참고 (모드 전환 시 ref 객체가 바뀐다).
    // 여기서 빠뜨리면 resetDomain()이 빈 배열을 보고 false를 돌려줘 도메인을 안 잡는다
  }, [isLog, candlesRef]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!candles.length) return;

    if (!xDomainRef.current || isInitialLoadRef.current) {
      applyInitialDomain(candles);
      redrawChart(); return;
    }

    if (candles.length !== prevCandleCountRef.current) {
      prevCandleCountRef.current = candles.length;
      const lastIdx = candles.length - 1;
      const [i0, i1] = xDomainRef.current;
      if (lastIdx > i1) {
        const span = i1 - i0;
        xDomainRef.current = [lastIdx - span + 50, lastIdx + 50];
      }
      redrawChart(); return;
    }

    // 틱 업데이트는 useCandles의 onTickRef 콜백(RAF)이 직접 처리 — 여기서는 아무것도 하지 않음
  }, [candles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { redrawChart(); }, [IW, IH]);    // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                  // eslint-disable-line react-hooks/exhaustive-deps
    const c = candlesRef.current;
    if (c.length && xDomainRef.current) yDomainRef.current = fitYDomain(c, xDomainRef.current, isLog);
    redrawChart();
  }, [isLog]);
  useEffect(() => { redrawChart(); }, [isDark]);    // eslint-disable-line react-hooks/exhaustive-deps

  // 뷰포트를 버리고 다시 잡게 한다.
  //
  // ⚠ **`defer`를 정확히 골라야 한다.** 둘 다 실제로 버그를 냈다:
  //   · `defer: true`  — 버리기만 하고, 새 캔들이 도착하면 아래 [candles] 이펙트가 잡는다.
  //       **TF 전환처럼 candlesRef에 아직 옛 캔들이 들어 있을 때 반드시 이것.**
  //       즉시 잡으면 옛 TF의 봉 개수·가격대로 도메인이 확정돼(그리고 isInitialLoadRef가
  //       꺼져서 다시 잡히지도 않아) 새 TF에서 엉뚱한 구간이 보인다
  //   · 기본(즉시)   — 그 자리에서 다시 잡고 그린다. 모드 전환·시크처럼 candlesRef가
  //       **이미 새 데이터**일 때 쓴다. 비우기만 하면 candles identity가 안 바뀌어
  //       [candles] 이펙트가 안 돌고, 아무도 도메인을 다시 잡지 않는다
  // ※ 어느 쪽이든 도메인이 비어 있는 동안은 getScales의 폴백이 그린다.
  //   그 폴백도 같은 initialXDomain·fitYDomain을 쓰므로 화면이 튀지 않는다 (scales.js 주석)
  const resetDomain = useCallback((opts) => {
    isInitialLoadRef.current   = true;
    prevCandleCountRef.current = 0;
    xDomainRef.current         = null;
    yDomainRef.current         = null;
    scalesRef.current          = null;
    if (opts?.defer) { redrawChart(); return; }
    if (applyInitialDomain()) redrawChart();
  }, [applyInitialDomain, redrawChart]);

  return { xDomainRef, yDomainRef, scalesRef, redrawCanvas, redrawChart, redrawVolume, redrawVolumeTick, redrawRSI, resetDomain, renderTick };
}
