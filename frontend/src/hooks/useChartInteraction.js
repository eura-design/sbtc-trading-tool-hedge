import { useCallback, useRef, useEffect } from "react";
import { M, RSI_GAP, VOL_GAP } from "../constants";
import { getScales, fitYDomain, tsToIdx } from "../chart/scales";
import { idxToTimestamp } from "../utils/coordUtils";
import { DRAG_HANDLERS } from "../chart/dragStateMachine";
import { findHitLine } from "../utils/hitTest";
import { useStore } from "../store";
import { getCursor } from "../chart/cursorRules";
import { buildHitChain, findHitChannel, findHitCircle, findHitFib, findHitMeasure, findHitStructure, findHitZzLeg, findHoveredLeg, snapToOHLC, snapToStructurePoint } from "../chart/hitDetection";
import { legPeakVolume, fmtVol, volChangePct, LEG_VOL_METRICS } from "../chart/legVolume";
import { getZzSegments } from "../chart/structureZigzag";
import { getStructAutoChains } from "../chart/structRenderState";
import { ZZ_ID } from "../chart/drawables";

// 축소 하한 — "가진 캔들을 전부 펼친 데서 멈춘다".
// 7/6은 initialXDomain이 쓰는 오른쪽 여백(폭의 1/6)과 같은 비율이라,
// 하한 = 처음 화면과 같은 여백을 두고 전 구간이 보이는 지점이 된다.
//
// ⚠ **화면 px이 아니라 봉 개수에 묶는다.** px으로 걸면(예: 봉당 0.5px 이상)
//   봉이 적은 TF에서는 사실상 하한이 없어진다 — 화면 폭은 TF가 바뀌어도 그대로인데
//   로드되는 봉은 5분봉 3000개 / 주봉 365개 / 월봉 84개로 36배까지 차이 나기 때문이다.
//   실제로 px 기준이던 동안 월봉은 캔들이 화면의 2.7%(42px)가 될 때까지 축소됐다.
//   지금은 어느 TF에서든 캔들이 화면의 85.7%를 채운 지점에서 멈춘다
// (확대 하한은 아래 wheel 핸들러의 "3봉" 조건이 맡는다 — 둘이 한 쌍이다)
const MAX_VIEW_RATIO = 7 / 6;

