import { calcPosition } from "../utils/calc";
import { calcRR }       from "../utils/format";
import { api }          from "../api/client";

export const createOrderSlice = (set, get) => ({

  openConfirm: async () => {
    const { drawing, leverage, riskPct, balance, setConfirmInfo, setOrderStatus } = get();
    if (!drawing) return;
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
    setConfirmInfo({
      ...drawing, leverage,
      qty:              posCalc.actualQty.toFixed(3),
      usd:              posCalc.actualQty * drawing.entry,
      idealRiskPct:     posCalc.idealRiskPct,
      actualRiskPct:    posCalc.actualRiskPct,
      actualLoss:       posCalc.actualQty * Math.abs(drawing.entry - drawing.sl),
      actualProfit:     posCalc.actualQty * Math.abs(drawing.tp - drawing.entry),
      isMinCapped:      posCalc.isMinCapped,
      isLeverageCapped: posCalc.isLeverageCapped,
      rrRatio:          calcRR(drawing.entry, drawing.tp, drawing.sl, drawing.isLong),
    });
  },

  executeOrder: async (orderType) => {
    const { drawing, leverage, confirmInfo, setConfirmInfo, setOrderStatus, setDrawing, _refetchBal, _refetchPos } = get();
    if (!drawing || !confirmInfo) return;
    const qty = parseFloat(confirmInfo.qty);
    if (!qty || qty <= 0) return;
    setConfirmInfo(null); setOrderStatus(null);
    try {
      const drawingPayload = orderType === "LIMIT" ? {
        tStart: drawing.tStart, tEnd: drawing.tEnd,
        pTop: drawing.pTop, pBot: drawing.pBot,
        isLong: drawing.isLong, entry: drawing.entry, tp: drawing.tp, sl: drawing.sl,
      } : undefined;
      const data = await api("POST", "/api/order", {
        side:     drawing.isLong ? "BUY" : "SELL",
        orderType,
        entry:    drawing.entry,
        tp:       drawing.tp,
        sl:       drawing.sl,
        quantity: qty,
        leverage,
        drawing:  drawingPayload,
      });
      if (orderType === "LIMIT") {
        setDrawing(prev => prev ? { ...prev, orderId: String(data.entry.orderId) } : prev);
      }
      if (orderType === "MARKET") setDrawing(null);
      if (data.warning) {
        setOrderStatus({ type: "error", msg: `⚠ 진입 체결됨, ${data.warning}` });
      } else {
        setOrderStatus({ type: "success", msg: data.message || "주문 완료 — 진입 / TP / SL 전송됨" });
      }
      setTimeout(() => { _refetchBal(); _refetchPos(); }, 1500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: e.message });
    }
  },

  saveTpsl: async (newTp, newSl) => {
    const { position, tpsl, tpslSaving, setTpslSaving, setTpsl, setOrderStatus, setDragTpsl } = get();
    if (!position || tpslSaving) return;
    if (!newTp && !newSl) return;
    const side = position.side === "LONG" ? "BUY" : "SELL";
    const body = { side };
    if (newTp) { body.tp = newTp; body.tpOrderId = tpsl.tp?.orderId; body.tpIsAlgo = tpsl.tp?.isAlgo; }
    if (newSl) { body.sl = newSl; body.slOrderId = tpsl.sl?.orderId; body.slIsAlgo = tpsl.sl?.isAlgo; }
    setTpslSaving(true); setOrderStatus(null);
    try {
      const data = await api("PUT", "/api/tpsl", body);
      setTpsl({
        tp:       newTp ? data.tp : tpsl.tp,
        sl:       newSl ? data.sl : tpsl.sl,
        splitTps: tpsl.splitTps ?? [],
      });
      if (data.noSl) {
        setOrderStatus({ type: "error", msg: "⚠ SL 등록 실패 — 포지션에 SL이 없습니다! 즉시 수동 설정 필요" });
      } else {
        setOrderStatus({ type: "success", msg: "TP/SL 수정 완료" });
      }
    } catch (e) {
      setOrderStatus({ type: "error", msg: `TP/SL 수정 실패: ${e.message}` });
    } finally {
      setTpslSaving(false);
      setDragTpsl(null);
    }
  },

  updatePendingTpsl: async () => {
    const { drawing, setOrderStatus } = get();
    if (!drawing?.orderId) return;
    try {
      await api("PATCH", "/api/order", { orderId: drawing.orderId, tp: drawing.tp, sl: drawing.sl });
      setOrderStatus({ type: "success", msg: "미체결 주문 TP/SL 수정 완료" });
    } catch (e) {
      setOrderStatus({ type: "error", msg: `TP/SL 업데이트 실패: ${e.message}` });
    }
  },

  replacePendingOrder: async () => {
    const { drawing, leverage, riskPct, balance, setDrawing, setOrderStatus, _refetchPos, _refetchBal } = get();
    if (!drawing?.orderId) return;
    const capital = balance?.availableBalance ?? 0;
    const posCalc = calcPosition(capital, riskPct / 100, drawing.entry, drawing.sl, leverage);
    if (!posCalc) return;
    setDrawing(prev => prev ? { ...prev, orderId: undefined } : prev);
    try {
      await api("DELETE", "/api/orders");
      const data = await api("POST", "/api/order", {
        side:      drawing.isLong ? "BUY" : "SELL",
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
      setDrawing(prev => prev ? { ...prev, orderId: String(data.entry.orderId) } : prev);
      setOrderStatus({ type: "success", msg: `주문 수량 재설정 완료 (${posCalc.actualQty.toFixed(3)} BTC)` });
      setTimeout(() => { _refetchPos(); _refetchBal(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `주문 수정 실패: ${e.message}` });
    }
  },

  scaleIn: async (side, orderType, price, quantity) => {
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

  addSplitTp: async (price, qty, pct) => {
    const { position, tpsl, setTpsl, setOrderStatus, _refetchTpsl } = get();
    setOrderStatus(null);
    try {
      const side = position.side;
      const tpOrderId = tpsl.tp?.orderId ?? null;
      const tpIsAlgo  = tpsl.tp?.isAlgo  ?? false;
      await api("POST", "/api/tpsl/split", { side, price, qty, pct, tpOrderId, tpIsAlgo });
      if (tpOrderId) setTpsl(prev => ({ ...prev, tp: null }));
      setOrderStatus({ type: "success", msg: `분할 TP 등록 완료 ($${price?.toLocaleString()})` });
      setTimeout(() => { _refetchTpsl(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `분할 TP 실패: ${e.message}` });
    }
  },

  cancelSplitTp: async (orderId) => {
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
    const { tpsl, position, setOrderStatus, _refetchTpsl } = get();
    const target = (tpsl.splitTps ?? []).find(o => o.orderId === orderId);
    if (!target) return;
    try {
      await api("DELETE", "/api/tpsl/split", { orderId });
      await api("POST", "/api/tpsl/split", {
        side: position.side, price: newPrice, qty: target.qty, pct: target.pct,
      });
      setOrderStatus({ type: "success", msg: `분할 TP 가격 이동 완료 ($${newPrice?.toLocaleString()})` });
      setTimeout(() => { _refetchTpsl(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `분할 TP 이동 실패: ${e.message}` });
    }
  },

  swapPosition: async (lastPrice) => {
    const { leverage, setOrderStatus, setCriticalAlert, setDrawing, _refetchBal, _refetchPos, _refetchTpsl } = get();
    setOrderStatus(null);
    try {
      const data = await api("POST", "/api/swap", { lastPrice, leverage });
      setDrawing(null);
      const dir = data.newSide === "LONG" ? "SHORT → LONG" : "LONG → SHORT";
      const msg = data.warning
        ? `스왑 완료 (${dir}) — ⚠ ${data.warning}`
        : `스왑 완료 (${dir}) — TP $${data.tp.toLocaleString()} / SL $${data.sl.toLocaleString()}`;
      setOrderStatus({ type: data.warning ? "error" : "success", msg });
      setTimeout(() => { _refetchBal(); _refetchPos(); _refetchTpsl(); }, 1000);
    } catch (e) {
      if (e.message?.includes("청산 완료, 반대 진입 실패")) {
        setCriticalAlert("청산은 완료됐지만 반대 진입 실패 — 수동 진입 필요");
        setDrawing(null);
        setTimeout(() => { _refetchBal(); _refetchPos(); _refetchTpsl(); }, 1000);
      } else {
        setOrderStatus({ type: "error", msg: `스왑 실패: ${e.message}` });
      }
    }
  },

  closePosition: async (side, quantity, partial = false) => {
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

  deleteBox: async () => {
    const { position, setDrawing, setPosition, setOrderStatus } = get();
    if (position?.pending) {
      try {
        await api("DELETE", "/api/orders");
        setOrderStatus({ type: "success", msg: "미체결 주문 취소 완료" });
      } catch (e) {
        setOrderStatus({ type: "error", msg: `취소 실패: ${e.message}` }); return;
      }
    }
    setDrawing(null);
    setPosition(prev => prev?.open ? { ...prev, pending: null } : { open: false, pending: null });
  },
});
