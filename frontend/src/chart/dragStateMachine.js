import { idxToTimestamp, getCandleMs } from "../utils/coordUtils";
import { padYDomain } from "./scales";
import { snapToStructurePoint } from "./hitDetection";

// 두 가격(p1, p2)을 마우스 드래그 vector에 따라 같이 이동시킨다.
// 선형 모드: delta(가격 차) 가산 / 로그 모드: ratio(가격 비율) 곱
function movePricePair(yScale, pos, drag, isLog) {
  const dragStartPrice = yScale.invert(drag.startY);
  const nowPrice       = yScale.invert(pos.y);
  if (isLog) {
    const ratio = (dragStartPrice > 0 && nowPrice > 0) ? nowPrice / dragStartPrice : 1;
    return { newP1: drag.startP1 * ratio, newP2: drag.startP2 * ratio };
  }
  const dp = nowPrice - dragStartPrice;
  return { newP1: drag.startP1 + dp, newP2: drag.startP2 + dp };
}

// 시간 vector — 메인 라인/채널/원 몸통 이동 시 공통
function moveTimeDelta(xScale, pos, drag, candles) {
  const di = xScale.invert(pos.x) - xScale.invert(drag.startX);
  return di * getCandleMs(candles);
}

// 드래그 중인 **플랜 박스 하나**를 꺼낸다.
//
// ⚠ 박스가 롱·숏 둘이라(2026-08-19) 어느 쪽을 끌고 있는지는 `dragRef`가 들고 있다
//   (`hitDetection`이 히트한 순간 `isLong`을 실어 둔다). 여기서 `state.drawings`를
//   훑어 "있는 것"을 고르면 두 박스가 겹쳐 있을 때 엉뚱한 쪽이 끌려간다.
const boxOf = (state, drag) => state?.drawings?.[drag.isLong ? "long" : "short"] ?? null;

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
        yDomainRef.current = padYDomain(lo, hi, padFrac, setters.isLog);
      }
      if (setters.overlaysRef) setters.overlaysRef.current._panning = true;
      // redrawChart = redrawCanvas + redrawVolume + redrawRSI + forceUpdate
      // forceUpdate → scales 재계산 → 선/원/채널/구조 등 SVG 오버레이도 즉시 따라옴
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
    onUp({ pos, drag, scales, candles, IW, IH, setters, state }) {
      const { setDrawing, setCurrent, setDrawMode } = setters;
      const { xScale, yScale } = scales;
      const sx = drag.startX, sy = drag.startY;
      const ex = Math.min(Math.max(pos.x, 0), IW);
      const ey = Math.min(Math.max(pos.y, 0), IH);
      if (Math.abs(ex - sx) < 15 || Math.abs(ey - sy) < 15) { setCurrent(null); return; }
      const isLong = ey > sy; // 롱=아래로 드래그, 숏=위로 드래그
      // ⚠ **주문이 걸린 박스는 덮어쓰지 않는다** (2026-08-19). 덮으면 `orderId` 연결이
      //   끊겨 바이낸스에 살아 있는 미체결 주문이 화면에서 미아가 된다
      //   (플랜 카드에서 빠지고 OrphanPendingCard로 떨어져 박스로 가격을 못 고친다).
      //   방향은 드래그를 놓아야 정해지므로 시작 시점에는 막을 수 없다 — 여기서 되돌린다
      if (state?.drawings?.[isLong ? "long" : "short"]?.orderId) {
        setCurrent(null);
        setters.setOrderStatus?.({
          type: "error",
          msg: `${isLong ? "▲ LONG" : "▼ SHORT"} 플랜에 이미 주문이 걸려 있습니다 — 먼저 취소하세요`,
        });
        return;
      }
      // ⚠ **같은 사이드에 포지션이 있으면 그쪽 플랜 박스는 그려지지 않는다**
      //   (2026-08-19 사용자 요청). 롱을 들고 있으면 숏 박스만, 숏을 들고 있으면 롱 박스만.
      //   이유: 포지션이 있는 쪽에 플랜을 그려도 **주문을 낼 수 없다** — PlanCard가
      //   `sameSidePos`를 보고 실행 버튼 대신 `포지션이 이미 있습니다`를 띄운다.
      //   그런데 진입 주문이 나가면 그 박스의 TP가 자동 등록되면서 **이미 걸어 둔
      //   분할 TP와 공존**할 수 있어(단일 TP ↔ 분할 TP 배타 규칙이 이 경로만 못 막는다),
      //   애초에 못 그리게 하는 게 그 구멍까지 같이 닫는다
      //   ※ 2026-08-19 이전에 있던 "포지션이 있으면 박스를 **지운다**"(App.jsx)와는 다르다.
      //     저건 그려진 뒤 조용히 증발해서 왜 사라졌는지 알 수 없었다 — 그래서 제거됐다.
      //     여기서는 **그리는 순간 되돌리고 이유를 배너로 띄운다** (위 orderId 가드와 같은 방식).
      //     되살릴 거면 "지우기"가 아니라 이 방식으로 할 것
      if (state?.position?.[isLong ? "long" : "short"]) {
        setCurrent(null);
        setters.setOrderStatus?.({
          type: "error",
          msg: `${isLong ? "▲ LONG" : "▼ SHORT"} 포지션이 이미 있습니다 — 청산 후 플랜을 그릴 수 있습니다`,
        });
        return;
      }
      const slDist = ey - sy; // 양수(롱/아래), 음수(숏/위)
      const tpPx   = Math.min(Math.max(sy - slDist * 2, 0), IH); // SL 거리의 2배 반대 방향
      setDrawing(isLong, {
        tStart: idxToTimestamp(xScale.invert(Math.min(sx, ex)), candles),
        tEnd:   idxToTimestamp(xScale.invert(Math.max(sx, ex)), candles),
        entry:  yScale.invert(sy),
        tp:     yScale.invert(tpPx),
        sl:     yScale.invert(ey),
        isLong,
      });
      setCurrent(null);
      setDrawMode(false);
      setters.setSelectedBox?.(isLong ? "long" : "short");
      setters.setCursor("crosshair");
    },
  },

  // 박스 좌우 폭 조절 (2026-08-14 사용자 요청).
  // 폭은 **주문에 들어가지 않는 순수 표시값**이라 onUp에서 재등록을 부르지 않는다
  // (entry/sl은 replacePendingOrder, tp는 updatePendingTpsl을 부르는 것과 대비된다).
  box_x: {
    onMove({ pos, drag, scales, candles, IW, setters }) {
      if (!scales || !candles.length) return;
      const t  = idxToTimestamp(scales.xScale.invert(Math.min(Math.max(pos.x, 0), IW)), candles);
      const ms = getCandleMs(candles);
      setters.setDrawing(drag.isLong, p => {
        if (!p) return p;
        // 최소 1봉은 남긴다 — 폭이 0이 되면 BoxOverlay가 x2 <= x1로 렌더를 통째로 접어
        // 박스가 사라진 것처럼 보이고 다시 잡을 수도 없다
        return drag.edge === "start"
          ? { ...p, tStart: Math.min(t, p.tEnd   - ms) }
          : { ...p, tEnd:   Math.max(t, p.tStart + ms) };
      });
      setters.setCursor("ew-resize");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  entry: {
    onMove({ pos, drag, scales, candles, IW, IH, setters }) {
      const { xScale, yScale } = scales;
      const v  = yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      
      let newTp, newSl;
      if (setters.isLog) {
        const ratio = (drag.startEntry > 0 && v > 0) ? v / drag.startEntry : 1;
        newTp = drag.startTp * ratio;
        newSl = drag.startSl * ratio;
      } else {
        const dy = v - drag.startEntry;
        newTp = drag.startTp + dy;
        newSl = drag.startSl + dy;
      }

      const di = xScale.invert(Math.min(Math.max(pos.x, 0), IW))
               - xScale.invert(drag.startX);
      const dt = di * getCandleMs(candles);
      setters.setDrawing(drag.isLong, p => ({
        ...p,
        entry:  v,
        tp:     newTp,
        sl:     newSl,
        tStart: drag.startTStart + dt,
        tEnd:   drag.startTEnd   + dt,
      }));
      setters.setCursor("move");
    },
    onUp({ setters, state, drag }) {
      setters.setCursor("crosshair");
      if (boxOf(state, drag)?.orderId) setters.replacePendingOrder?.(drag.isLong);
    },
  },

  tp: {
    onMove({ pos, drag, scales, IH, setters, state }) {
      const box = boxOf(state, drag);
      if (!box) return;
      const v = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      if (drag.isLong  && v <= box.entry) return;
      if (!drag.isLong && v >= box.entry) return;
      setters.setDrawing(drag.isLong, p => ({ ...p, tp: v }));
      setters.setCursor("ns-resize");
    },
    onUp({ setters, state, drag }) {
      setters.setCursor("crosshair");
      if (boxOf(state, drag)?.orderId) setters.updatePendingTpsl?.(drag.isLong);
    },
  },

  sl: {
    onMove({ pos, drag, scales, IH, setters, state }) {
      const box = boxOf(state, drag);
      if (!box) return;
      const v = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      if (drag.isLong  && v >= box.entry) return;
      if (!drag.isLong && v <= box.entry) return;
      setters.setDrawing(drag.isLong, p => ({ ...p, sl: v }));
      setters.setCursor("ns-resize");
    },
    onUp({ setters, state, drag }) {
      setters.setCursor("crosshair");
      if (boxOf(state, drag)?.orderId) setters.replacePendingOrder?.(drag.isLong);
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

  // 분할 SL — 분할 TP와 같은 구조 (2026-08-24)
  partial_sl: {
    onMove({ pos, scales, IH, setters, drag }) {
      const newPrice = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      setters.setDragPartialSl({ orderId: drag.orderId, price: newPrice });
      setters.setCursor("ns-resize");
    },
    onUp({ setters, state }) {
      if (state.dragPartialSl) setters.movePartialSl(state.dragPartialSl.orderId, state.dragPartialSl.price);
      setters.setDragPartialSl(null);
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
      const dt = moveTimeDelta(scales.xScale, pos, drag, candles);
      const { newP1, newP2 } = movePricePair(scales.yScale, pos, drag, setters.isLog);
      setters.setChannelPosition(drag.channelId, drag.startT1 + dt, newP1, drag.startT2 + dt, newP2);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  // ── 원 드래그 ─────────────────────────────────────────────────────────────
  // ── 측정 박스 (2026-08-26) ────────────────────────────────────────────────
  // ⚠ **드래그로 그린다** (사용자 지정). 선·원·피보나치는 2클릭이라 그리기가
  //   hitDetection의 클릭 핸들러에서 끝나지만, 이건 플랜 박스(`draw`)처럼
  //   눌러서 끌고 놓는다 — 그래서 그리기가 여기 드래그 핸들러로 온다.
  //   시작 모서리(t1/p1)는 hitDetection이 dragRef에 실어 둔다 (부호의 기준이라
  //   나중에 min/max로 정렬해서 다시 만들면 안 된다 — chart/measure.js)
  measure_draw: {
    onMove({ pos, drag, scales, candles, IW, IH, setters }) {
      if (!scales || !candles.length) return;
      const { t, p } = {
        t: idxToTimestamp(scales.xScale.invert(Math.min(Math.max(pos.x, 0), IW)), candles),
        p: scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH)),
      };
      setters.setMeasureDraft({ t1: drag.t1, p1: drag.p1, t2: t, p2: p });
      setters.setCursor("crosshair");
    },
    onUp({ pos, drag, scales, candles, IW, IH, setters }) {
      setters.setCursor("crosshair");
      if (!scales || !candles.length) { setters.setMeasureDraft(null); return; }
      const ex = Math.min(Math.max(pos.x, 0), IW);
      const ey = Math.min(Math.max(pos.y, 0), IH);
      // 너무 작으면 버리되 **모드는 켜 둔다** — 손이 미끄러진 것뿐인데 도구까지
      // 꺼지면 버튼을 다시 눌러야 한다 (성공하면 addMeasure가 모드를 끈다)
      if (Math.abs(ex - drag.startX) < 10 || Math.abs(ey - drag.startY) < 10) {
        setters.setMeasureDraft(null);
        return;
      }
      setters.addMeasure(
        drag.t1, drag.p1,
        idxToTimestamp(scales.xScale.invert(ex), candles),
        scales.yScale.invert(ey),
      );
    },
  },
  measure_ep: {
    onMove({ pos, drag, scales, candles, IW, IH, setters }) {
      if (!scales || !candles.length) return;
      const t = idxToTimestamp(scales.xScale.invert(Math.min(Math.max(pos.x, 0), IW)), candles);
      const p = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      setters.moveMeasureCorner(drag.measureId, drag.tKey, drag.pKey, t, p);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },
  measure_move: {
    onMove({ pos, drag, scales, candles, setters }) {
      if (!scales) return;
      const dt = moveTimeDelta(scales.xScale, pos, drag, candles);
      // 로그 스케일이면 가격 **비율**로 옮긴다 — 선·채널과 같은 규칙(movePricePair).
      // 등락률이 이 도형의 값이라, 로그 차트에서 평행이동하면 값이 유지되는 게 맞다
      const { newP1, newP2 } = movePricePair(scales.yScale, pos, drag, setters.isLog);
      setters.setMeasurePosition(drag.measureId,
        drag.startT1 + dt, newP1,
        drag.startT2 + dt, newP2);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

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

  // ── 수동 구조 꼭짓점 드래그 ───────────────────────────────────────────────
  // windowBars=0 → 커서가 있는 봉의 꼬리에 정확히 붙는다 (주변 극점 탐색 없음).
  // 순서 재정렬은 onUp에서 한 번만 — 드래그 중 정렬하면 점이 커서 아래에서 튄다.
  struct_point: {
    onMove({ pos, drag, scales, candles, setters }) {
      if (!scales || !candles.length) return;
      const snapped = snapToStructurePoint(pos, candles, scales.xScale, scales.yScale, drag.ptType, 0);
      if (!snapped) return;
      drag.moved = true;
      setters.moveStructPoint(drag.structId, drag.ptIdx, snapped.t, snapped.p);
      setters.setCursor("move");
    },
    onUp({ drag, setters }) {
      setters.normalizeStruct?.(drag.structId);
      // 실제로 움직였을 때만 부분 선택 해제 — normalize가 순서를 바꿔 인덱스가 낡기 때문.
      // 움직이지 않은 경우는 "꼭짓점 클릭 = 선택"이므로 유지해야 Delete로 지울 수 있다.
      if (drag.moved) setters.clearStructPart?.();
      setters.setCursor("crosshair");
    },
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
      const dt = moveTimeDelta(scales.xScale, pos, drag, candles);
      const { newP1, newP2 } = movePricePair(scales.yScale, pos, drag, setters.isLog);
      setters.setLinePosition(drag.lineId, drag.startT1 + dt, newP1, drag.startT2 + dt, newP2);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  // ── 피보나치 드래그 ───────────────────────────────────────────────────────
  // 트렌드라인과 같다 — 앵커 두 개짜리 도형이라 끝점 이동 / 몸통 평행이동뿐이다.
  // 레벨 가로선을 개별로 끌 수는 없다: 위치가 곧 비율이라 하나만 옮기면 정의가 깨진다
  fib_ep: {
    onMove({ pos, drag, scales, candles, IW, setters }) {
      if (!scales || !candles.length) return;
      const { xScale, yScale } = scales;
      const t = idxToTimestamp(xScale.invert(Math.min(Math.max(pos.x, -IW), IW * 2)), candles);
      const p = yScale.invert(pos.y);
      setters.updateFibEndpoint(drag.fibId, drag.endpoint, t, p);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  fib_move: {
    onMove({ pos, drag, scales, candles, setters }) {
      if (!scales) return;
      const dt = moveTimeDelta(scales.xScale, pos, drag, candles);
      const { newP1, newP2 } = movePricePair(scales.yScale, pos, drag, setters.isLog);
      setters.setFibPosition(drag.fibId, drag.startT1 + dt, newP1, drag.startT2 + dt, newP2);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  channel_mid_offset: {
    onMove({ pos, drag, scales, IH, setters }) {
      if (!scales) return;
      const nowPrice   = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      const startPrice = scales.yScale.invert(drag.startY);
      let newOffset, newOffset2;
      if (setters.isLog) {
        const ratio = (startPrice > 0 && nowPrice > 0) ? nowPrice / startPrice : 1;
        newOffset  = drag.startOffset  * ratio;
        newOffset2 = drag.startOffset2 * ratio;
      } else {
        const delta = nowPrice - startPrice;
        newOffset  = drag.startOffset  + delta;
        newOffset2 = drag.startOffset2 + delta;
      }
      setters.updateChannelBothOffsets(drag.channelId, newOffset, newOffset2);
      setters.setCursor("ns-resize");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  // 메인 라인 중간 핸들: **메인 라인만** 위아래로 옮긴다 (미러는 제자리 → 폭이 바뀐다).
  //
  // ⚠ 위 `channel_mid_offset`(미러 중간 핸들)과 대칭이다 — 2026-08-24 사용자 요청으로
  //   채널 핸들을 메인 3 + 미러 3으로 맞추면서 생겼다. 규칙은 하나다:
  //   **잡은 점이 있는 선이 움직이고, 반대쪽 선은 제자리에 있는다.**
  //
  // ⚠ 스케일을 **두 군데서 따로** 본다. 하나로 합치지 말 것:
  //   ① 메인 라인이 커서를 따라 평행 이동하는 방식 → **지금 차트 스케일**(setters.isLog).
  //      화면에서 평행해 보여야 하므로 눈에 보이는 축을 따른다
  //   ② 미러를 제자리에 두려고 offset을 고치는 방식 → **채널의 isLog**(drag.chIsLog).
  //      offset이 "더하는 값"인지 "곱하는 값"인지는 만들어질 때 정해졌고
  //      렌더(Channels.jsx applyOffset)가 그 기준으로 그린다
  //   둘이 다를 수 있어서(로그로 그린 채널을 선형 차트에서 보는 중 등) 한쪽 기준으로
  //   묶으면 끄는 동안 **미러 라인이 같이 밀린다** — 이 핸들의 존재 이유가 사라진다
  channel_mid_main: {
    onMove({ pos, drag, scales, IH, setters }) {
      if (!scales) return;
      const nowPrice   = scales.yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      const startPrice = scales.yScale.invert(drag.startY);
      // ① 메인 라인 새 위치 (시작값 기준 — 누적하지 않는다)
      let p1, p2;
      if (setters.isLog) {
        const ratio = (startPrice > 0 && nowPrice > 0) ? nowPrice / startPrice : 1;
        p1 = drag.startP1 * ratio;
        p2 = drag.startP2 * ratio;
      } else {
        const delta = nowPrice - startPrice;
        p1 = drag.startP1 + delta;
        p2 = drag.startP2 + delta;
      }
      // ② 미러 가격은 그대로 → 새 p에서 offset을 역산한다
      let offset, offset2;
      if (drag.chIsLog) {
        const m1 = drag.startP1 * drag.startOffset;
        const m2 = drag.startP2 * drag.startOffset2;
        offset  = p1 !== 0 ? m1 / p1 : drag.startOffset;
        offset2 = p2 !== 0 ? m2 / p2 : drag.startOffset2;
      } else {
        offset  = (drag.startP1 + drag.startOffset)  - p1;
        offset2 = (drag.startP2 + drag.startOffset2) - p2;
      }
      // 두 번 부르지만 **패치가 겹치지 않아**(위치 / offset) 순서와 무관하고,
      // React가 한 번에 반영하므로 미러가 깜빡이지 않는다
      setters.setChannelPosition(drag.channelId, drag.t1, p1, drag.t2, p2);
      setters.updateChannelBothOffsets(drag.channelId, offset, offset2);
      setters.setCursor("ns-resize");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },

  // 미러 라인 끝점 드래그: 마우스가 미러 위치를 따라가도록 offset 보정 후 메인 라인 이동
  channel_mirror_ep: {
    onMove({ pos, drag, scales, candles, IW, IH, setters }) {
      if (!scales || !candles.length) return;
      const { xScale, yScale } = scales;
      const rawIdx    = xScale.invert(Math.min(Math.max(pos.x, 0), IW));
      const t         = idxToTimestamp(rawIdx, candles);
      const mousePrice = yScale.invert(Math.min(Math.max(pos.y, 0), IH));
      // a2 = p1 + offset  →  p1 = mousePrice - offset  (linear)
      // a2 = p1 * offset  →  p1 = mousePrice / offset  (log)
      const p = setters.isLog ? mousePrice / drag.offset : mousePrice - drag.offset;
      setters.updateChannelEndpoint(drag.channelId, drag.endpoint, t, p);
      setters.setCursor("move");
    },
    onUp({ setters }) { setters.setCursor("crosshair"); },
  },
};
