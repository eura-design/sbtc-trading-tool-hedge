import { qtyLabel } from "../utils/qty";
import { calcPosition }  from "../utils/calc";
import { api }           from "../api/client";
import { closeToPosition, positionToSide, isLongToPosition, isLongToSide } from "../utils/side";
import { paperActions }  from "../replay/paperActions";
import { riskPctFor }   from "./settingsSlice";
import { boxKey }       from "./uiSlice";
import { splitPlan }    from "../utils/splitLevels";

// 리플레이(페이퍼) 모드면 같은 이름의 페이퍼 핸들러로 넘긴다.
// 각 액션 첫 줄에서 한 번만 갈라지므로 아래 실거래 코드는 원래대로 읽힌다.
// ⚠ 새 주문 액션을 추가하면 **이 위임 한 줄도 같이 넣을 것.** 빠뜨리면 리플레이
//   중에 그 액션만 실계좌로 가려다 api() 가드에 막혀 에러가 난다 (조용히 나가지는 않는다).

// 분할 주문 종류의 화면 이름 — 성공·실패 문구가 **어느 카드 얘기인지** 말해야 한다
// (취소 실패 문구를 넷 다 다르게 둔 것과 같은 이유 — cancelScaleIn 주석)
const KIND_LABEL = { scale_in: "추가 진입", split_tp: "분할 TP", partial_sl: "분할 SL" };

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
    const { step, minQty, tick, minNotional } = get().symbolFilters;
    const posCalc = calcPosition(capital, riskPct / 100, drawing.entry, drawing.sl, leverage, step, minQty, tick, minNotional);
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
      // 성공 쪽(`${side} ${label} 제거 완료`)과 같이 **사이드를 밝힌다** — 헷지모드라
      // 롱·숏 카드가 나란히 있어서, 사이드가 없으면 어느 쪽 손절이 안 지워졌는지 모른다
      setOrderStatus({ type: "error", msg: `${side} ${label} 제거 실패: ${e.message}` });
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
    const { step, minQty, tick, minNotional } = get().symbolFilters;
    const posCalc = calcPosition(capital, riskPct / 100, drawing.entry, drawing.sl, leverage, step, minQty, tick, minNotional);
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
      setOrderStatus({ type: "success", msg: `주문 수량 재설정 완료 (${qtyLabel(posCalc.actualQty, step, get().symbolFilters.base)})` });
      setTimeout(() => { _refetchPos(); _refetchBal(); }, 500);
    } catch (e) {
      setOrderStatus({ type: "error", msg: `주문 수정 실패: ${e.message}` });
    }
  },

  // ⚠ **`side`는 포지션 방향(LONG/SHORT)이다** (2026-08-27에 바꿨다).
  //   `addSplitTp`·`addPartialSl`과 같은 형식이라 셋을 나란히 부를 수 있다
  //   (`placeSplitOrders`가 그렇게 쓴다).
  //
  //   ⚠ **`POST /api/scale-in`만 주문 방향(BUY/SELL)을 받는다** — 그 라우트가
  //     `sideToPosition(side)`로 되돌리기 때문이다. 그래서 **여기서 변환한다.**
  //     예전엔 부르는 쪽(ScaleInCard)이 `isLongToSide()`로 미리 바꿔서 넘겼는데,
  //     그 탓에 실제로 두 가지가 깨져 있었다:
  //       ① `placeSplitOrders`가 다른 둘과 같은 형식으로 넘겨 **거래소가
  //          `Invalid side`로 전부 거절**했다 (2026-08-27 실측)
  //       ② **연습 모드가 조용히 망가져 있었다** — `paperActions.scaleIn`은
  //          받은 값을 `positionSide`로 그대로 쓰는데(paperBroker.addScaleIn),
  //          `"BUY"`가 들어가 `pos["BUY"]`라는 없는 포지션이 만들어졌다
  //   ⚠ 이 파일의 액션들끼리 형식을 갈라 놓지 말 것 — 라우트마다 다른 것은
  //     **여기서 흡수한다**. CLAUDE.md의 `orderSide와 posSide를 섞지 말 것`이
  //     정확히 이 함정이다
  scaleIn: async (side, orderType, price, quantity) => {
    if (get().replayOn) return paperActions.scaleIn(get, side, orderType, price, quantity);
    const { setOrderStatus, _refetchPos } = get();
    setOrderStatus(null);
    try {
      await api("POST", "/api/scale-in", { side: positionToSide(side), orderType, price, quantity });
      const msg = orderType === "MARKET"
        ? "시장가 추가 진입 완료"
        : `지정가 추가 진입 등록 완료 ($${price?.toLocaleString()})`;
      setOrderStatus({ type: "success", msg });
      setTimeout(() => { _refetchPos(); }, 1000);
      return true;
    } catch (e) {
      setOrderStatus({ type: "error", msg: `추가 진입 실패: ${e.message}` });
      return false;
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
      // ⚠ **실패 문구에도 무엇을 취소하려던 것인지 적는다** (2026-08-25 사용자 요청).
      //   취소는 네 군데(추가 진입·분할 TP·분할 SL·미체결 주문)에서 부르는데
      //   예전엔 전부 `취소 실패: …`라 **배너만 보고는 어느 카드를 열어야 할지 알 수 없었다**.
      //   성공 쪽은 이미 넷이 다 다른 이름이었다 — 정작 확인이 필요한 실패만 뭉뚱그려져 있었다.
      //   다시 `취소 실패:`로 합치지 말 것 (넷 다 같은 규칙으로 유지)
      setOrderStatus({ type: "error", msg: `추가 진입 주문 취소 실패: ${e.message}` });
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
      return true;
    } catch (e) {
      setOrderStatus({ type: "error", msg: `분할 TP 실패: ${e.message}` });
      return false;
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
      return true;
    } catch (e) {
      setOrderStatus({ type: "error", msg: `분할 SL 실패: ${e.message}` });
      return false;
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
      setOrderStatus({ type: "error", msg: `분할 SL 취소 실패: ${e.message}` });
    }
  },

  // 가격 이동 = 취소 후 재등록 (주문번호가 바뀐다) — moveSplitTp와 같은 방식
  movePartialSl: async (orderId, newPrice) => {
    if (get().replayOn) return paperActions.movePartialSl(get, orderId, newPrice);
    const { tpsl, setOrderStatus, _refetchTpsl } = get();
    const all = [...(tpsl.long?.partialSls ?? []), ...(tpsl.short?.partialSls ?? [])];
    const target = all.find(o => o.orderId === orderId);
    if (!target) return;
    const side = target.positionSide;   // 백엔드·페이퍼가 같이 실어 보낸다
    // ⚠ **새로 걸고 나서 옛것을 취소한다 — 순서를 뒤집지 말 것** (2026-08-24).
    //   `moveSplitTp`(분할 TP)는 취소부터 하는데, 손절에 그러면 **드래그 한 번 잘못한 걸로
    //   손절이 사라진다.** 잘못된 쪽(롱은 현재가 위)에 놓으면 바이낸스가 -2021 로 거절하는데,
    //   그때 이미 옛 주문은 지워진 뒤다. 3초 뒤 선이 화면에서 없어지고, 그게 유일한
    //   손절이었으면 15초 뒤 무방비 경보가 뜬다.
    //   이 순서면 **거절당해도 옛 손절이 그대로 남는다** — 실패해도 보호가 줄지 않는다
    //   (부분 청산의 분할 SL 재조정도 같은 이유로 같은 순서다 — backend/routes/close.js 3-2)
    // ⚠ 겹치는 순간이 생기지만 무해하다: 청산 방향이라 포지션보다 많이는 못 판다
    try {
      await api("POST", "/api/tpsl/partial-sl", { side, price: newPrice, qty: target.qty });
    } catch (e) {
      setOrderStatus({ type: "error", msg: `분할 SL 이동 실패 (기존 손절은 그대로): ${e.message}` });
      setTimeout(() => { _refetchTpsl(); }, 500);   // 선을 원래 자리로 되돌린다
      return;
    }
    try {
      await api("DELETE", "/api/tpsl/partial-sl", { orderId });
      setOrderStatus({ type: "success", msg: `분할 SL 가격 이동 완료 ($${newPrice?.toLocaleString()})` });
    } catch (e) {
      // 옛것이 안 지워졌다 — 손절이 둘이 되지만 과하게 덮는 쪽이라 위험하진 않다
      setOrderStatus({ type: "error", msg: `옛 분할 SL 취소 실패 — 목록에서 직접 지우세요: ${e.message}` });
    }
    setTimeout(() => { _refetchTpsl(); }, 500);
  },

  // ── 차트에서 지정한 구간에 분할 주문 (2026-08-27 사용자 요청) ────────────
  //
  // `p1 → p2` 구간에 `count`개를 균등 배치하고 `totalQty`를 나눠 담는다.
  // **클릭이면 p1 === p2 · count === 1**이라 같은 길로 한 개가 나간다 —
  // 한 개와 여러 개를 다른 코드로 만들지 말 것 (미리보기와 실제가 갈라진다).
  //
  // ⚠ 가격·수량 배분은 `utils/splitLevels.js` 하나가 정한다 — 차트 미리보기가
  //   같은 함수를 부른다. 각자 계산하면 화면에 뜬 것과 나가는 것이 어긋나고,
  //   그 어긋남은 **체결된 뒤에야** 보인다
  //
  // ⚠ 리플레이 위임은 각 종류의 **기존 단건 액션**이 이미 갖고 있다 —
  //   여기서 다시 갈라지지 않는다. 아래 `place`가 그 액션들을 부르므로
  //   연습 모드에서도 페이퍼 브로커로 그대로 흘러간다
  placeSplitOrders: async (kind, side, p1, p2, count, totalQty) => {
    const st = get();
    const { position, liveClose, setOrderStatus, scaleIn, addSplitTp, addPartialSl } = st;
    const isLong = side === "LONG";
    const posData = isLong ? position?.long : position?.short;

    // ⚠ `splitOrders`가 아니라 **`splitPlan`**이다 — 큰 조각이 갈 쪽은 **사이드와
    //   종류**가 정한다(기준가에서 먼 쪽). `splitOrders`를 직접 부르면 **드래그를
    //   어느 끝에서 시작했느냐로 배분이 갈린다** (2026-08-27에 고친 버그)
    // ⚠ 수량 단위는 심볼의 것을 쓴다 — 안 넘기면 splitLevels가 BTCUSDT의 0.001로
    //   쪼개서, DOGE(단위 1)에서는 나갈 수 없는 조각이 만들어진다
    const { step: qStep, base: qBase } = get().symbolFilters;
    const orders = splitPlan(p1, p2, count, totalQty, isLong, kind, qStep);
    if (!orders.length) {
      setOrderStatus({ type: "error", msg: `수량이 최소 단위(${qStep} ${qBase})보다 작습니다` });
      return;
    }

    // ── 방향 검증 ───────────────────────────────────────────────────────────
    // ⚠ **주문을 내는 이 자리에서 한다.** 차트 쪽에 두면 현재가를 계속 봐야 해서
    //   오버레이가 매 틱 리렌더되고(uiSlice.orderPick 주석), 무엇보다 버튼을 누른
    //   시점과 손을 뗀 시점 사이에 가격이 움직인다 — 그때 값으로 재야 맞다
    // ⚠ 기준이 종류마다 다르다: 추가 진입·분할 SL은 **현재가**, 분할 TP는 **진입가**.
    //   앞의 둘은 그 방향이 아니면 거래소가 -2021로 거절하거나(트리거) 즉시
    //   체결되고(지정가), 분할 TP는 진입가 반대편이면 애초에 익절이 아니다
    const mark = liveClose || 0;
    // ⚠ 기준값이 없으면 **판정을 건너뛰지 말고 거절한다.** 예전 방식대로 0으로 두면
    //   롱은 "0보다 크다"가 늘 참이라 전부 걸러지고(사유가 엉뚱하다), 숏은 반대로
    //   **전부 통과해서** 잘못된 쪽에 주문이 나간다 — 조용히 나가는 쪽이 훨씬 나쁘다
    if (kind === "split_tp" ? !(posData?.entryPrice > 0) : !(mark > 0)) {
      setOrderStatus({ type: "error",
        msg: `${KIND_LABEL[kind]} — ${kind === "split_tp" ? "진입가" : "현재가"}를 아직 못 읽었습니다` });
      return;
    }
    const bad = orders.find(o => {
      if (kind === "split_tp") return isLong ? o.price <= posData.entryPrice
                                             : o.price >= posData.entryPrice;
      return isLong ? o.price >= mark : o.price <= mark;
    });
    if (bad) {
      const where = kind === "split_tp"
        ? (isLong ? "진입가보다 높은" : "진입가보다 낮은")
        : (isLong ? "현재가보다 낮은" : "현재가보다 높은");
      setOrderStatus({ type: "error", msg: `${KIND_LABEL[kind]}는 ${where} 쪽에만 걸 수 있습니다` });
      return;
    }

    setOrderStatus(null);
    const place = (o) => {
      if (kind === "scale_in")  return scaleIn(side, "LIMIT", o.price, o.qty);
      if (kind === "split_tp")  return addSplitTp(side, o.price, o.qty,
                                    posData?.size > 0 ? Math.round((o.qty / posData.size) * 100) : 0);
      return addPartialSl(side, o.price, o.qty);
    };

    // ⚠ **순차로 보낸다.** 한꺼번에 쏘면 ① 거래소 가중치가 몰리고 ② 추가 진입은
    //   각각 증거금을 묶으므로 동시에 보내면 서로의 잔고를 모른 채 접수된다.
    //   ③ 어디까지 나갔는지도 알 수 없어 실패 보고가 부정확해진다
    // ⚠ **반환값으로 판정한다 — try/catch로는 못 잡는다.** 세 액션은 실패를
    //   안에서 에러 배너로 처리하고 예외를 밖으로 던지지 않는다. 예외만 보면
    //   전부 실패해도 `done`이 요청 개수와 같아져 **"3개 등록 완료"로 거짓 보고**된다
    let done = 0;
    for (const o of orders) {
      if (!(await place(o))) break;
      done++;
    }
    // ⚠ **몇 개가 실제로 나갔는지 반드시 알린다.** 중간에 끊기면 화면엔 걸린 것만
    //   보이는데, 사용자는 요청한 개수가 다 나간 줄 안다 — 나머지를 다시 걸어야 한다
    setOrderStatus(done === orders.length
      ? { type: "success", msg: `${KIND_LABEL[kind]} ${done}개 등록 완료` }
      : { type: "error",   msg: `${KIND_LABEL[kind]} ${orders.length}개 중 ${done}개만 등록됐습니다` });
  },

  /**
   * 카드의 `전체 취소` — 그 **사이드**의 그 **종류** 주문을 모두 취소한다
   * (2026-08-27 사용자 요청). `placeSplitOrders`의 짝이라 인자 모양도 같다.
   *
   * ⚠ **셋을 각각의 액션으로 나누지 말 것.** 하는 일이 글자 그대로 같고
   *   달라지는 건 목록을 어디서 뽑느냐와 어느 경로로 지우느냐 둘뿐이다
   *   (`movePriceDrag`가 마커 셋을 한 벌로 묶은 것과 같은 이유)
   * ⚠ **id는 스토어에서 뽑는다** — 카드가 넘긴 목록을 그대로 믿으면, 카드가
   *   사이드를 잘못 거른 순간 **반대쪽 주문이 조용히 날아간다**
   * ⚠ 백엔드에 일괄 취소 라우트를 만들지 않았다. 기존 단건 취소가 이미
   *   종류 검증(`assertCancelKind`)·사전 TP/SL 정리·store 정리·기록을 다 한다 —
   *   여기서 **개수만큼 순서대로 부르면 그게 전부 그대로 돌아간다**
   */
  cancelSplitOrders: async (kind, side) => {
    if (get().replayOn) return paperActions.cancelSplitOrders(get, kind, side);
    const { position, tpsl, setOrderStatus, _refetchPos, _refetchTpsl } = get();
    const sideKey = side === "LONG" ? "long" : "short";

    // 추가 진입만 사이드가 **주문 방향**(BUY/SELL)으로 들어 있다 — 분할 TP/SL은
    // `tpsl[사이드]` 아래에 이미 갈려 있다 (routes/tpsl.js가 갈라서 준다)
    const ids =
      kind === "scale_in" ? (position?.scaleInOrders ?? [])
                              .filter(o => o.side === positionToSide(side))
                              .map(o => o.orderId)
    : kind === "split_tp" ? (tpsl?.[sideKey]?.splitTps   ?? []).map(o => o.orderId)
    :                       (tpsl?.[sideKey]?.partialSls ?? []).map(o => o.orderId);
    if (!ids.length) return;

    const path = kind === "scale_in" ? "/api/scale-in"
               : kind === "split_tp" ? "/api/tpsl/split"
               :                       "/api/tpsl/partial-sl";

    setOrderStatus(null);
    // ⚠ **순차로 보낸다** (`placeSplitOrders`와 같은 이유 — 어디까지 지워졌는지
    //   알 수 있어야 한다). 다만 등록과 달리 **중간에 실패해도 멈추지 않는다**:
    //   한 건이 방금 체결돼 -2011이 났다고 나머지를 남기면, 사용자는
    //   "전체 취소를 눌렀는데 몇 개가 남아 있다"를 겪는다
    let done = 0;
    for (const orderId of ids) {
      try { await api("DELETE", path, { orderId }); done++; } catch { /* 나머지를 계속 지운다 */ }
    }
    setTimeout(() => { if (kind === "scale_in") _refetchPos(); else _refetchTpsl(); }, 500);

    // ⚠ **몇 개가 실제로 지워졌는지 반드시 알린다.** 하나가 방금 체결돼 취소에
    //   실패했는데 `취소 완료`라고만 띄우면, 남아 있는 주문을 모르고 넘어간다
    setOrderStatus(done === ids.length
      ? { type: "success", msg: `${KIND_LABEL[kind]} ${done}개 취소 완료` }
      : { type: "error",   msg: `${KIND_LABEL[kind]} ${ids.length}개 중 ${done}개 취소 — ${ids.length - done}개 실패` });
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
      setOrderStatus({ type: "error", msg: `분할 TP 취소 실패: ${e.message}` });
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
      // ⚠ 실패에는 **사이드와 부분/전량을 함께** 적는다 (2026-08-25 사용자 요청).
      //   성공은 `부분 청산 완료`/`포지션 청산 완료`로 갈리는데 실패만 `청산 실패:`
      //   하나였다 — 롱·숏을 둘 다 들고 있으면 **어느 쪽이 안 닫혔는지 모른다**.
      //   청산 실패는 곧 "아직 포지션이 살아 있다"는 뜻이라 가장 급한 실패다
      setOrderStatus({ type: "error",
        msg: `${side} ${partial ? "부분 청산" : "포지션 청산"} 실패: ${e.message}` });
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
        setOrderStatus({ type: "error", msg: `미체결 주문 취소 실패: ${e.message}` }); return;
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
