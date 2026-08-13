import { useRef, useMemo, useEffect, useState } from "react";
import { M, RSI_GAP, VOL_GAP, TF_MS } from "../constants";
import { useStore }          from "../store";
import { useShallow }        from "zustand/react/shallow";
import { useChartSize }      from "../hooks/useChartSize";
import { useRsiResize }      from "../hooks/useRsiResize";
import { useVolResize }      from "../hooks/useVolResize";
import { useCrosshair }      from "../hooks/useCrosshair";
import { useChartRenderer }  from "../hooks/useChartRenderer";
import { useChartInteraction } from "../hooks/useChartInteraction";
import { useOrderFlow }      from "../hooks/useOrderFlow";
import { derivePositionFlags } from "../hooks/usePositionFlags";
import { getScales }         from "../chart/scales";
import { ChartSvg }          from "./Chart/ChartSvg";
import { LineOpacityPopup }  from "./Chart/LineOpacityPopup";

// 봉마감 카운트다운 — TF_MS(constants.js)에서 봉 간격 참조

// 달봉: 다음 달 1일 00:00 UTC까지 남은 ms 반환 (실제 월말 기준)
function msUntilMonthEnd() {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return nextMonth.getTime() - now.getTime();
}
// 현재 달의 총 ms (주기 비율 계산용)
function msDurationOfCurrentMonth() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return end.getTime() - start.getTime();
}
function fmtCountdown(ms) {
  if (ms <= 0) return "00:00";
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

export function ChartArea({
  // 캔들 데이터
  candles, candlesRef, candleLoading, onTickRef, interval_, isDark, isLog,
  // 오버레이 데이터
  rsiData, emaData, fvgData, obData, pivotLevels,
  // 지표 표시 여부
  showRsi, showPivot, showOB, showFVG, showVol, showEMA, showZZ, showStruct, zzSelected,
  // 지표 파라미터
  indicatorParams,
  // 드로잉 상태 (useTrendLines)
  lines, lineMode, lineStart, setLineStart, linePreview, setLinePreview,
  selectedLineId, setSelectedLineId,
  addLine, updateLineEndpoint, setLinePosition,
  setLineOpacity, toggleLineLock, toggleLineAlert, setLineAlertOff,
  channels, channelMode, channelStep, setChannelStep,
  channelPoints, setChannelPoints, channelPreview, setChannelPreview,
  selectedChannelId, setSelectedChannelId,
  addChannel, updateChannelEndpoint, setChannelPosition, updateChannelBothOffsets,
  setChannelOpacity, toggleChannelLock, toggleChannelAlert, setChannelAlertOff,
  circles, circleMode, circleCenter, setCircleCenter, circlePreview, setCirclePreview,
  selectedCircleId, setSelectedCircleId,
  addCircle, moveCircle,
  setCircleOpacity, toggleCircleLock, toggleCircleAlert, setCircleAlertOff,
  cancelDraw, cancelChannelDraw, cancelCircleDraw,
  // 수동 구조 (useStructures)
  structures, structMode, structDraft, structPreview, setStructPreview,
  selectedStructId, setSelectedStructId,
  cancelStructDraw, addStructDraftPoint, startExtendStruct, mergeStructIntoDraft, finishStruct,
  moveStructPoint, normalizeStruct,
  structPart, selectStructPart, clearStructPart,   // 꼭짓점/선분 부분 선택 (Delete 대상)
  // 도형 통합 인터페이스 (App.jsx에서 구성)
  drawables,
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

  // 헷지모드: 양쪽 모두 점유(포지션 or pending)됐을 때만 신규 박스 드로잉 차단
  const { hasLong, hasShort, hasPos, drawLocked } = derivePositionFlags(position);
  const locked = drawLocked;

  // 수동 구조 표시 OFF면 렌더뿐 아니라 히트 판정에서도 빼야 한다.
  // 안 그러면 안 보이는 구조가 클릭에 잡혀 선택·드래그된다.
  const visibleStructures = showStruct ? structures : [];

  // ── 봉마감 카운트다운 ──────────────────────────────────────────────────────
  const [countdown, setCountdown] = useState({ text: "", ratio: 1 });
  const last = candles.length > 0 ? candles[candles.length - 1] : null;

  useEffect(() => {
    let prevText = "";
    const tick = () => {
      const now = Date.now();
      let remaining, ratio;

      if (interval_ === '1M') {
        // 달봉: 실제 월말(다음 달 1일 00:00 UTC) 기준
        remaining = msUntilMonthEnd();
        ratio     = remaining / msDurationOfCurrentMonth();
      } else {
        const iMs      = TF_MS[interval_] ?? 60 * 60 * 1000;
        const arr      = candlesRef.current; // React state가 아닌 항상 최신 ref 사용
        const lastCdl  = arr.length > 0 ? arr[arr.length - 1] : null;

        if (lastCdl) {
          const r = lastCdl.t.getTime() + iMs - now;
          // 결과가 유효 범위(0 < r ≤ iMs)일 때만 사용
          // 타임프레임 전환 직후 stale candle이 섞이면 범위를 벗어남 → 폴백
          if (r > 0 && r <= iMs) {
            remaining = r;
            ratio     = r / iMs;
          }
        }

        // epoch 기반 폴백 (캔들 미로드 or 범위 검증 실패 시)
        // 5m·15m·1h·4h·1d 는 모두 UTC 자정 기준으로 정확히 나뉨
        // 1w 는 epoch(목요일)에서 월요일까지 4일 보정
        if (remaining === undefined) {
          if (interval_ === '1w') {
            const elapsed = ((now - 4 * 86400000) % iMs + iMs) % iMs; // 음수 모듈로 방지
            remaining = iMs - elapsed;
          } else {
            remaining = iMs - (now % iMs);
          }
          ratio = remaining / iMs;
        }
      }

      const text = fmtCountdown(remaining);
      if (text !== prevText) {
        prevText = text;
        setCountdown({ text, ratio });
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [interval_]); // eslint-disable-line react-hooks/exhaustive-deps


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

  // ── 오버레이 ref (틱마다 React 상태 없이 최신값 반영) ─────────────────────
  const overlaysRef = useRef({});
  overlaysRef.current = {
    fvgData, showFVG, obData, showOB, pivotLevels, showPivot, emaData, showEMA,
    showZZ, zzParams: indicatorParams.zz, zzSelected,   // ZZ는 candleRenderer가 라이브 캔들로 직접 계산
    showVol, volH: effectiveVolH, volColorMode: indicatorParams.vol?.colorMode ?? "neutral",
    rsiData, showRsi, rsiH: effectiveRsiH, rsiParams: indicatorParams.rsi,
  };

  // ── 캔버스 렌더러 ──────────────────────────────────────────────────────────
  const { xDomainRef, yDomainRef, scalesRef, redrawCanvas, redrawChart, redrawVolume, redrawVolumeTick, redrawRSI, renderTick, resetDomain } =
    useChartRenderer({ candles, candlesRef, interval_, isDark, IW, IH, canvasRef, volCanvasRef, rsiCanvasRef, isLog, overlaysRef });

  // onTickRef에 redrawCanvas 연결 — 하단에서 updateCrosshairOnTick와 함께 체이닝하여 설정됨
  // actionsRef에 resetDomain 노출 — App.jsx에서 interval 변경 시 호출
  if (actionsRef) actionsRef.current = {
    resetDomain,
    canvasRef, volCanvasRef, rsiCanvasRef,
    containerRef: chartContainerRef, scalesRef,
  };

  // ── 오버레이 변경 시 캔버스 재렌더 ────────────────────────────────────────
  // candles.length 가드: 타임프레임 전환 중 candles=[] 상태에서 forceUpdate가 불려
  // scales=null이 되면 SVG 오버레이가 순간 사라지는 들썩임이 발생하므로 방지
  useEffect(() => { if (candles.length) redrawChart(); }, [fvgData, obData, pivotLevels, showFVG, showOB, showPivot, showEMA, emaData, showZZ, indicatorParams.zz, zzSelected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { redrawVolume(); }, [showVol, effectiveVolH, indicatorParams.vol?.colorMode]); // eslint-disable-line react-hooks/exhaustive-deps
  // RSI는 패널뿐 아니라 **메인 캔버스**에도 그려진다 (과매수/과매도 구간 배경) →
  // 데이터·파라미터가 바뀌면 두 캔버스를 같이 갱신해야 밴드가 즉시 따라온다.
  // redrawChart가 아니라 redrawCanvas인 이유: SVG 오버레이는 RSI와 무관해 리렌더가 불필요
  useEffect(() => {
    if (!candles.length) return;
    redrawRSI();
    redrawCanvas();
  }, [rsiData, showRsi, effectiveRsiH, indicatorParams.rsi]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 주문 액션 ─────────────────────────────────────────────────────────────
  const { saveTpsl, moveScaleIn, moveSplitTp } = useOrderFlow();

  const splitTps = [...(tpsl?.long?.splitTps ?? []), ...(tpsl?.short?.splitTps ?? [])];

  // ── 크로스헤어 ────────────────────────────────────────────────────────────
  const { vLineRef, hLineMainRef, hLineRsiRef, priceTextRef, bodyPctRef, legRefs,
          updateCrosshair, hideCrosshair, showLegPct } = useCrosshair();

  // ── 차트 인터랙션 ─────────────────────────────────────────────────────────
  const { dragRef, onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onDoubleClick, updateCrosshairOnTick } =
    useChartInteraction({
      candles, candlesRef, IW, IH, rsiH: effectiveRsiH, volH: effectiveVolH,
      updateCrosshair, hideCrosshair, showLegPct, showZZ,
      zzShowVol: indicatorParams.zz?.show_legvol !== false,
      scalesRef,
      onLineDoubleClick: (id, type, x, y) => setOpacityPopup({ id, type, x, y }),
      xDomainRef, yDomainRef, svgRef, redrawCanvas, redrawChart,
      drawing, setDrawing, setCurrent, drawMode, setDrawMode, locked,
      lineMode, lineStart, lines, selectedLineId,
      setLineStart, setLinePreview, setSelectedLineId,
      addLine, updateLineEndpoint, setLinePosition,
      hasPos, hasLong, hasShort, tpsl, scaleInOrders: position?.scaleInOrders, splitTps,
      dragTpsl, setDragTpsl, saveTpsl,
      dragScaleIn, setDragScaleIn, moveScaleIn,
      dragSplitTp, setDragSplitTp, moveSplitTp,
      selectedBox, setSelectedBox,
      isLog,
      channelMode, channelStep, setChannelStep,
      channelPoints, setChannelPoints, channelPreview, setChannelPreview,
      channels, selectedChannelId, setSelectedChannelId,
      addChannel, updateChannelEndpoint, setChannelPosition, updateChannelBothOffsets,
      circleMode, circleCenter, setCircleCenter, circlePreview, setCirclePreview,
      circles, selectedCircleId, setSelectedCircleId,
      addCircle, moveCircle,
      structMode, structDraft, structPreview, setStructPreview,
      structures: visibleStructures, selectedStructId, setSelectedStructId,
      addStructDraftPoint, startExtendStruct, mergeStructIntoDraft, finishStruct,
      moveStructPoint, normalizeStruct, structPart, selectStructPart, clearStructPart,
      drawables,
      overlaysRef,
    });

  // onTickRef에 redrawCanvas 및 크로스헤어 업데이트 연결 — WebSocket 틱마다 React 상태 없이 갱신
  // redrawVolumeTick은 redrawCanvas 다음에 — scalesRef가 이번 틱 값으로 갱신된 뒤 써야 한다
  onTickRef.current = () => {
    redrawCanvas();
    redrawVolumeTick();
    updateCrosshairOnTick();
  };

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
          // 구조는 꼭짓점 개수가 정해져 있지 않으므로 우클릭이 "여기까지" 확정 신호다
          // (선/채널/원은 점 개수가 고정이라 우클릭이 취소)
          if (structMode) { finishStruct(); return; }
          if (lineMode) cancelDraw();
          if (channelMode) cancelChannelDraw();
          if (circleMode) cancelCircleDraw();
          if (drawMode || dragRef.current?.type === "draw") {
            setDrawMode(false); setCurrent(null); dragRef.current = null;
          }
        }}
        scales={scales} candles={candles} candlesRef={candlesRef}
        showRsi={showRsi}
        rsiH={effectiveRsiH} onDividerMouseDown={onDividerMouseDown}
        showVol={showVol} volH={effectiveVolH} onVolDividerMouseDown={onVolDividerMouseDown}
        vLineRef={vLineRef} hLineMainRef={hLineMainRef} hLineRsiRef={hLineRsiRef}
        priceTextRef={priceTextRef} bodyPctRef={bodyPctRef} legRefs={legRefs}
        hasPos={hasPos} hasLong={hasLong} hasShort={hasShort} position={position} tpsl={tpsl} dragTpsl={dragTpsl} tpslSaving={tpslSaving}
        scaleInOrders={position?.scaleInOrders} dragScaleIn={dragScaleIn}
        splitTps={splitTps} dragSplitTp={dragSplitTp}
        lines={lines} selectedLineId={selectedLineId} lineStart={lineStart} linePreview={linePreview} isLog={isLog}
        drawing={drawing} current={current} locked={locked} selectedBox={selectedBox}
        channels={channels} selectedChannelId={selectedChannelId}
        channelStep={channelStep} channelPoints={channelPoints} channelPreview={channelPreview}
        circles={circles} selectedCircleId={selectedCircleId}
        circleCenter={circleCenter} circlePreview={circlePreview}
        structures={visibleStructures} selectedStructId={selectedStructId} structPart={structPart}
        structDraft={showStruct ? structDraft : null}
        structPreview={showStruct ? structPreview : null}
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
          popup={opacityPopup} drawables={drawables}
          onClose={() => setOpacityPopup(null)}
        />
      )}
    </div>
  );
}
