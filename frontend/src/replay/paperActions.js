// 리플레이 주문 처리 — orderSlice의 각 액션을 페이퍼 브로커로 갈아끼운다
//
// ── 왜 orderSlice 안에 안 넣었나 ─────────────────────────────────────────
// orderSlice의 액션이 12개인데 전부 `if (replayOn) { … }`를 앞에 달면 파일이
// 두 배가 되고, 실거래 경로를 읽을 때 페이퍼 코드가 계속 끼어든다.
// 여기 같은 이름으로 모아 두고 orderSlice는 **한 줄로 위임**한다.
//
// ⚠ 함수 이름을 orderSlice의 액션 이름과 **똑같이 유지할 것.** 다르면
//   어느 실거래 액션에 대응하는 페이퍼 경로인지 대조가 안 된다.
//
// ⚠ 여기 없는 액션은 페이퍼 처리가 없다는 뜻이고, 그 경우 api()의 가드가
//   에러를 던진다(api/client.js). 조용히 실주문이 나가는 일은 없다.

import { calcPosition } from "../utils/calc";
import { isLongToPosition, closeToPosition } from "../utils/side";
import { computePaperDailyLoss } from "./dailyLoss";
import { riskPctFor } from "../store/settingsSlice";
import { boxKey } from "../store/uiSlice";

const ok = (get, msg) => {
  get().syncPaper();
  // 주문으로 바뀐 계좌도 저장한다 — 안 그러면 새로고침 시 마지막 틱 시점으로 되돌아가
  // 방금 낸 주문이 사라진다 (replay/session.js)
  get().scheduleReplaySave?.();
  get().setOrderStatus({ type: "success", msg });
};
// ⚠ **무엇이 실패했는지 앞에 적는다** (2026-08-25 사용자 요청). 예전엔 `e.message`만
//   띄워서, 진입 실패와 추가 진입 실패가 **똑같이 `수량이 0입니다`**로 떴다
//   (paperBroker가 두 곳에서 같은 문구를 던진다). 실거래는 `추가 진입 실패: …`처럼
//   갈리므로, 이름을 안 붙이면 **연습만 실거래보다 덜 친절해진다**.
//   `what`은 실거래 orderSlice의 같은 액션이 쓰는 이름과 맞출 것
const err = (get, e, what) => get().setOrderStatus({
  type: "error", msg: what ? `${what}: ${e.message}` : e.message,
});

