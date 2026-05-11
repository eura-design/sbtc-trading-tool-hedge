import { idxToTimestamp, getCandleMs } from "../utils/coordUtils";

export const DRAG_HANDLERS = {
  pan: {
    onMove({ pos, drag, candles, IW, setters }) {
      const { xDomainRef, yDomainRef, redrawCanvas, setCursor } = setters;
      const [i0, i1] = drag.xDom0;
      const span     = i1 - i0;
      const pxPerBar = IW / span;
      const di       = (pos.x - drag.startX) / pxPerBar;
      const newI0    = i0 - di;
      const newI1    = i1 - di;
      xDomainRef.current = [newI0, newI1];
      const vi0 = Math.max(0, Math.floor(newI0));
      const vi1 = Math.min(candles.length - 1, Math.ceil(newI1));
      // slice + d3.min/max 대신 직접 루프 (배열 복사 없음, D3 콜백 오버헤드 없음)
      let lo = Infinity, hi = -Infinity;
      for (let i = vi0; i <= vi1; i++) {
        const c = candles[i];
        if (c.l < lo) lo = c.l;
        if (c.h > hi) hi = c.h;
      }
      if (lo !== Infinity) {
        const zr  = span / (candles.length - 1 || 1);
        const padFrac = Math.max(0.08, zr * 0.5);
        if (!setters.isLog) {
          const pad = (hi - lo) * padFrac;
          yDomainRef.current = [lo - pad, hi + pad];
        } else {
          const safeLo = Math.max(lo, 1), safeHi = Math.max(hi, safeLo * 1.001);
          const logPad = Math.pow(safeHi / safeLo, padFrac);
          yDomainRef.current = [safeLo / logPad, safeHi * logPad];
        }
      }
      if (setters.overlaysRef) setters.overlaysRef.current._panning = true;
      // redrawChart = redrawCanvas + redrawVolume + redrawRSI + forceUpdate
      // forceUpdate → scales 재계산 → 선/원/채널/다이버전스 등 SVG 오버레이도 즉시 따라옴
      // _panning 플래그가 FVG/OB/SR/EMA 캔버스 렌더는 스킵하므로 성능 유지
      setters.redrawChart?.();
      setCursor("grabbing");
    },
    onUp({ setters }) {
      if (setters.overlaysRef) setters.overlaysRef.current._panning = false;
      setters.setCursor("crosshair");
      setters.redrawChart?.(); // pan 종료 시 오버레이 포함 전체 동기화
    },
  },

  draw: {
    onMove({ pos, IW, IH, setters }) {
      setters.setCurrent(p => p ? {
        ...p,
        x2: Math.min(Math.max(pos.x, 0), IW),
        y2: Math.min(Math.max(pos.y, 0), IH),
      } : null);
      setters.setCursor("crosshair");
    },
    onUp({ pos, drag, scales, candles, IW, IH, setters }) {
      const { setDrawing, setCurrent, setDrawMode } = setters;
      const { xScale, yScale } = scales;
      const sx = drag.startX, sy = drag.startY;
      const ex = Math.min(Math.max(pos.x, 0), IW);
      const ey = Math.min(Math.max(pos.y, 0), IH);
      if (Math.abs(ex - sx) < 15 || Math.abs(ey - sy) < 15) { setCurrent(null); return; }
      const isLong = ey > sy; // 롱=아래로 드래그, 숏=위로 드래그
      const slDist = ey - sy; // 양수(롱/아래), 음수(숏/위)
      const tpPx   = Math.min(Math.max(sy - slDist * 2, 0), IH); // SL 거리의 2배 반대 방향
      setDrawing({
        tStart: idxToTimestamp(xScale.invert(Math.min(sx, ex)), candles),
        tEnd:   idxToTimestamp(xScale.invert(Math.max(sx, ex)), candles),
        entry:  yScale.invert(sy),
        tp:     yScale.invert(tpPx),
        sl:     yScale.invert(ey),
        isLong,
      });
      setCurrent(null);
      setDrawMode(false);
      setters.setSelectedBox?.(true);
      setters.setCursor("crosshair");
    },
  },

  entry: {
    onMove({ pos, drag, scales, candles, IW, IH, setters }) {
      const { xScale, yScale } = scales;
      const v  = yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      const dy = v - drag.startEntry;
      const di = xScale.invert(Math.min(Math.max(pos.x, 0), IW))
               - xScale.invert(drag.startX);
      const dt = di * getCandleMs(candles);
      setters.setDrawing(p => ({
        ...p,
        entry:  v,
        tp:     drag.startTp + dy,
        sl:     drag.startSl + dy,
        tStart: drag.startTStart + dt,
        tEnd:   drag.startTEnd   + dt,
      }));
      setters.setCursor("move");
    },
    onUp({ setters, state }) {
      setters.setCursor("crosshair");
      if (state.drawing?.orderId) setters.replacePendingOrder?.();
    },
  },

  tp: {
    onMove({ pos, drag, scales, IH, setters, state }) {
      const v = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      if (state.drawing.isLong && v <= state.drawing.entry) return;
      if (!state.drawing.isLong && v >= state.drawing.entry) return;
      setters.setDrawing(p => ({ ...p, tp: v }));
      setters.setCursor("ns-resize");
    },
    onUp({ setters, state }) {
      setters.setCursor("crosshair");
      if (state.drawing?.orderId) setters.updatePendingTpsl?.();
    },
  },

  sl: {
    onMove({ pos, drag, scales, IH, setters, state }) {
      const v = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      if (state.drawing.isLong && v >= state.drawing.entry) return;
      if (!state.drawing.isLong && v <= state.drawing.entry) return;
      setters.setDrawing(p => ({ ...p, sl: v }));
      setters.setCursor("ns-resize");
    },
    onUp({ setters, state }) {
      setters.setCursor("crosshair");
      if (state.drawing?.orderId) setters.replacePendingOrder?.();
    },
  },

  pos_tp: {
    onMove({ pos, scales, IH, setters, drag }) {
      const newPrice = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      setters.setDragTpsl({ type: "tp", price: newPrice, side: drag.side });
      setters.setCursor("ns-resize");
    },
    onUp({ setters, state }) {
      if (state.dragTpsl) setters.saveTpsl(state.dragTpsl.price, null, state.dragTpsl.side);
    },
  },

  pos_sl: {
    onMove({ pos, scales, IH, setters, drag }) {
      const newPrice = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      setters.setDragTpsl({ type: "sl", price: newPrice, side: drag.side });
      setters.setCursor("ns-resize");
    },
    onUp({ setters, state }) {
      if (state.dragTpsl) setters.saveTpsl(null, state.dragTpsl.price, state.dragTpsl.side);
    },
  },

  scale_in: {
    onMove({ pos, scales, IH, setters, drag }) {
      const newPrice = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      setters.setDragScaleIn({ orderId: drag.orderId, price: newPrice });
      setters.setCursor("ns-resize");
    },
    onUp({ setters, state }) {
      if (state.dragScaleIn) setters.moveScaleIn(state.dragScaleIn.orderId, state.dragScaleIn.price);
      setters.setDragScaleIn(null);
    },
  },

  split_tp: {
    onMove({ pos, scales, IH, setters, drag }) {
      const newPrice = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      setters.setDragSplitTp({ orderId: drag.orderId, price: newPrice });
      setters.setCursor("ns-resize");
    },
    onUp({ setters, state }) {
      if (state.dragSplitTp) setters.moveSplitTp(state.dragSplitTp.orderId, state.dragSplitTp.price);
      setters.setDragSplitTp(null);
    },
  },

  // ── 채널 드래그 ────────────────────────────────────────────────────────────
  channel_ep: {
    onMove({ pos, drag, scales, candles, IW, IH, setters }) {
      if (!scales || !candles.length) return;
      const { xScale, yScale } = scales;
      const rawIdx = xScale.invert(Math.min(Math.max(pos.x, 0), IW));
      const t = idxToTimestamp(rawIdx, candles);
      const p = yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      setters.updateChannelEndpoint(drag.channelId, drag.endpoint, t, p);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  channel_move: {
    onMove({ pos, drag, scales, candles, IW, IH, setters }) {
      if (!scales) return;
      const { xScale, yScale } = scales;
      const di = xScale.invert(pos.x) - xScale.invert(drag.startX);
      const dt = di * getCandleMs(candles);
      let newP1, newP2;
      if (setters.isLog) {
        // log 모드: 비율 이동 (시각적으로 동일한 픽셀 간격 유지)
        const dragStartPrice = yScale.invert(drag.startY);
        const nowPrice       = yScale.invert(pos.y);
        const ratio = (dragStartPrice > 0 && nowPrice > 0) ? nowPrice / dragStartPrice : 1;
        newP1 = drag.startP1 * ratio;
        newP2 = drag.startP2 * ratio;
      } else {
        const dp = yScale.invert(pos.y) - yScale.invert(drag.startY);
        newP1 = drag.startP1 + dp;
        newP2 = drag.startP2 + dp;
      }
      setters.setChannelPosition(drag.channelId, drag.startT1 + dt, newP1, drag.startT2 + dt, newP2);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  // ── 원 드래그 ─────────────────────────────────────────────────────────────
  circle_move: {
    onMove({ pos, drag, scales, candles, IW, IH, setters }) {
      if (!scales) return;
      const { xScale, yScale } = scales;
      const di = xScale.invert(pos.x) - xScale.invert(drag.startX);
      const dp = yScale.invert(pos.y) - yScale.invert(drag.startY);
      const dt = di * getCandleMs(candles);
      setters.moveCircle(drag.circleId,
        drag.startCxT + dt, drag.startCxP + dp,
        drag.startRxT + dt, drag.startRxP + dp);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  circle_radius: {
    onMove({ pos, drag, scales, candles, IW, IH, setters }) {
      if (!scales || !candles.length) return;
      const { xScale, yScale } = scales;
      const rawIdx = xScale.invert(Math.min(Math.max(pos.x, 0), IW));
      const t = idxToTimestamp(rawIdx, candles);
      const p = yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      setters.moveCircle(drag.circleId, drag.cxT, drag.cxP, t, p);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  // ── 트렌드라인 드래그 ─────────────────────────────────────────────────────
  line_ep: {
    onMove({ pos, drag, scales, candles, IW, IH, setters }) {
      if (!scales || !candles.length) return;
      const { xScale, yScale } = scales;
      const t = idxToTimestamp(xScale.invert(Math.min(Math.max(pos.x, -IW), IW * 2)), candles);
      const p = yScale.invert(pos.y);
      setters.updateLineEndpoint(drag.lineId, drag.endpoint, t, p);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  line_move: {
    onMove({ pos, drag, scales, candles, setters }) {
      if (!scales) return;
      const { xScale, yScale } = scales;
      const di = xScale.invert(pos.x) - xScale.invert(drag.startX);
      const dt = di * getCandleMs(candles);
      let newP1, newP2;
      if (setters.isLog) {
        // log 모드: 비율 이동
        const dragStartPrice = yScale.invert(drag.startY);
        const nowPrice       = yScale.invert(pos.y);
        const ratio = (dragStartPrice > 0 && nowPrice > 0) ? nowPrice / dragStartPrice : 1;
        newP1 = drag.startP1 * ratio;
        newP2 = drag.startP2 * ratio;
      } else {
        const dp = yScale.invert(pos.y) - yScale.invert(drag.startY);
        newP1 = drag.startP1 + dp;
        newP2 = drag.startP2 + dp;
      }
      setters.setLinePosition(drag.lineId, drag.startT1 + dt, newP1, drag.startT2 + dt, newP2);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  channel_offset: {
    onMove({ pos, drag, scales, IH, setters }) {
      if (!scales) return;
      const nowPrice   = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      const startPrice = scales.yScale.invert(drag.startY);
      if (setters.isLog) {
        // log 모드: offset을 비율(ratio)로 저장
        const ratio = (startPrice > 0 && nowPrice > 0) ? nowPrice / startPrice : 1;
        setters.setChannelOffset(drag.channelId, drag.startOffset * ratio);
      } else {
        setters.setChannelOffset(drag.channelId, drag.startOffset + (nowPrice - startPrice));
      }
      setters.setCursor("ns-resize");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },
};
