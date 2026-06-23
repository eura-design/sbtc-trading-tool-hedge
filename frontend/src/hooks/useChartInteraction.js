import { useCallback, useRef, useEffect } from "react";
import { M, RSI_GAP, VOL_GAP } from "../constants";
import { getScales, padYDomain, tsToIdx } from "../chart/scales";
import { DRAG_HANDLERS } from "../chart/dragStateMachine";
import { findHitLine } from "../utils/hitTest";
import { useStore } from "../store";
import { getCursor } from "../chart/cursorRules";
import { buildHitChain, findHitChannel, findHitCircle, snapToOHLC } from "../chart/hitDetection";

export function useChartInteraction({
  candles, IW, IH, rsiH, volH, updateCrosshair, hideCrosshair, onLineDoubleClick,
  scalesRef,
  xDomainRef, yDomainRef, svgRef, redrawCanvas, redrawChart,
  drawing, setDrawing, setCurrent, drawMode, setDrawMode, locked,
  lineMode, lineStart, lines, selectedLineId,
  setLineStart, setLinePreview, setSelectedLineId,
  addLine, updateLineEndpoint, setLinePosition,
  hasPos, hasLong, hasShort, tpsl, scaleInOrders, splitTps,
  dragTpsl, setDragTpsl, saveTpsl,
  dragScaleIn, setDragScaleIn, moveScaleIn,
  dragSplitTp, setDragSplitTp, moveSplitTp,
  selectedBox, setSelectedBox,
  isLog = false,
  // 채널
  channelMode, channelStep, setChannelStep,
  channelPoints, setChannelPoints, channelPreview, setChannelPreview,
  channels, selectedChannelId, setSelectedChannelId,
  addChannel, updateChannelEndpoint, setChannelPosition, updateChannelBothOffsets,
  // 원
  circleMode, circleCenter, setCircleCenter, circlePreview, setCirclePreview,
  circles, selectedCircleId, setSelectedCircleId,
  addCircle, moveCircle,
  // 도형 통합 인터페이스
  drawables,
  overlaysRef,
  candlesRef,
}) {
  const replacePendingOrder = useStore(s => s.replacePendingOrder);
  const updatePendingTpsl   = useStore(s => s.updatePendingTpsl);

  const dragRef           = useRef(null);
  const cursorRef         = useRef("crosshair");
  const wheelRafRef       = useRef(null);
  const wheelSyncTimerRef = useRef(null);
  const moveRafRef        = useRef(null);
  const lastMousePosRef   = useRef(null);

  const setCursor = useCallback((c) => {
    if (cursorRef.current === c) return;
    cursorRef.current = c;
    const el = svgRef.current;
    if (el) {
      const svgC = (c === "crosshair" || c === "grab") ? "none" : c;
      el.style.cursor = svgC;
    }
  }, [svgRef]);

  const getSvgPos = useCallback(e => {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left - M.left, y: e.clientY - rect.top - M.top };
  }, [svgRef]);

  const onWheel = useCallback(e => {
    e.preventDefault();
    if (!candles.length) return;

    const deltaY  = e.deltaY;
    const clientX = e.clientX;
    const clientY = e.clientY;

    if (wheelRafRef.current !== null) cancelAnimationFrame(wheelRafRef.current);

    wheelRafRef.current = requestAnimationFrame(() => {
      wheelRafRef.current = null;
      const scales = getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog);
      if (!scales) return;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pos = { x: clientX - rect.left - M.left, y: clientY - rect.top - M.top };
      if (pos.x < 0 || pos.x > IW) return;

      const factor   = deltaY < 0 ? 0.8 : 1.25;
      const mouseIdx = scales.xScale.invert(pos.x);
      const [i0, i1] = scales.xScale.domain();
      const newI0    = mouseIdx - (mouseIdx - i0) * factor;
      const newI1    = mouseIdx + (i1 - mouseIdx) * factor;

      if (newI1 - newI0 < 3) return;

      xDomainRef.current = [newI0, newI1];
      const vi0 = Math.max(0, Math.floor(newI0));
      const vi1 = Math.min(candles.length - 1, Math.ceil(newI1));
      let lo = Infinity, hi = -Infinity;
      for (let i = vi0; i <= vi1; i++) {
        const c = candles[i];
        if (c.l < lo) lo = c.l;
        if (c.h > hi) hi = c.h;
      }
      if (lo === Infinity) { lo = candles[0].l; hi = candles[0].h; }
      const zr  = (newI1 - newI0) / (candles.length - 1 || 1);
      const padFrac = Math.max(0.08, zr * 0.5);
      yDomainRef.current = padYDomain(lo, hi, padFrac, isLog);
      if (overlaysRef) overlaysRef.current._panning = true;
      redrawChart();
      clearTimeout(wheelSyncTimerRef.current);
      wheelSyncTimerRef.current = setTimeout(() => {
        if (overlaysRef) overlaysRef.current._panning = false;
        redrawChart();
      }, 150);
    });
  }, [candles, redrawChart, IW, IH, getSvgPos, isLog]);

  const onMouseDown = useCallback(e => {
    const pos = getSvgPos(e);
    if (pos.x < 0 || pos.x > IW || pos.y < 0 || pos.y > IH) return;
    if (e.button !== 0) return;

    const scales = getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog);
    if (!scales) return;
    const { xScale, yScale } = scales;

    const chain = buildHitChain({
      pos, xScale, yScale, candles,
      lineMode, lineStart, setLineStart, addLine,
      selectedLineId, lines, dragRef,
      hasPos, hasLong, hasShort, tpsl, scaleInOrders, splitTps,
      drawing, locked, drawMode, setCurrent,
      xDomainRef,
      setSelectedBox,
      isLog,
      drawables,
      channelMode, channelStep, setChannelStep,
      channelPoints, setChannelPoints, channelPreview,
      channels, selectedChannelId,
      addChannel, updateChannelEndpoint, setChannelPosition, updateChannelBothOffsets,
      circleMode, circleCenter, setCircleCenter, circlePreview,
      circles, selectedCircleId,
      addCircle, moveCircle,
    });

    for (const step of chain) {
      if (!step.when) continue;
      const result = step.handle();
      if (result !== false) return;
    }
  }, [drawing, locked, drawMode, candles, hasPos, hasLong, hasShort, tpsl, scaleInOrders, splitTps, lineMode, lineStart, selectedLineId, lines, IW, IH, getSvgPos, channelMode, channelStep, channelPoints, channelPreview, channels, selectedChannelId, addChannel, circleMode, circleCenter, circlePreview, circles, selectedCircleId, addCircle]);

  const refreshCrosshair = useCallback((clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pos  = { x: clientX - rect.left - M.left, y: clientY - rect.top - M.top };

    const effectiveVolH = volH ?? 0;
    const effectiveRsiH = rsiH ?? 0;
    const containerH = M.top + IH + M.bottom
      + (effectiveVolH > 0 ? VOL_GAP + effectiveVolH : 0)
      + (effectiveRsiH > 0 ? RSI_GAP + effectiveRsiH : 0);
    const rsiTopPos = effectiveRsiH > 0 ? containerH - effectiveRsiH - M.top : Infinity;
    const rsiBotPos = rsiTopPos + effectiveRsiH;
    const volTopPos = effectiveVolH > 0
      ? containerH - (effectiveRsiH > 0 ? effectiveRsiH + VOL_GAP : 0) - effectiveVolH - M.top
      : Infinity;
    const volBotPos = volTopPos + effectiveVolH;
    const scales = scalesRef?.current ?? getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog);
    if (pos.x >= 0 && pos.x <= IW) {
      if (pos.y >= 0 && pos.y <= IH) {
        const price = scales ? scales.yScale.invert(pos.y) : null;
        let bodyPct = null;
        if (scales && candles.length > 0 && price != null) {
          const rawIdx = scales.xScale.invert(pos.x);
          const idx    = Math.max(0, Math.min(Math.round(rawIdx), candles.length - 1));
          const actualCandles = candlesRef?.current || candles;
          const candle = actualCandles[idx];
          if (candle && candle.o !== 0) {
            const withinX = Math.abs(rawIdx - idx) < 0.5;
            const withinY = price >= candle.l && price <= candle.h;
            if (withinX && withinY) {
              const cPrice = idx === candles.length - 1 ? (useStore.getState().liveClose ?? candle.c) : candle.c;
              bodyPct = (cPrice - candle.o) / candle.o * 100;
            }
          }
        }
        updateCrosshair?.({ x: pos.x, y: pos.y, inRsi: false, IW, IH, rsiH, volH, price, bodyPct });
      } else if (effectiveVolH > 0 && pos.y >= volTopPos && pos.y <= volBotPos) {
        updateCrosshair?.({ x: pos.x, y: pos.y, inRsi: false, IW, IH, rsiH, volH, price: null, bodyPct: null });
      } else if (effectiveRsiH > 0 && pos.y >= rsiTopPos && pos.y <= rsiBotPos) {
        updateCrosshair?.({ x: pos.x, y: pos.y - rsiTopPos, inRsi: true, IW, IH, rsiH, volH });
      } else {
        hideCrosshair?.();
      }
    } else {
      hideCrosshair?.();
    }
  }, [candles, IW, IH, rsiH, volH, updateCrosshair, hideCrosshair, scalesRef, xDomainRef, yDomainRef, isLog]);

  const onMouseMove = useCallback(e => {
    const clientX = e.clientX, clientY = e.clientY;
    lastMousePosRef.current = { clientX, clientY };

    if (moveRafRef.current !== null) cancelAnimationFrame(moveRafRef.current);
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = null;

      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pos  = { x: clientX - rect.left - M.left, y: clientY - rect.top - M.top };
      const drag = dragRef.current;

      refreshCrosshair(clientX, clientY);

      const scales = scalesRef?.current ?? getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog);

      // 선 그리기 프리뷰
      if (lineMode && lineStart && scales) {
        const { xScale, yScale } = scales;
        const snapped = snapToOHLC(pos, candles, xScale, yScale);
        setLinePreview({ t: snapped.t, p: snapped.p });
      }

      // 원 그리기 프리뷰
      if (circleMode && circleCenter && scales) {
        const { xScale, yScale } = scales;
        const snapped = snapToOHLC(pos, candles, xScale, yScale);
        setCirclePreview({ t: snapped.t, p: snapped.p });
      }

      // 채널 그리기 프리뷰
      if (channelMode && scales) {
        const { xScale, yScale } = scales;
        if (channelStep === 1 && channelPoints) {
          const snapped = snapToOHLC(pos, candles, xScale, yScale);
          setChannelPreview({ t: snapped.t, p: snapped.p });
        } else if (channelStep === 2 && channelPoints) {
          const { t1, p1, t2, p2 } = channelPoints;
          const i1 = tsToIdx(t1, candles), i2 = tsToIdx(t2, candles);
          const mouseIdx = xScale.invert(pos.x);
          const alpha = (i2 - i1) !== 0 ? (mouseIdx - i1) / (i2 - i1) : 0;
          // log 모드: 지수 보간으로 메인라인 가격 계산, offset을 ratio로 저장
          const mousePrice = yScale.invert(pos.y);
          if (isLog && p1 > 0 && p2 > 0) {
            const mainLinePrice = p1 * Math.pow(p2 / p1, alpha);
            setChannelPreview({ offset: mainLinePrice > 0 ? mousePrice / mainLinePrice : 1 });
          } else {
            const mainLinePrice = p1 + (p2 - p1) * alpha;
            setChannelPreview({ offset: mousePrice - mainLinePrice });
          }
        }
      }

      // 드래그 없음 → 커서 결정
      if (!drag) {
        if (scales) {
          const { xScale, yScale } = scales;
          const cursor = getCursor({ selectedLineId, lines, pos, xScale, yScale, candles, hasPos, tpsl, drawing, scaleInOrders, splitTps, selectedChannelId, channels, selectedCircleId, circles, isLog });
          if (cursor) { setCursor(cursor); return; }
        }
        setCursor((drawMode || lineMode || channelMode || circleMode) ? "crosshair" : "grab"); return;
      }

      // 드래그 핸들러 위임
      const handler = DRAG_HANDLERS[drag.type];
      if (!handler) return;

      const setters = {
        setDrawing, setCurrent, setDragTpsl, setCursor, xDomainRef, yDomainRef,
        redrawCanvas, redrawChart, setDragScaleIn, moveScaleIn, setDragSplitTp, moveSplitTp,
        isLog, updateChannelEndpoint, setChannelPosition, updateChannelBothOffsets,
        moveCircle, updateLineEndpoint, setLinePosition, overlaysRef,
      };
      const state = { drawing, dragTpsl, dragScaleIn, dragSplitTp };

      if (drag.type === "pan") {
        const rect2 = svgRef.current?.getBoundingClientRect();
        if (!rect2) return;
        const panPos = { x: clientX - rect2.left - M.left, y: clientY - rect2.top - M.top };
        handler.onMove({ pos: panPos, drag: dragRef.current ?? drag, scales: null, IW, IH, candles, setters, state });
        return;
      }

      handler.onMove({ pos, drag, scales, IW, IH, candles, setters, state });
    });
  }, [drawing, drawMode, candles, dragTpsl, dragSplitTp, redrawCanvas, redrawChart, lineMode, lineStart, selectedLineId, lines, hasPos, tpsl, scaleInOrders, splitTps, IW, IH, channelMode, channelStep, channelPoints, selectedChannelId, channels, circleMode, circleCenter, selectedCircleId, circles, refreshCrosshair, isLog]);

  const onMouseUp = useCallback(e => {
    const drag = dragRef.current;
    dragRef.current = null;
    setCursor("crosshair");
    if (!drag) { setCurrent(null); return; }

    const scales  = getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog);
    const handler = DRAG_HANDLERS[drag.type];
    if (!handler) { setCurrent(null); return; }

    handler.onUp({
      pos: getSvgPos(e), drag, scales, candles, IW, IH,
      setters: {
        setDrawing, setCurrent, setDragTpsl, setCursor, saveTpsl, setDrawMode,
        setDragScaleIn, moveScaleIn, setDragSplitTp, moveSplitTp,
        setSelectedBox, replacePendingOrder, updatePendingTpsl, redrawChart,
        updateChannelEndpoint, setChannelPosition, updateChannelBothOffsets,
        moveCircle, updateLineEndpoint, setLinePosition, overlaysRef,
      },
      state: { drawing, dragTpsl, dragScaleIn, dragSplitTp },
    });
  }, [candles, drawing, dragTpsl, dragSplitTp, dragScaleIn, saveTpsl, moveSplitTp, moveScaleIn, redrawChart, IW, IH, getSvgPos]);

  const onDoubleClick = useCallback(e => {
    const pos    = getSvgPos(e);
    const scales = getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog);
    if (!scales) return;
    const { xScale, yScale } = scales;

    const hit = findHitLine(pos.x, pos.y, lines, xScale, yScale, candles, 8, isLog);
    if (hit) { onLineDoubleClick?.(hit.id, "line", e.clientX, e.clientY); return; }

    const hitCh = findHitChannel(pos.x, pos.y, channels ?? [], xScale, yScale, candles, 8, isLog);
    if (hitCh) { onLineDoubleClick?.(hitCh.id, "channel", e.clientX, e.clientY); return; }

    const hitCi = findHitCircle(pos.x, pos.y, circles ?? [], xScale, yScale, candles);
    if (hitCi) { onLineDoubleClick?.(hitCi.id, "circle", e.clientX, e.clientY); return; }
  }, [candles, lines, channels, circles, drawing, locked, IW, IH, getSvgPos, onLineDoubleClick]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMouseLeave = useCallback(() => {
    dragRef.current = null;
    setCurrent(null);
    setCursor("crosshair");
    hideCrosshair?.();
  }, [setCurrent, hideCrosshair]);

  // wheel 이벤트는 React prop으로 등록하면 passive가 되어 preventDefault()가 무시됨
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef, onWheel]);

  // isLog 토글 시 진행 중인 wheel RAF/타이머가 옛 yDomain 계산을 마저 적용하지 않도록 즉시 정리
  useEffect(() => {
    if (wheelRafRef.current !== null) {
      cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = null;
    }
    if (wheelSyncTimerRef.current) {
      clearTimeout(wheelSyncTimerRef.current);
      wheelSyncTimerRef.current = null;
      if (overlaysRef) overlaysRef.current._panning = false;
    }
  }, [isLog]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateCrosshairOnTick = useCallback(() => {
    if (lastMousePosRef.current) {
      refreshCrosshair(lastMousePosRef.current.clientX, lastMousePosRef.current.clientY);
    }
  }, [refreshCrosshair]);

  return { dragRef, getSvgPos, onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onDoubleClick, updateCrosshairOnTick };
}