export const paperActions = {

  executeOrder: (get, orderType, isLong) => {
    const st = get();
    const { drawings, leverage, balance, paperBroker, setDrawing, replayNowMs } = st;
    const drawing = drawings[boxKey(isLong)];
    if (!drawing || !paperBroker) return;
    // 실거래와 같은 규칙 — 리스크 %는 사이드별이다 (settingsSlice.riskPctFor).
    // 연습에서만 한쪽 값을 쓰면 같은 플랜이 모드에 따라 다른 수량으로 나간다
    const riskPct = riskPctFor(st, isLong);

    // ⚠ 일일 손실 한도는 **연습에도 건다.** 이 앱의 핵심 리스크 규칙인데
    //   연습에서만 무제한이면, 실전에서 막히는 매매를 계속 연습하게 되어
    //   정작 옮겨가야 할 습관이 안 생긴다 (replay/dailyLoss.js)
    const dl = computePaperDailyLoss(
      paperBroker.trades, paperBroker.startBalance, paperBroker.balance, replayNowMs);
    if (dl && dl.remaining <= 0) {
      get().setOrderStatus({ type: "error", msg: "일일 손실 한도 초과 — 연습 매매가 제한됩니다" });
      return;
    }

    const capital = balance?.availableBalance ?? 0;
    const posCalc = calcPosition(capital, riskPct / 100, drawing.entry, drawing.sl, leverage);
    if (!posCalc?.actualQty) {
      get().setOrderStatus({ type: "error", msg: "수량 계산 실패 — 잔고나 손절 폭을 확인하세요" });
      return;
    }
    try {
      const r = paperBroker.placeEntry({
        positionSide: isLongToPosition(drawing.isLong),
        orderType,
        entry: drawing.entry, tp: drawing.tp, sl: drawing.sl,
        qty: posCalc.actualQty, leverage,
      });
      if (orderType === "LIMIT") setDrawing(isLong, prev => prev ? { ...prev, orderId: r.orderId } : prev);
      else setDrawing(isLong, null);
      ok(get, `연습 주문 완료 (${posCalc.actualQty.toFixed(3)} BTC)`);
    } catch (e) { err(get, e, "연습 주문 실패"); }
  },

  saveTpsl: (get, newTp, newSl, dragSide) => {
    const { position, paperBroker, setDragTpsl } = get();
    if (!paperBroker) return;
    const positionSide = dragSide ?? (position?.long ? "LONG" : "SHORT");
    try {
      paperBroker.setTpsl(positionSide, { tp: newTp, sl: newSl });
      ok(get, "TP/SL 수정 완료");
    } catch (e) { err(get, e, "TP/SL 수정 실패"); }
    finally { setDragTpsl(null); }
  },

  cancelTpsl: (get, side, which) => {
    const { paperBroker } = get();
    if (!paperBroker?.tpsl?.[side]) return;
    paperBroker.tpsl[side][which] = null;
    ok(get, `${side} ${which.toUpperCase()} 제거 완료`);
  },

  updatePendingTpsl: (get, isLong) => {
    const { drawings, paperBroker } = get();
    const drawing = drawings[boxKey(isLong)];
    if (!drawing?.orderId || !paperBroker) return;
    for (const side of ["LONG", "SHORT"]) {
      const p = paperBroker.pending[side];
      if (p && p.orderId === drawing.orderId) {
        p.tp = drawing.tp; p.sl = drawing.sl;
      }
    }
    ok(get, "미체결 주문 TP/SL 수정 완료");
  },

  // 리스크·레버리지를 바꾸면 미체결 주문을 지우고 새 수량으로 다시 건다
  replacePendingOrder: (get, isLong) => {
    const { drawings, paperBroker, setDrawing } = get();
    const drawing = drawings[boxKey(isLong)];
    if (!drawing?.orderId || !paperBroker) return;
    const positionSide = isLongToPosition(isLong);
    paperBroker.cancelPending(positionSide);
    setDrawing(isLong, prev => prev ? { ...prev, orderId: undefined } : prev);
    paperActions.executeOrder(get, "LIMIT", isLong);
  },

  scaleIn: (get, side, orderType, price, quantity) => {
    const { paperBroker } = get();
    if (!paperBroker) return;
    try {
      paperBroker.addScaleIn({ positionSide: side, orderType, price, qty: quantity });
      ok(get, orderType === "MARKET" ? "시장가 추가 진입 완료" : `지정가 추가 진입 등록 ($${price?.toLocaleString()})`);
    } catch (e) { err(get, e, "추가 진입 실패"); }
  },

  cancelScaleIn: (get, orderId) => {
    get().paperBroker?.cancelScaleIn(orderId);
    ok(get, "추가 진입 주문 취소 완료");
  },

  moveScaleIn: (get, orderId, newPrice) => {
    const { position, paperBroker } = get();
    if (!paperBroker) return;
    const target = (position?.scaleInOrders ?? []).find(o => o.orderId === orderId);
    if (!target) return;
    paperBroker.cancelScaleIn(orderId);
    paperBroker.addScaleIn({
      positionSide: target.side === "BUY" ? "LONG" : "SHORT",
      orderType: "LIMIT", price: newPrice, qty: target.qty,
    });
    ok(get, `추가 진입 가격 이동 ($${newPrice?.toLocaleString()})`);
  },

  addSplitTp: (get, side, price, qty, pct) => {
    const { paperBroker } = get();
    if (!paperBroker) return;
    paperBroker.addSplitTp({ positionSide: side, price, qty, pct });
    ok(get, `분할 TP 등록 ($${price?.toLocaleString()})`);
  },

  addPartialSl: (get, side, price, qty) => {
    const { paperBroker } = get();
    if (!paperBroker) return;
    paperBroker.addPartialSl({ positionSide: side, price, qty });
    ok(get, `분할 SL 등록 ($${price?.toLocaleString()})`);
  },

  movePartialSl: (get, orderId, newPrice) => {
    const { tpsl, paperBroker } = get();
    if (!paperBroker) return;
    const all = [...(tpsl.long?.partialSls ?? []), ...(tpsl.short?.partialSls ?? [])];
    const target = all.find(o => o.orderId === orderId);
    if (!target) return;
    paperBroker.cancelPartialSl(orderId);
    paperBroker.addPartialSl({
      positionSide: target.positionSide, price: newPrice, qty: target.qty,
    });
    ok(get, `분할 SL 가격 이동 ($${newPrice?.toLocaleString()})`);
  },

  cancelPartialSl: (get, orderId) => {
    get().paperBroker?.cancelPartialSl(orderId);
    ok(get, "분할 SL 취소 완료");
  },

  cancelSplitTp: (get, orderId) => {
    get().paperBroker?.cancelSplitTp(orderId);
    ok(get, "분할 TP 취소 완료");
  },

  moveSplitTp: (get, orderId, newPrice) => {
    const { tpsl, paperBroker } = get();
    if (!paperBroker) return;
    const all = [...(tpsl.long?.splitTps ?? []), ...(tpsl.short?.splitTps ?? [])];
    const target = all.find(o => o.orderId === orderId);
    if (!target) return;
    paperBroker.cancelSplitTp(orderId);
    paperBroker.addSplitTp({
      positionSide: closeToPosition(target.side),
      price: newPrice, qty: target.qty, pct: target.pct,
    });
    ok(get, `분할 TP 가격 이동 ($${newPrice?.toLocaleString()})`);
  },

  closePosition: (get, side, quantity, partial) => {
    const { paperBroker } = get();
    if (!paperBroker) return;
    paperBroker.close(side, partial ? Number(quantity) : undefined);
    ok(get, partial ? "부분 청산 완료" : "포지션 청산 완료");
  },

  deleteBox: (get, sideOverride) => {
    const { drawings, paperBroker, setDrawing } = get();
    if (!paperBroker) return;
    // 실거래(orderSlice.deleteBox)와 **같은 규칙** — 박스가 하나뿐일 때만 사이드를 추론한다
    const only = (!!drawings.long) !== (!!drawings.short)
      ? (drawings.long ?? drawings.short) : null;
    const side = sideOverride ?? (only ? isLongToPosition(only.isLong) : undefined);
    if (!side) return;
    paperBroker.cancelPending(side);
    const sideKey = side === "LONG" ? "long" : "short";
    if (drawings[sideKey]) setDrawing(side === "LONG", null);
    ok(get, "미체결 주문 취소 완료");
  },
};