export function useChartInteraction({
  candles, IW, IH, rsiH, volH, updateCrosshair, hideCrosshair, showLegPct, onLineDoubleClick,
  scalesRef,
  xDomainRef, yDomainRef, svgRef, redrawCanvas, redrawChart,
  drawings, setDrawing, setCurrent, drawMode, setDrawMode, locked,
  lineMode, lineStart, lines, selectedLineId,
  setLineStart, setLinePreview, setSelectedLineId,
  addLine, updateLineEndpoint, setLinePosition,
  hasPos, hasLong, hasShort, tpsl, scaleInOrders, splitTps, partialSls,
  position, // 진입선의 `+TP`/`+SL` 버튼 좌표를 잡는 데 필요 (hitDetection.posTpSlButtons)
  onMarkerClose, // 마커 옆 × 클릭 처리 (ChartArea)
  dragTpsl, setDragTpsl, saveTpsl,
  dragScaleIn, setDragScaleIn, moveScaleIn,
  dragSplitTp, setDragSplitTp, moveSplitTp,
  dragPartialSl, setDragPartialSl, movePartialSl,
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
  // 피보나치 되돌림 — 표시할 레벨은 **도형별**이라 여기서 넘기지 않는다.
  // 렌더(Fibs.jsx)와 히트(findHitFib)가 각각 fibLevelsOf(fb)로 읽는다 (chart/fib.js [F1])
  fibMode, fibStart, setFibStart, fibPreview, setFibPreview,
  fibs, selectedFibId, setSelectedFibId,
  addFib, updateFibEndpoint, setFibPosition,
  // 측정 박스 — 드래그로 그린다. 그리는 중 상태(measureDraft)는 DRAG_HANDLERS가 갱신하고
  // **화면에 그리는 건 ChartArea → Measures**라, 이 훅은 setter만 들면 된다
  measureMode, setMeasureDraft,
  measures, selectedMeasureId,
  addMeasure, moveMeasureCorner, setMeasurePosition,
  // 차트에서 분할 주문 걸기 (2026-08-27) — 켜져 있으면 히트 체인 맨 앞에서 가로챈다.
  // 그리는 중 상태(pickDraft)는 DRAG_HANDLERS가 갱신하고 화면에 그리는 건 ChartArea다
  orderPick, setOrderPick, setPickDraft, placeSplitOrders,
  // 수동 구조
  structMode, structDraft, structPreview, setStructPreview,
  structures, selectedStructId, setSelectedStructId,
  addStructDraftPoint, startExtendStruct, mergeStructIntoDraft, finishStruct,
  moveStructPoint, normalizeStruct, structPart, selectStructPart, clearStructPart,
  commitStructPoints,   // 자동 이어그리기의 점을 클릭해 꼭짓점으로 확정
  // 레그 등락률 hover 표시 — 자동 ZZ는 모듈 상태에서 읽으므로 on/off 여부만 받는다
  showZZ = false,
  // 자동 ZZ의 `거래량 비교` (indicatorParams.zz.show_legvol) — 2026-08-24 되살림.
  // 수동 구조는 구조마다 값을 들고 있지만 자동 ZZ는 지표라 값이 하나다
  zzShowVol = true,
  // 도형 통합 인터페이스
  drawables,
  overlaysRef,
  candlesRef,
}) {
  const replacePendingOrder = useStore(s => s.replacePendingOrder);
  const updatePendingTpsl   = useStore(s => s.updatePendingTpsl);
  // 주문이 걸린 박스 위에 새로 그리려 할 때 이유를 알려 준다 (dragStateMachine의 draw.onUp)
  const setOrderStatus      = useStore(s => s.setOrderStatus);

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

      if (newI1 - newI0 < 3) return;                     // 확대 하한 — 3봉
      if (newI1 - newI0 > candles.length * MAX_VIEW_RATIO) return;  // 축소 하한 — 전 구간

      xDomainRef.current = [newI0, newI1];
      yDomainRef.current = fitYDomain(candles, xDomainRef.current, isLog);
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
      hasPos, hasLong, hasShort, tpsl, scaleInOrders, splitTps, partialSls,
      position, IH, IW, onMarkerClose,
      drawings, selectedBox, locked, drawMode, setCurrent,
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
      fibMode, fibStart, setFibStart, fibPreview,
      fibs, selectedFibId, addFib,
      measureMode, setMeasureDraft,
      orderPick,
      measures, selectedMeasureId,
      structMode, structDraft, addStructDraftPoint, startExtendStruct, mergeStructIntoDraft,
      structures, selectedStructId, structPart, selectStructPart,
      structAutoChains: getStructAutoChains(), commitStructPoints,
      showZZ, zzSegments: showZZ ? getZzSegments() : null,
    });

    for (const step of chain) {
      if (!step.when) continue;
      const result = step.handle();
      if (result !== false) return;
    }
  }, [drawings, selectedBox, locked, drawMode, candles, hasPos, hasLong, hasShort, tpsl, position, onMarkerClose, scaleInOrders, splitTps, partialSls, lineMode, lineStart, selectedLineId, lines, IW, IH, getSvgPos, channelMode, channelStep, channelPoints, channelPreview, channels, selectedChannelId, addChannel, circleMode, circleCenter, circlePreview, circles, selectedCircleId, addCircle, fibMode, fibStart, fibs, selectedFibId, addFib, measureMode, measures, selectedMeasureId, structMode, structDraft, structures, selectedStructId, addStructDraftPoint, startExtendStruct, mergeStructIntoDraft, structPart, selectStructPart, commitStructPoints, showZZ, orderPick]);

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
    // 커서가 가리키는 시각 — 날짜축 태그에 쓴다 (useCrosshair).
    // X축 눈금과 **같은 함수**(idxToTimestamp)로 구한다. 마지막 봉 오른쪽(미래 영역)은
    // 봉 간격으로 외삽되므로 눈금이 없는 자리에서도 값이 나온다
    const ts = scales && candles.length
      ? idxToTimestamp(scales.xScale.invert(pos.x), candles)
      : null;
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
        updateCrosshair?.({ x: pos.x, y: pos.y, inRsi: false, IW, IH, rsiH, volH, price, ts, bodyPct });
      } else if (effectiveVolH > 0 && pos.y >= volTopPos && pos.y <= volBotPos) {
        updateCrosshair?.({ x: pos.x, y: pos.y, inRsi: false, IW, IH, rsiH, volH, price: null, ts, bodyPct: null });
      } else if (effectiveRsiH > 0 && pos.y >= rsiTopPos && pos.y <= rsiBotPos) {
        updateCrosshair?.({ x: pos.x, y: pos.y - rsiTopPos, inRsi: true, IW, IH, rsiH, volH, ts });
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

      // 피보나치 그리기 프리뷰 (원과 같은 2클릭 — 첫 점 찍은 뒤부터 레벨이 따라온다)
      if (fibMode && fibStart && scales) {
        const { xScale, yScale } = scales;
        const snapped = snapToOHLC(pos, candles, xScale, yScale);
        setFibPreview({ t: snapped.t, p: snapped.p });
      }

      // 구조 그리기 프리뷰 — 다음 꼭짓점 타입은 직전 점의 반대
      if (structMode && scales) {
        const lastPt = structDraft?.points?.[structDraft.points.length - 1];
        const snapped = snapToStructurePoint(
          pos, candles, scales.xScale, scales.yScale,
          lastPt ? (lastPt.type === "H" ? "L" : "H") : null,
        );
        if (snapped) setStructPreview(snapped);
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

      // 지그재그 레그 hover 라벨 (등락률 + 거래량 + 직전 동일방향 레그 대비).
      // 드래그·그리기 중에는 방해되므로 끈다.
      // 커서 위치만 쓰는 imperative 라벨이라 React 상태를 건드리지 않는다.
      if (scales && !drag && !structMode && !drawMode && !measureMode && !orderPick && pos.y >= 0 && pos.y <= IH) {
        const leg = findHoveredLeg({
          px: pos.x, py: pos.y,
          structures,
          zzSegments: showZZ ? getZzSegments() : null,
          xScale: scales.xScale, yScale: scales.yScale, candles, zzShowVol,
        });
        // 거래량은 **candlesRef**로 — React candles는 봉마감 때만 갱신돼서
        // 진행 중 레그의 마지막 봉 거래량이 낡아 있다 (구조 지표와 같은 함정)
        const src     = candlesRef?.current?.length ? candlesRef.current : candles;
        const wantVol = leg != null && leg.showVol !== false;   // 구조별 `거래량 비교` 토글
        const cur = wantVol ? legPeakVolume(src, leg.i1, leg.i2) : null;
        const prv = wantVol && leg.prev ? legPeakVolume(src, leg.prev.i1, leg.prev.i2) : null;
        // 각각 **같은 쪽끼리** 비교한다 (매수↔매수, 매도↔매도).
        // 섞으면 "이번 상승의 양봉 값이 직전 상승의 음봉 값보다 크다" 같은
        // 의미 없는 값이 나온다.
        // 지표(상위3/평균/총량)도 **같은 지표끼리만** 비교한다 — 총량과 평균을
        // 맞대면 "여러 봉 합이 봉당 평균보다 크다"는 당연한 말밖에 안 나온다
        const side = (c, p, key) => c == null ? null
          : { vol: fmtVol(c[key]), delta: p == null ? null : volChangePct(c[key], p[key]) };

        // [LV6] **레그 방향에 해당하는 쪽만 보여준다** (사용자 요청):
        //   상승 레그 → ▲(양봉 거래량)만 / 하락 레그 → ▼(음봉 거래량)만
        // 지금 보고 있는 선이 상승인데 하락 쪽 숫자까지 깔면 읽을 게 두 배가 된다.
        // 비교도 어차피 "직전 동일방향 레그의 같은 쪽"이라 반대쪽은 비교선이 없다.
        // ※ 잃는 것: 상승 레그 안의 최대 되돌림 봉(▼)이 안 보인다.
        //   실제로 "올랐지만 가장 큰 한 방은 매도였던" 레그가 있었다 — 되살릴 거면
        //   양쪽을 다 켜지 말고 "반대쪽이 더 클 때만" 같은 조건부로 할 것.
        // ※ 테이커(체결 주체) 기준 줄은 2026-08-13 제거 — legVolume.js [LV5]
        const isUp = (leg?.pct ?? 0) >= 0;

        // [LV9] 세 줄 — 상위3봉 평균 / 봉당 평균 / 총량 (전부 그 방향 봉만).
        // 판정이 갈리는 게 정보다 (총량만 레그 길이에 휘둘린다 — 상관계수 0.29 vs 평균 0.00)
        // ※ 구조별 `거래량 비교` OFF면 세 줄만 빼고 **등락률은 그대로 띄운다**
        //   (전부 사라지면 hover가 죽은 것처럼 보인다 — 더블클릭 팝업의 토글)
        const rows = {};
        if (leg?.showVol !== false) {
          for (const { key } of LEG_VOL_METRICS) {
            rows[key] = isUp
              ? { up: side(cur?.up, prv?.up, key) }   // 캔들 색 기준 (양봉 쪽)
              : { dn: side(cur?.dn, prv?.dn, key) };  //              (음봉 쪽)
          }
        }

        // IH는 라벨(3줄)이 패널 아래로 넘칠 때 커서 위로 뒤집는 데 쓴다
        showLegPct?.({ x: pos.x, y: pos.y, IH, pct: leg?.pct ?? null, rows });
      } else {
        showLegPct?.({ pct: null });
      }

      // 드래그 없음 → 커서 결정
      if (!drag) {
        if (scales) {
          const { xScale, yScale } = scales;
          const cursor = getCursor({ selectedLineId, lines, pos, xScale, yScale, candles, hasPos, tpsl, drawings, scaleInOrders, splitTps, partialSls, selectedChannelId, channels, selectedCircleId, circles, selectedFibId, fibs, selectedMeasureId, measures, selectedStructId, structures, structMode, structDraft,
            structAutoChains: getStructAutoChains(), isLog });
          if (cursor) { setCursor(cursor); return; }
        }
        setCursor((orderPick || drawMode || lineMode || channelMode || circleMode || fibMode || measureMode || structMode) ? "crosshair" : "grab"); return;
      }

      // 드래그 핸들러 위임
      const handler = DRAG_HANDLERS[drag.type];
      if (!handler) return;

      const setters = {
        setDrawing, setCurrent, setDragTpsl, setCursor, xDomainRef, yDomainRef,
        redrawCanvas, redrawChart, setDragScaleIn, moveScaleIn, setDragSplitTp, moveSplitTp,
        setDragPartialSl, movePartialSl,
        isLog, updateChannelEndpoint, setChannelPosition, updateChannelBothOffsets,
        moveCircle, updateLineEndpoint, setLinePosition, overlaysRef,
        updateFibEndpoint, setFibPosition,
        setMeasureDraft, addMeasure, moveMeasureCorner, setMeasurePosition,
        setPickDraft, placeSplitOrders, setOrderPick,
        moveStructPoint, normalizeStruct,
      };
      const state = { drawings, dragTpsl, dragScaleIn, dragSplitTp, dragPartialSl, orderPick };

      if (drag.type === "pan") {
        const rect2 = svgRef.current?.getBoundingClientRect();
        if (!rect2) return;
        const panPos = { x: clientX - rect2.left - M.left, y: clientY - rect2.top - M.top };
        handler.onMove({ pos: panPos, drag: dragRef.current ?? drag, scales: null, IW, IH, candles, setters, state });
        return;
      }

      handler.onMove({ pos, drag, scales, IW, IH, candles, setters, state });
    });
  }, [drawings, drawMode, candles, dragTpsl, dragSplitTp, dragPartialSl, redrawCanvas, redrawChart, lineMode, lineStart, selectedLineId, lines, hasPos, tpsl, scaleInOrders, splitTps, partialSls, IW, IH, channelMode, channelStep, channelPoints, selectedChannelId, channels, circleMode, circleCenter, selectedCircleId, circles, fibMode, fibStart, selectedFibId, fibs, measureMode, selectedMeasureId, measures, structMode, structDraft, selectedStructId, structures, refreshCrosshair, isLog, showLegPct, showZZ, zzShowVol]);

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
        setDragPartialSl, movePartialSl,
        setSelectedBox, replacePendingOrder, updatePendingTpsl, redrawChart, setOrderStatus,
        updateChannelEndpoint, setChannelPosition, updateChannelBothOffsets,
        moveCircle, updateLineEndpoint, setLinePosition, overlaysRef,
        updateFibEndpoint, setFibPosition,
        setMeasureDraft, addMeasure, moveMeasureCorner, setMeasurePosition,
        setPickDraft, placeSplitOrders, setOrderPick,
        moveStructPoint, normalizeStruct, clearStructPart,
      },
      // position은 `draw.onUp`이 **같은 사이드 포지션 보유 시 박스 그리기를 막는 데** 쓴다
      state: { drawings, dragTpsl, dragScaleIn, dragSplitTp, dragPartialSl, position, orderPick },
    });
  }, [candles, drawings, dragTpsl, dragSplitTp, dragPartialSl, dragScaleIn, position, orderPick, placeSplitOrders, saveTpsl, moveSplitTp, movePartialSl, moveScaleIn, redrawChart, IW, IH, getSvgPos, moveStructPoint, normalizeStruct, clearStructPart]);

  const onDoubleClick = useCallback(e => {
    const pos    = getSvgPos(e);
    const scales = getScales(candles, xDomainRef, yDomainRef, IW, IH, isLog);
    if (!scales) return;
    const { xScale, yScale } = scales;

    // 구조 그리는 중 더블클릭 = 확정.
    // 더블클릭은 mousedown이 2번 들어와 같은 봉에 점이 하나 더 찍히므로 마지막을 버린다.
    if (structMode) { finishStruct({ dropLast: true }); return; }

    const hit = findHitLine(pos.x, pos.y, lines, xScale, yScale, candles, 8, isLog);
    if (hit) { onLineDoubleClick?.(hit.id, "line", e.clientX, e.clientY); return; }

    const hitCh = findHitChannel(pos.x, pos.y, channels ?? [], xScale, yScale, candles, 8, isLog);
    if (hitCh) { onLineDoubleClick?.(hitCh.id, "channel", e.clientX, e.clientY); return; }

    const hitCi = findHitCircle(pos.x, pos.y, circles ?? [], xScale, yScale, candles);
    if (hitCi) { onLineDoubleClick?.(hitCi.id, "circle", e.clientX, e.clientY); return; }

    // 히트 우선순위는 buildHitChain 5번(선택)과 같게 유지할 것 —
    // 어긋나면 "클릭하면 선이 잡히는데 더블클릭하면 피보나치 팝업이 뜬다"가 된다
    const hitFb = findHitFib(pos.x, pos.y, fibs ?? [], xScale, yScale, candles, isLog);
    if (hitFb) { onLineDoubleClick?.(hitFb.id, "fib", e.clientX, e.clientY); return; }

    const hitMs = findHitMeasure(pos.x, pos.y, measures ?? [], xScale, yScale, candles);
    if (hitMs) { onLineDoubleClick?.(hitMs.id, "measure", e.clientX, e.clientY); return; }

    const hitSt = findHitStructure(pos.x, pos.y, structures ?? [], xScale, yScale, candles);
    if (hitSt) { onLineDoubleClick?.(hitSt.id, "structure", e.clientX, e.clientY); return; }

    // 자동 ZZ 지그재그 — 도형이 아니라 지표라 항목이 하나뿐이고 id는 상수 ZZ_ID.
    // 수동 구조 뒤에 둬서, 겹칠 때는 직접 그린 쪽이 이긴다.
    if (showZZ && findHitZzLeg(pos.x, pos.y, getZzSegments(), xScale, yScale)) {
      onLineDoubleClick?.(ZZ_ID, "zz", e.clientX, e.clientY);
    }
  }, [candles, lines, channels, circles, fibs, measures, structures, structMode, finishStruct, drawings, locked, IW, IH, getSvgPos, onLineDoubleClick, showZZ]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMouseLeave = useCallback(() => {
    dragRef.current = null;
    setCurrent(null);
    // 그리다 만 측정 박스는 버린다 — 차트 밖에서 버튼을 놓으면 onMouseUp이 안 와서
    // 점선 사각형이 화면에 그대로 얼어붙는다 (플랜 박스의 setCurrent(null)과 같은 이유)
    setMeasureDraft?.(null);
    setCursor("crosshair");
    hideCrosshair?.();
  }, [setCurrent, setMeasureDraft, hideCrosshair]);

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
