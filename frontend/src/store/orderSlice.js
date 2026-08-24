import { calcPosition }  from "../utils/calc";
import { api }           from "../api/client";
import { closeToPosition, positionToSide, isLongToPosition, isLongToSide } from "../utils/side";
import { paperActions }  from "../replay/paperActions";
import { riskPctFor }   from "./settingsSlice";
import { boxKey }       from "./uiSlice";

// 리플레이(페이퍼) 모드면 같은 이름의 페이퍼 핸들러로 넘긴다.
// 각 액션 첫 줄에서 한 번만 갈라지므로 아래 실거래 코드는 원래대로 읽힌다.
// ⚠ 새 주문 액션을 추가하면 **이 위임 한 줄도 같이 넣을 것.** 빠뜨리면 리플레이
//   중에 그 액션만 실계좌로 가려다 api() 가드에 막혀 에러가 난다 (조용히 나가지는 않는다).

export const createOrderSlice = (set, get) => ({

  // ⚠ 플랜 박스가 롱·숏 둘이라 **어느 박스인지**를 인자로 받는다 (2026-08-19).
  //   `get().drawings`에서 알아서 고르게 두지 말 것 — 둘 다 있을 때 무엇이 나갈지가
  //   부르는 쪽 코드에 드러나지 않는다 (사이드바 실행 버튼은 카드마다 따로 있다)
  executeOrder: async (orderType, isLong) => {
    if (get().replayOn) return paperActions.executeOrder(get, orderType, isLong);
    const st = get();
    const { drawings, leverage, balance, setOrderStatus, setDrawing, _refetchBal, _refetchPos, _refetchTpsl } = st;
    const drawing = drawings[boxKey(isLong)];
    if (!drawing) return;
    // 리스크 %는 **사이드별**이다 (settingsSlice.riskPctFor) — 레버리지와 달리 거래소에
    // 보내지 않고 수량 계산에만 쓰이므로 롱·숏이 서로 다른 값을 가질 수 있다
    const riskPct = riskPctFor(st, drawing.isLong);
    try {
      const dl = await api("GET", "/api/daily-loss");
      if (dl && dl.remaining <= 0) {
        setOrderStatus({ type: "error", msg: "일일 손실 한도 초과 — 매매가 제한됩니다" });
        return;
      }
    } catch { /* 조회 실패 시 통과 — 서버에서 최종 차단 */ }
    const capital = balance?.availableBalance ?? 0;
    const posCalc = calcPosition(capital, riskPct / 100, drawing.entry, drawing.sl, leverage);
    if (!posCalc) return;
    const qty = posCalc.actualQty;
    if (!qty || qty <= 0) return;
    setOrderStatus(null);
    try {
      const drawingPayload = orderType === "LIMIT" ? {
        tStart: drawing.tStart, tEnd: drawing.tEnd,
        pTop: drawing.pTop, pBot: drawing.pBot,
        isLong: drawing.isLong, entry: drawing.entry, tp: drawing.tp, sl: drawing.sl,
      } : undefined;
      const data = await api("POST", "/api/order", {
        side:     isLongToSide(drawing.isLong),
        orderType,
        entry:    drawing.entry,
        tp:       drawing.tp,
        sl:       drawing.sl,
        quantity: qty,
        leverage,
        drawing:  drawingPayload,
      });
      if (orderType === "LIMIT") {
        setDrawing(isLong, prev => prev ? { ...prev, orderId: String(data.entry.orderId) } : prev);
      }
      if (orderType === "MARKET") setDrawing(isLong, null);
      if (data.warning) {
        setOrderStatus({ type: "error", msg: `⚠ 진입 체결됨, ${data.warning}` });
      } else {
        setOrderStatus({ type: "success", msg: data.message || "주문 완료 — 진입 / TP / SL 전송됨" });
      }
      // ⚠ TP/SL도 같이 새로 읽는다. 시장가는 백엔드가 진입과 **같은 요청 안에서** TP/SL을
      //   등록해 끝내므로, 여기서 안 부르면 useTpsl의 60초 폴링 전까지 화면에 안 나온다.
      //   특히 반대쪽 포지션을 이미 들고 있으면 useTpsl의 hasPos가 계속 true라
      //   "포지션 생김"으로 인한 즉시 조회조차 트리거되지 않는다.
      //   포지션 → TP/SL **순서**로 부를 것 (useTpsl이 포지션 유무를 보고 조회를 건너뛴다)
      setTimeout(async () => {
        _refetchBal();
        await _refetchPos();
        _refetchTpsl();
      }, 1500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: e.message });
    }
  },

  saveTpsl: async (newTp, newSl, dragSide) => {
    if (get().replayOn) return paperActions.saveTpsl(get, newTp, newSl, dragSide);
    const { position, tpsl, tpslSaving, setTpslSaving, setTpsl, setOrderStatus, setDragTpsl,
            _refetchTpsl } = get();
    if (!position || tpslSaving) return;
    if (!newTp && !newSl) return;
    const positionSide = dragSide ?? (position.long ? "LONG" : "SHORT");
    const sideKey  = positionSide === "LONG" ? "long" : "short";
    const entrySide = positionToSide(positionSide);
    const activeTpsl = tpsl[sideKey] ?? { tp: null, sl: null };
    const body = { side: entrySide };
    if (newTp) { body.tp = newTp; body.tpOrderId = activeTpsl.tp?.orderId; body.tpIsAlgo = activeTpsl.tp?.isAlgo; }
    if (newSl) { body.sl = newSl; body.slOrderId = activeTpsl.sl?.orderId; body.slIsAlgo = activeTpsl.sl?.isAlgo; }
    setTpslSaving(true); setOrderStatus(null);
    try {
      const data = await api("PUT", "/api/tpsl", body);
      // ⚠ **분할 TP는 건드리지 않는다 — 단일 TP와 공존한다** (2026-08-23 사용자 확정).
      //   예전엔 여기서 `splitTps: []`로 비웠다 (백엔드가 취소했으므로). 되돌리지 말 것 —
      //   이유와 실측은 backend/routes/tpsl.js PUT의 주석
      setTpsl(prev => ({
        ...prev,
        [sideKey]: {
          ...prev[sideKey],
          tp: newTp ? data.tp : prev[sideKey]?.tp,
          sl: newSl ? data.sl : prev[sideKey]?.sl,
        },
      }));
      if (data.noSl) {
        setOrderStatus({ type: "error", msg: "⚠ SL 등록 실패 — 포지션에 SL이 없습니다! 즉시 수동 설정 필요" });
      } else {
        setOrderStatus({ type: "success", msg: "TP/SL 수정 완료" });
      }
      if (newTp) setTimeout(() => { _refetchTpsl(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `TP/SL 수정 실패: ${e.message}` });
    } finally {
      setTpslSaving(false);
      setDragTpsl(null);
    }
  },

  // 차트의 × 버튼 — 걸려 있는 TP 또는 SL 하나를 취소한다 (분할 TP는 cancelSplitTp)
  // ⚠ SL을 지우면 그 포지션은 무방비가 된다. 백엔드 reconcile이 60초 안에
  //   critical 알림을 띄우는데 **정상 동작**이다 (일부러 지운 것도 무방비는 무방비다)
  cancelTpsl: async (side, which) => {
    if (get().replayOn) return paperActions.cancelTpsl(get, side, which);
    const { tpsl, setTpsl, setOrderStatus, _refetchTpsl } = get();
    const sideKey = side === "LONG" ? "long" : "short";
    const target  = tpsl?.[sideKey]?.[which];
    if (!target?.orderId) return;
    const label = which.toUpperCase();
    setOrderStatus(null);
    try {
      await api("DELETE", "/api/tpsl", { orderId: target.orderId, isAlgo: target.isAlgo });
      setTpsl(prev => ({ ...prev, [sideKey]: { ...prev[sideKey], [which]: null } }));
      setOrderStatus({ type: "success", msg: `${side} ${label} 제거 완료` });
      setTimeout(() => { _refetchTpsl(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `${label} 제거 실패: ${e.message}` });
    }
  },

  updatePendingTpsl: async (isLong) => {
    if (get().replayOn) return paperActions.updatePendingTpsl(get, isLong);
    const { drawings, setOrderStatus } = get();
    const drawing = drawings[boxKey(isLong)];
    if (!drawing?.orderId) return;
    try {
      await api("PATCH", "/api/order", { orderId: drawing.orderId, tp: drawing.tp, sl: drawing.sl });
      setOrderStatus({ type: "success", msg: "미체결 주문 TP/SL 수정 완료" });
    } catch (e) {
      setOrderStatus({ type: "error", msg: `TP/SL 업데이트 실패: ${e.message}` });
    }
  },

  replacePendingOrder: async (isLong) => {
    if (get().replayOn) return paperActions.replacePendingOrder(get, isLong);
    const st = get();
    const { drawings, leverage, balance, position, setDrawing, setOrderStatus, _refetchPos, _refetchBal } = st;
    const drawing = drawings[boxKey(isLong)];
    if (!drawing?.orderId) return;
    const riskPct = riskPctFor(st, isLong);

    const sideKey = drawing.isLong ? "long" : "short";
    const pendingOrder = position?.pending?.[sideKey];
    const pendingMargin = (pendingOrder && pendingOrder.orderId === drawing.orderId)
      ? (pendingOrder.qty * pendingOrder.price) / leverage
      : 0;

    const capital = (balance?.availableBalance ?? 0) + pendingMargin;
    const posCalc = calcPosition(capital, riskPct / 100, drawing.entry, drawing.sl, leverage);
    if (!posCalc) return;
    setDrawing(isLong, prev => prev ? { ...prev, orderId: undefined } : prev);
    const cancelSide = isLongToPosition(drawing.isLong);
    try {
      // ⚠ 내 박스에 연결된 주문 **하나만** 취소한다 (2026-08-23). 사이드로만 지우면
      //   같은 사이드에 밖에서 낸 주문이 있을 때 그것까지 취소된다 (deleteBox와 같은 이유)
      await api("DELETE", "/api/orders", { side: cancelSide, orderId: drawing.orderId });
      const data = await api("POST", "/api/order", {
        side:      isLongToSide(drawing.isLong),
        orderType: "LIMIT",
        entry:     drawing.entry,
        tp:        drawing.tp,
        sl:        drawing.sl,
        quantity:  posCalc.actualQty,
        leverage,
        drawing: {
          tStart: drawing.tStart, tEnd: drawing.tEnd,
          pTop: drawing.pTop, pBot: drawing.pBot,
          isLong: drawing.isLong, entry: drawing.entry, tp: drawing.tp, sl: drawing.sl,
        },
      });
      setDrawing(isLong, prev => prev ? { ...prev, orderId: String(data.entry.orderId) } : prev);
      setOrderStatus({ type: "success", msg: `주문 수량 재설정 완료 (${posCalc.actualQty.toFixed(3)} BTC)` });
      setTimeout(() => { _refetchPos(); _refetchBal(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `주문 수정 실패: ${e.message}` });
    }
  },

  scaleIn: async (side, orderType, price, quantity) => {
    if (get().replayOn) return paperActions.scaleIn(get, side, orderType, price, quantity);
    const { setOrderStatus, _refetchPos } = get();
    setOrderStatus(null);
    try {
      await api("POST", "/api/scale-in", { side, orderType, price, quantity });
      const msg = orderType === "MARKET"
        ? "시장가 추가 진입 완료"
        : `지정가 추가 진입 등록 완료 ($${price?.toLocaleString()})`;
      setOrderStatus({ type: "success", msg });
      setTimeout(() => { _refetchPos(); }, 1000);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `추가 진입 실패: ${e.message}` });
    }
  },

  cancelScaleIn: async (orderId) => {
    if (get().replayOn) return paperActions.cancelScaleIn(get, orderId);
    const { setOrderStatus, _refetchPos } = get();
    setOrderStatus(null);
    try {
      await api("DELETE", "/api/scale-in", { orderId });
      setOrderStatus({ type: "success", msg: "추가 진입 주문 취소 완료" });
      setTimeout(() => { _refetchPos(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `취소 실패: ${e.message}` });
    }
  },

  moveScaleIn: async (orderId, newPrice) => {
    if (get().replayOn) return paperActions.moveScaleIn(get, orderId, newPrice);
    const { position, setOrderStatus, _refetchPos } = get();
    const target = (position?.scaleInOrders ?? []).find(o => o.orderId === orderId);
    if (!target) return;
    try {
      await api("DELETE", "/api/scale-in", { orderId });
      await api("POST", "/api/scale-in", { side: target.side, orderType: "LIMIT", price: newPrice, quantity: target.qty });
      setOrderStatus({ type: "success", msg: `추가 진입 가격 이동 완료 ($${newPrice?.toLocaleString()})` });
      setTimeout(() => { _refetchPos(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `추가 진입 이동 실패: ${e.message}` });
    }
  },

  addSplitTp: async (side, price, qty, pct) => {
    if (get().replayOn) return paperActions.addSplitTp(get, side, price, qty, pct);
    const { setOrderStatus, _refetchTpsl } = get();
    setOrderStatus(null);
    try {
      // ⚠ **기존 단일 TP를 내리지 않는다 — 둘은 공존한다** (2026-08-23 사용자 확정).
      //   예전엔 `tpOrderId`를 실어 보내 취소하게 하고 로컬 tp도 비웠다. 되돌리지 말 것
      await api("POST", "/api/tpsl/split", { side, price, qty, pct });
      setOrderStatus({ type: "success", msg: `분할 TP 등록 완료 (${price?.toLocaleString()})` });
      setTimeout(() => { _refetchTpsl(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `분할 TP 실패: ${e.message}` });
    }
  },

  // ── 분할 SL (수량 지정 STOP_MARKET) — 2026-08-24 ─────────────────────────
  //
  // ⚠ **전량 손절(`saveTpsl`)을 건드리지 않는다 — 공존한다.** 합계가 포지션을 채우면
  //   "덮였다"로 판정하므로(backend `coversPosition`) 전량 손절 없이 분할 SL만으로도 된다.
  //   다만 분할 SL은 수량이 고정이라 **추가 진입이 체결되면 덮는 비율이 떨어진다** —
  //   그때는 무방비 경보가 `일부만 덮습니다 (0.140 / 0.190)`으로 알려준다
  addPartialSl: async (side, price, qty) => {
    if (get().replayOn) return paperActions.addPartialSl(get, side, price, qty);
    const { setOrderStatus, _refetchTpsl } = get();
    setOrderStatus(null);
    try {
      await api("POST", "/api/tpsl/partial-sl", { side, price, qty });
      setOrderStatus({ type: "success", msg: `분할 SL 등록 완료 (${price?.toLocaleString()})` });
      setTimeout(() => { _refetchTpsl(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `분할 SL 실패: ${e.message}` });
    }
  },

  cancelPartialSl: async (orderId) => {
    if (get().replayOn) return paperActions.cancelPartialSl(get, orderId);
    const { setOrderStatus, _refetchTpsl } = get();
    setOrderStatus(null);
    try {
      await api("DELETE", "/api/tpsl/partial-sl", { orderId });
      setOrderStatus({ type: "success", msg: "분할 SL 취소 완료" });
      setTimeout(() => { _refetchTpsl(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `취소 실패: ${e.message}` });
    }
  },

  cancelSplitTp: async (orderId) => {
    if (get().replayOn) return paperActions.cancelSplitTp(get, orderId);
    const { setOrderStatus, _refetchTpsl } = get();
    setOrderStatus(null);
    try {
      await api("DELETE", "/api/tpsl/split", { orderId });
      setOrderStatus({ type: "success", msg: "분할 TP 취소 완료" });
      setTimeout(() => { _refetchTpsl(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `취소 실패: ${e.message}` });
    }
  },

  moveSplitTp: async (orderId, newPrice) => {
    if (get().replayOn) return paperActions.moveSplitTp(get, orderId, newPrice);
    const { tpsl, setOrderStatus, _refetchTpsl } = get();
    const allSplitTps = [...(tpsl.long?.splitTps ?? []), ...(tpsl.short?.splitTps ?? [])];
    const target = allSplitTps.find(o => o.orderId === orderId);
    if (!target) return;
    // target.side is close side: "SELL" = closing LONG, "BUY" = closing SHORT
    const side = closeToPosition(target.side);
    try {
      await api("DELETE", "/api/tpsl/split", { orderId });
      await api("POST", "/api/tpsl/split", {
        side, price: newPrice, qty: target.qty, pct: target.pct,
      });
      setOrderStatus({ type: "success", msg: `분할 TP 가격 이동 완료 ($${newPrice?.toLocaleString()})` });
      setTimeout(() => { _refetchTpsl(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `분할 TP 이동 실패: ${e.message}` });
    }
  },

  closePosition: async (side, quantity, partial = false) => {
    if (get().replayOn) return paperActions.closePosition(get, side, quantity, partial);
    const { setOrderStatus, _refetchBal, _refetchPos, _refetchTpsl } = get();
    setOrderStatus(null);
    try {
      await api("POST", "/api/close", { side, quantity: String(quantity), partial });
      setOrderStatus({ type: "success", msg: partial ? "부분 청산 완료" : "포지션 청산 완료" });
      setTimeout(() => { _refetchBal(); _refetchPos(); _refetchTpsl(); }, 1000);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `청산 실패: ${e.message}` });
    }
  },

  deleteBox: async (sideOverride) => {
    if (get().replayOn) return paperActions.deleteBox(get, sideOverride);
    const { drawings, position, setDrawing, setPosition, setOrderStatus } = get();
    // 사이드 결정 우선순위: 명시적 sideOverride > 박스가 하나뿐이면 그 사이드
    const only = (!!drawings.long) !== (!!drawings.short)
      ? (drawings.long ?? drawings.short) : null;
    const side = sideOverride ?? (only ? isLongToPosition(only.isLong) : undefined);
    // ⚠ 미체결 판정은 **그 사이드만** 본다 (2026-08-19). 예전엔 양쪽을 합쳐 봐서,
    //   숏 주문이 걸려 있으면 롱 박스를 지울 때도 취소 API를 불렀다.
    //   박스가 둘이 된 지금은 "숏 주문 때문에 롱 박스 삭제가 에러를 뱉는" 경로가 된다
    const sideKey = side === "LONG" ? "long" : side === "SHORT" ? "short" : null;
    const hasPending = !!(sideKey && position?.pending?.[sideKey]);
    if (hasPending) {
      if (!side) {
        setOrderStatus({ type: "error", msg: "취소할 사이드를 알 수 없습니다" });
        return;
      }
      try {
        // ⚠ **orderId를 실어 보낸다** (2026-08-23). 사이드로만 지우면 그 사이드의 진입
        //   주문이 싹 취소된다 — 밖에서 낸 주문이 같은 사이드에 있으면 그것까지 같이 날아간다
        await api("DELETE", "/api/orders", { side, orderId: position.pending[sideKey].orderId });
        setOrderStatus({ type: "success", msg: "미체결 주문 취소 완료" });
      } catch (e) {
        setOrderStatus({ type: "error", msg: `취소 실패: ${e.message}` }); return;
      }
    }
    // 취소한 사이드의 박스만 지운다 — 반대쪽 플랜은 그대로 둔다
    if (sideKey && drawings[sideKey]) setDrawing(side === "LONG", null);
    setPosition(prev => {
      if (!prev?.pending) return prev;
      if (side === "LONG")  return { ...prev, pending: { ...prev.pending, long:  null } };
      if (side === "SHORT") return { ...prev, pending: { ...prev.pending, short: null } };
      return prev;
    });
  },
});
