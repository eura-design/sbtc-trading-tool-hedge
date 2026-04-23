import { useRef, useMemo, useEffect, useState } from "react";
import { M, RSI_GAP, VOL_GAP } from "../constants";
import { useStore }          from "../store";
import { useShallow }        from "zustand/react/shallow";
import { useChartSize }      from "../hooks/useChartSize";
import { useRsiResize }      from "../hooks/useRsiResize";
import { useVolResize }      from "../hooks/useVolResize";
import { useCrosshair }      from "../hooks/useCrosshair";
import { useChartRenderer }  from "../hooks/useChartRenderer";
import { useChartInteraction } from "../hooks/useChartInteraction";
import { useOrderFlow }      from "../hooks/useOrderFlow";
import { getScales }         from "../chart/scales";
import { ChartSvg }          from "./Chart/ChartSvg";
import { LineOpacityPopup }  from "./Chart/LineOpacityPopup";

export function ChartArea({
  // 캔들 데이터
  candles, candlesRef, candleLoading, onTickRef, interval_, isDark, isLog,
  // 오버레이 데이터
  rsiData, emaData, fvgData, obData, srData: srLevels,
  msData,
  // 지표 표시 여부
  showRsi, showSR, showOB, showFVG, showVol, showEMA, showDiv,
  showMS,
  // 지표 파라미터
  indicatorParams,
  // 다이버전스
  divData,
  // 드로잉 상태 (useTrendLines)
  lines, lineMode, lineStart, setLineStart, linePreview, setLinePreview,
  selectedLineId, setSelectedLineId,
  addLine, updateLineEndpoint, setLinePosition,
  setLineOpacity, toggleLineLock, toggleLineAlert, setLineAlertOff,
  channels, channelMode, channelStep, setChannelStep,
  channelPoints, setChannelPoints, channelPreview, setChannelPreview,
  selectedChannelId, setSelectedChannelId,
  addChannel, updateChannelEndpoint, setChannelPosition, setChannelOffset,
  setChannelOpacity, toggleChannelLock, toggleChannelAlert, setChannelAlertOff,
  circles, circleMode, circleCenter, setCircleCenter, circlePreview, setCirclePreview,
  selectedCircleId, setSelectedCircleId,
  addCircle, moveCircle,
  setCircleOpacity, toggleCircleLock, toggleCircleAlert, setCircleAlertOff,
  cancelDraw, cancelChannelDraw, cancelCircleDraw,
  // 공유 상태 (App.jsx에서 관리 — 키보드 ESC와 공유)
  current, setCurrent,
  // resetDomain 노출용 ref (App.jsx에서 interval 변경 시 호출)
  actionsRef,
}) {
  // 스토어에서 필요한 상태만
  const {
    drawing, setDrawing, drawMode, setDrawMode,
    tpsl, tpslSaving, position,
    dragTpsl, setDragTpsl,
    dragScaleIn, setDragScaleIn,
    dragSplitTp, setDragSplitTp,
    selectedBox, setSelectedBox,
    opacityPopup, setOpacityPopup,
  } = useStore(useShallow(s => ({
    drawing: s.drawing, setDrawing: s.setDrawing,
    drawMode: s.drawMode, setDrawMode: s.setDrawMode,
    tpsl: s.tpsl, tpslSaving: s.tpslSaving, position: s.position,
    dragTpsl: s.dragTpsl, setDragTpsl: s.setDragTpsl,
    dragScaleIn: s.dragScaleIn, setDragScaleIn: s.setDragScaleIn,
    dragSplitTp: s.dragSplitTp, setDragSplitTp: s.setDragSplitTp,
    selectedBox: s.selectedBox, setSelectedBox: s.setSelectedBox,
    opacityPopup: s.opacityPopup, setOpacityPopup: s.setOpacityPopup,
  })));

  const hasPos     = position?.open === true;
  const hasPending = !!position?.pending;
  const locked     = hasPos || hasPending;

  // ── 봉마감 카운트다운 ──────────────────────────────────────────────────────
  const INTERVAL_MS = { "5m": 5*60*1000, "15m": 15*60*1000, "1h": 60*60*1000, "4h": 4*60*60*1000, "1d": 24*60*60*1000, "1w": 7*24*60*60*1000 };
  const fmtCountdown = ms => {
    if (ms <= 0) return "00:00";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
    return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  };
  const [countdown, setCountdown] = useState({ text: "", ratio: 1 });
  const last = candles.length > 0 ? candles[candles.length - 1] : null;
  useEffect(() => {
    if (!last) return;
    const intervalMs = INTERVAL_MS[interval_] ?? 60*60*1000;
    const closeTime  = last.t.getTime() + intervalMs;
    const tick = () => {
      const remaining = closeTime - Date.now();
      setCountdown({ text: fmtCountdown(remaining), ratio: Math.max(0, remaining / intervalMs) });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [last?.t?.getTime(), interval_]); // eslint-disable-line react-hooks/exhaustive-deps
  const cdColor = countdown.ratio > 0.3 ? "#e2e8f0" : countdown.ratio > 0.1 ? "#f59e0b" : "#f6465d";

  // ── 패널 크기 ─────────────────────────────────────────────────────────────
  const { rsiH, onDividerMouseDown }    = useRsiResize();
  const { volH, onVolDividerMouseDown } = useVolResize();
  const chartContainerRef = useRef(null);
  const { w: containerW, h: containerH } = useChartSize(chartContainerRef);
  const IW = containerW - M.left - M.right;
  const effectiveRsiH = showRsi ? rsiH : 0;
  const effectiveVolH = showVol ? volH : 0;
  const IH = containerH - M.top - M.bottom
    - (showRsi ? RSI_GAP : 0) - effectiveRsiH
    - (showVol ? VOL_GAP : 0) - effectiveVolH;

  const svgRef       = useRef(null);
  const canvasRef    = useRef(null);
  const volCanvasRef = useRef(null);
  const rsiCanvasRef = useRef(null);

  // current: 박스 그리기 중 드래그 사각형 (App.jsx에서 관리 — 키보드 ESC 공유)


  // ── 오버레이 ref (틱마다 React 상태 없이 최신값 반영) ─────────────────────
  const overlaysRef = useRef({});
  overlaysRef.current = {
    fvgData, showFVG, obData, showOB, srLevels, showSR, emaData, showEMA,
    msData, showMS,
    showVol, volH: effectiveVolH, volColorMode: indicatorParams.vol?.colorMode ?? "neutral",
    rsiData, showRsi, rsiH: effectiveRsiH, rsiParams: indicatorParams.rsi,
  };

  // ── 캔버스 렌더러 ──────────────────────────────────────────────────────────
  const { xDomainRef, yDomainRef, scalesRef, redrawCanvas, redrawChart, redrawVolume, redrawRSI, renderTick, resetDomain } =
    useChartRenderer({ candles, candlesRef, interval_, isDark, IW, IH, canvasRef, volCanvasRef, rsiCanvasRef, isLog, overlaysRef });

  // onTickRef에 redrawCanvas 연결 — WebSocket 틱마다 React 상태 없이 캔버스 재드로우
  onTickRef.current = redrawCanvas;
  // actionsRef에 resetDomain 노출 — App.jsx에서 interval 변경 시 호출
  if (actionsRef) actionsRef.current = {
    resetDomain,
    canvasRef, volCanvasRef, rsiCanvasRef,
    containerRef: chartContainerRef, scalesRef,
  };

  // ── 오버레이 변경 시 캔버스 재렌더 ────────────────────────────────────────
  // candles.length 가드: 타임프레임 전환 중 candles=[] 상태에서 forceUpdate가 불려
  // scales=null이 되면 SVG 오버레이가 순간 사라지는 들썩임이 발생하므로 방지
  useEffect(() => { if (candles.length) redrawChart(); }, [fvgData, obData, srLevels, showFVG, showOB, showSR, showEMA, emaData, msData, showMS]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { redrawVolume(); }, [showVol, effectiveVolH, indicatorParams.vol?.colorMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (candles.length) redrawRSI(); }, [rsiData, showRsi, effectiveRsiH, indicatorParams.rsi]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 주문 액션 ─────────────────────────────────────────────────────────────
  const { openConfirm, saveTpsl, moveScaleIn, moveSplitTp } = useOrderFlow();

  // ── 크로스헤어 ────────────────────────────────────────────────────────────
  const { vLineRef, hLineMainRef, hLineRsiRef, priceTextRef, bodyPctRef, updateCrosshair, hideCrosshair } = useCrosshair();

  // ── 차트 인터랙션 ─────────────────────────────────────────────────────────
  const { dragRef, onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onDoubleClick } =
    useChartInteraction({
      candles, IW, IH, rsiH: effectiveRsiH, volH: effectiveVolH, updateCrosshair, hideCrosshair,
      scalesRef,
      onLineDoubleClick: (id, type, x, y) => setOpacityPopup({ id, type, x, y }),
      xDomainRef, yDomainRef, svgRef, redrawCanvas, redrawChart,
      drawing, setDrawing, setCurrent, drawMode, setDrawMode, locked,
      lineMode, lineStart, lines, selectedLineId,
      setLineStart, setLinePreview, setSelectedLineId,
      addLine, updateLineEndpoint, setLinePosition,
      hasPos, tpsl, scaleInOrders: position?.scaleInOrders, splitTps: tpsl?.splitTps,
      dragTpsl, setDragTpsl, saveTpsl,
      dragScaleIn, setDragScaleIn, moveScaleIn,
      dragSplitTp, setDragSplitTp, moveSplitTp,
      selectedBox, setSelectedBox,
      openConfirm, isLog,
      channelMode, channelStep, setChannelStep,
      channelPoints, setChannelPoints, channelPreview, setChannelPreview,
      channels, selectedChannelId, setSelectedChannelId,
      addChannel, updateChannelEndpoint, setChannelPosition, setChannelOffset,
      circleMode, circleCenter, setCircleCenter, circlePreview, setCirclePreview,
      circles, selectedCircleId, setSelectedCircleId,
      addCircle, moveCircle,
      overlaysRef,
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scales = useMemo(() => getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog), [renderTick, IW, IH, isLog]);

  return (
    <div ref={chartContainerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, display: "block", zIndex: 0 }} />
      {showVol && effectiveVolH > 0 && (
        <canvas ref={volCanvasRef} style={{
          position: "absolute",
          top: IH + M.top + M.bottom + VOL_GAP,
          left: 0, display: "block", zIndex: 0,
        }} />
      )}
      {showRsi && effectiveRsiH > 0 && (
        <canvas ref={rsiCanvasRef} style={{
          position: "absolute",
          top: containerH - effectiveRsiH,
          left: 0, display: "block", zIndex: 0,
        }} />
      )}
      <ChartSvg
        svgRef={svgRef}
        containerW={containerW} containerH={containerH} IW={IW} IH={IH}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave} onDoubleClick={onDoubleClick}
        onContextMenu={e => {
          e.preventDefault();
          if (lineMode) cancelDraw();
          if (channelMode) cancelChannelDraw();
          if (circleMode) cancelCircleDraw();
          if (drawMode || dragRef.current?.type === "draw") {
            setDrawMode(false); setCurrent(null); dragRef.current = null;
          }
        }}
        scales={scales} candles={candles} divData={divData}
        showRsi={showRsi} showDiv={showDiv}
        rsiH={effectiveRsiH} onDividerMouseDown={onDividerMouseDown}
        showVol={showVol} volH={effectiveVolH} onVolDividerMouseDown={onVolDividerMouseDown}
        vLineRef={vLineRef} hLineMainRef={hLineMainRef} hLineRsiRef={hLineRsiRef}
        priceTextRef={priceTextRef} bodyPctRef={bodyPctRef}
        hasPos={hasPos} position={position} tpsl={tpsl} dragTpsl={dragTpsl} tpslSaving={tpslSaving}
        scaleInOrders={position?.scaleInOrders} dragScaleIn={dragScaleIn}
        splitTps={tpsl?.splitTps} dragSplitTp={dragSplitTp}
        lines={lines} selectedLineId={selectedLineId} lineStart={lineStart} linePreview={linePreview} isLog={isLog}
        drawing={drawing} current={current} locked={locked} selectedBox={selectedBox}
        channels={channels} selectedChannelId={selectedChannelId}
        channelStep={channelStep} channelPoints={channelPoints} channelPreview={channelPreview}
        circles={circles} selectedCircleId={selectedCircleId}
        circleCenter={circleCenter} circlePreview={circlePreview}
      />
      {countdown.text && (
        <div style={{
          position: "absolute", top: M.top + 8, left: M.left + 8,
          pointerEvents: "none", zIndex: 10,
          fontSize: "20px", fontWeight: "700", color: cdColor,
          fontVariantNumeric: "tabular-nums", letterSpacing: "0.08em",
          background: "#000000cc", padding: "5px 14px", borderRadius: "5px",
          border: `1px solid ${cdColor}66`,
          transition: "color 1s, border-color 1s",
          textShadow: `0 0 10px ${cdColor}`,
        }}>
          {countdown.text}
        </div>
      )}
      {candleLoading && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: "14px", color: "#374151",
          background: "transparent", pointerEvents: "none",
        }}>
          캔들 로딩중...
        </div>
      )}
      {opacityPopup && (
        <LineOpacityPopup
          popup={opacityPopup} lines={lines}
          onChangeOpacity={setLineOpacity}
          onToggleLock={toggleLineLock}
          onToggleAlert={toggleLineAlert}
          onClose={() => setOpacityPopup(null)}
          channels={channels}
          onChangeChannelOpacity={setChannelOpacity}
          onToggleChannelLock={toggleChannelLock}
          onToggleChannelAlert={toggleChannelAlert}
          circles={circles}
          onChangeCircleOpacity={setCircleOpacity}
          onToggleCircleLock={toggleCircleLock}
          onToggleCircleAlert={toggleCircleAlert}
        />
      )}
    </div>
  );
}
