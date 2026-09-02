const express = require("express");
const { binance, roundPrice, roundQty, placeTPSL, preplaceTPSL, cancelPresetTPSL } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const { validateOrder } = require("../middleware/validate");
const { checkDailyLoss } = require("./dailyloss");
const { sideToPosition } = require("../utils/side");
const { verifyImmediateFill } = require("../services/orderWatcher");
const push     = require("../services/pushService");
const { log, errOf } = require("../store/logStore");

const router  = express.Router();

router.post("/", validateOrder, async (req, res) => {
  const { side, orderType, entry, tp, sl, quantity, leverage } = req.body;
  const closeSide = side === "BUY" ? "SELL" : "BUY";

  let leverageChanged = false;
  try {
    // 0) 일일 손실 한도 체크
    await checkDailyLoss();

    // 1) positionSide 결정
    const positionSide = sideToPosition(side);

    // 2) 레버리지 설정 — 반대쪽 포지션이 이미 있으면 건너뜀 (기존 포지션 레버리지 보호)
    if (leverage) {
      const { data: posCheck } = await binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" });
      const oppositeSide = positionSide === "LONG" ? "SHORT" : "LONG";
      const hasOppositePos = posCheck.some(p =>
        p.positionSide === oppositeSide && parseFloat(p.positionAmt) !== 0
      );
      if (hasOppositePos) {
        log("LEVERAGE_SKIPPED", { requested: leverage, oppositeSide });
      } else {
        await binance("POST", "/fapi/v1/leverage", {
          symbol: "BTCUSDT", leverage: parseInt(leverage),
        });
        leverageChanged = true;
      }
    }
    // 3) 진입 주문
    const entryParams = {
      symbol: "BTCUSDT", side, positionSide, type: orderType,
      quantity: roundQty(quantity),
      ...(orderType === "LIMIT" && { price: roundPrice(entry), timeInForce: "GTC" }),
    };
    const { data: entryOrder } = await binance("POST", "/fapi/v1/order", entryParams);
    const orderId   = entryOrder.orderId;
    const drawingData = req.body.drawing || null;
    const orderInfo = { side, closeSide, tp, sl, qty: quantity, status: "WATCHING", drawing: drawingData };
    // ⚠ **주문을 낸 것 자체를 남긴다** (2026-08-25). 예전엔 시장가만 `ENTRY_FILLED`로
    //   남고 **지정가는 체결될 때까지 아무 흔적이 없었다** — "몇 시에 걸었나",
    //   "걸고 체결까지 얼마나 걸렸나", "걸었다가 취소된 게 몇 건인가"를 답할 수 없었다.
    //   시장가도 같이 남긴다: 체결(`ENTRY_FILLED`)과 접수는 다른 사건이고,
    //   접수는 됐는데 체결 기록이 없는 경우가 곧 사고다
    log("ENTRY_PLACED", { orderId, orderSide: side, posSide: positionSide, orderType,
      qty: parseFloat(quantity), price: orderType === "LIMIT" ? entry : null,
      tp: tp ?? null, sl: sl ?? null, leverage: leverage ?? null, status: entryOrder.status });

    if (orderType === "MARKET") {
      const ap = parseFloat(entryOrder.avgPrice);
      const fillPrice  = ap > 0 ? ap : parseFloat(entryOrder.price || 0);
      const slippagePct = entry && fillPrice ? Math.abs(fillPrice - entry) / entry * 100 : 0;
      const slippageWarn = slippagePct > 0.3
        ? `슬리피지 ${slippagePct.toFixed(2)}% (계획 $${entry} → 체결 $${fillPrice.toFixed(1)}) — TP/SL 가격을 수동 점검하세요`
        : null;

      const tpsl       = await placeTPSL(orderInfo);
      const hasFailure = tpsl.failed.length > 0;
      // ⚠ 어휘 고정: `orderSide`(BUY/SELL) ↔ `posSide`(LONG/SHORT)를 섞지 말 것 (logStore 참고)
      log("ENTRY_FILLED", { orderId, orderSide: side, posSide: positionSide,
        orderType: "MARKET", qty: quantity, price: fillPrice, tp, sl,
        plannedPrice: entry ?? null, slippagePct: +slippagePct.toFixed(3) });
      // 실패 시 store에 저장 → reconcileWithBinance가 재시도
      if (hasFailure) {
        store.set(orderId, { ...orderInfo, status: "TPSL_PARTIAL", tpsl, fillPrice, filledAt: Date.now() });
        log("TPSL_PARTIAL", { level: "error", orderId, orderSide: side, posSide: positionSide,
          failed: tpsl.failed.map(f => f.type),
          errors: tpsl.failed.map(f => ({ type: f.type, msg: f.error })), tp, sl });
        if (tpsl.failed.some(f => f.type === "SL")) {
          push.pushAlert("critical", `⚠ 시장가 체결됐으나 SL 등록 실패 (orderId=${orderId})`);
        }
      } else {
        log("TPSL_PLACED", { orderId, posSide: positionSide, tp, sl,
          tpType: tpsl.tp?.orderType ?? null, slType: tpsl.sl?.orderType ?? null,
          closePosition: true });
      }

      // ⚠ 프론트에 TP/SL 갱신을 **반드시 알릴 것.** 없으면 거래소엔 0.2초 만에 걸려 있는데
      //   화면에는 useTpsl의 60초 폴링 전까지 안 나온다. 특히 반대쪽 포지션을 이미 들고
      //   있으면 useTpsl의 hasPos가 계속 true라 즉시 조회가 아예 트리거되지 않는다
      push.pushUpdate(["position", "balance", "tpsl"]);
      const warnings   = [
        hasFailure ? `${tpsl.failed.map(f => f.type).join(", ")} 등록 실패 — 자동 재시도 중` : null,
        slippageWarn,
      ].filter(Boolean);
      res.json({
        success: true, type: "MARKET",
        entry: { orderId, status: entryOrder.status, fillPrice },
        tpsl,
        warning: warnings.length ? warnings.join(" / ") : null,
        message: hasFailure ? "시장가 체결 완료, TP/SL 재시도 중" : "시장가 체결 → TP/SL 등록 완료",
      });
    } else {
      // LIMIT: **진입 주문과 함께 TP/SL도 지금 건다** (2026-08-23 사용자 요청).
      //
      // ⚠ 예전엔 진입 주문만 보내고 TP/SL 가격은 store(우리 파일)에만 적어 뒀다가
      //   체결을 감지한 시점에 등록했다. 그러면 **체결되는 순간 백엔드가 켜져 있어야만**
      //   손절이 걸린다 — 꺼둔 사이에 지정가가 체결되면 다시 켤 때까지 무방비다.
      //   이제 세 주문이 처음부터 거래소에 올라가 있으므로 그 뒤론 거래소가 알아서 한다
      //
      // ⚠ **체결 시 등록 경로(onFilled)를 없애지 말 것 — 이중으로 둔다.**
      //   ① 사전 등록은 **수량 고정**이라 추가 진입분을 못 덮는다 → 체결 후 onFilled가
      //     `closePosition` 방식으로 덮어써서 그 약점을 지운다
      //   ② 진입 전에 가격이 **TP 선을 먼저 스치면** 그 TP는 포지션 없이 발동해 사라진다
      //     (브레이크아웃 진입에서 실제로 가능하다). 그때 백엔드가 켜져 있으면 채워준다
      //   ※ SL은 순서상 안전하다 — 롱이면 손절이 진입가보다 아래라, 손절에 닿으려면
      //     반드시 진입가를 지나면서 지정가가 먼저 체결된다
      const preset = await preplaceTPSL({ closeSide, tp, sl, qty: quantity });
      orderInfo.presetTpsl = preset;
      store.set(orderId, orderInfo);

      const presetFailed = preset.failed.map(f => f.type).join(", ");
      if (presetFailed) {
        log("TPSL_PRESET_FAILED", { level: "error", orderId, orderSide: side, posSide: positionSide,
          failed: preset.failed.map(f => f.type),
          errors: preset.failed.map(f => ({ type: f.type, msg: f.error })), tp, sl });
      } else {
        log("TPSL_PRESET", { orderId, posSide: positionSide, tp, sl,
          tpType: preset.tp?.orderType ?? null, slType: preset.sl?.orderType ?? null,
          closePosition: false, qty: parseFloat(quantity) });
      }

      // 지정가가 호가를 먹어 즉시 체결된 경우(박스를 현재가 너머로 올린 경우)
      // → UDS FILLED가 위 store.set보다 **먼저** 도착해 `!store.has`에 걸려 버려진다
      // → 응답 status만 믿으면 안 된다: 바이낸스는 즉시 체결돼도 보통 "NEW"를 돌려준다
      // → verifyImmediateFill이 실제 주문 상태를 한 번 더 확인한다 (fire-and-forget)
      // → safePlaceTPSL의 placingTpsl Set이 UDS와 동시 호출 시 중복 방지
      verifyImmediateFill(orderId, entryOrder);

      res.json({
        success: true, type: "LIMIT",
        entry: { orderId, status: entryOrder.status },
        // ⚠ SL이 안 걸렸으면 **반드시 알린다** — 그 상태로 체결되면 백엔드가 꺼져 있을 때
        //   무방비다. TP만 실패한 건 돈을 잃는 문제가 아니라 경고 문구만 다르다
        warning: preset.failed.some(f => f.type === "SL")
          ? `⚠ 손절 사전 등록 실패 (${preset.failed.find(f => f.type === "SL").error}) — 체결 시 재시도되지만 그 전에 서버가 꺼지면 무방비입니다`
          : preset.failed.length
            ? "익절 사전 등록 실패 — 체결 시 다시 등록됩니다"
            : null,
        message: presetFailed
          ? `지정가 주문 등록 완료 — ${presetFailed} 사전 등록 실패`
          : "지정가 주문 + TP/SL 등록 완료 (서버가 꺼져도 유지됩니다)",
      });

    }
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    // M1: 레버리지는 변경됐지만 주문 실패한 경우 사용자에게 알림
    const fullMsg = leverageChanged ? `${msg} (레버리지 ${leverage}x 변경됨)` : msg;
    // ⚠ `positionSide`는 try 안에서 선언돼 여기서는 안 보인다 — side로 다시 구한다
    // ⚠ 일일 손실 한도(403)는 `checkDailyLoss`가 `DAILY_LOSS_BLOCKED`로 이미 남겼다 —
    //   여기서 또 적으면 같은 사실이 두 줄이 된다
    if (err.status !== 403) {
      log("ORDER_FAILED", { level: "error", orderSide: side, posSide: sideToPosition(side),
        orderType, qty: quantity, leverageChanged, err: errOf(err) });
    }
    res.status(err.status || 500).json({ error: fullMsg });
  }
});

// PATCH /api/order — 미체결 지정가 주문의 TP/SL 변경 (박스 가로선 드래그)
//
// ⚠ **store만 고치고 끝내지 말 것** (2026-08-23). 지정가 주문은 TP/SL을 미리 걸어 두므로
//   (위 POST) **거래소에 이미 옛 가격으로 주문이 올라가 있다.** 파일만 고치면 화면과
//   거래소가 갈라진다 — 박스는 새 가격을 보여주는데 실제로 발동하는 건 옛 가격이다
//
// ※ 지정가 주문 자체는 건드리지 않는다 (진입가는 replacePendingOrder가 따로 다시 건다)
router.patch("/", async (req, res) => {
  try {
    const { orderId, tp, sl } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId 필수" });
    const existing = store.get(String(orderId));
    if (!existing) return res.status(404).json({ error: "주문을 찾을 수 없습니다" });
    const updated = {
      ...existing,
      tp:  tp  ?? existing.tp,
      sl:  sl  ?? existing.sl,
      drawing: existing.drawing ? { ...existing.drawing, tp: tp ?? existing.drawing.tp, sl: sl ?? existing.drawing.sl } : null,
    };

    // 사전 등록분 교체 — **먼저 내리고 다시 건다.** 여기선 순서를 뒤집을 수 없다:
    // 같은 사이드에 `STOP_MARKET`이 둘이 되는 순간이 생기면 -4130으로 거절될 수 있다.
    // 아직 체결 전이라 그 사이에 지킬 포지션도 없어 위험 창이 없다
    let preset = existing.presetTpsl ?? null;
    if (existing.status === "WATCHING" && preset) {
      await cancelPresetTPSL(preset)
        .catch(e => log("PRESET_TPSL_CANCEL_FAILED", { level: "warn", orderId, ctx: "patchOrder", err: errOf(e) }));
      preset = await preplaceTPSL({
        closeSide: existing.closeSide, tp: updated.tp, sl: updated.sl, qty: existing.qty,
      });
      updated.presetTpsl = preset;
    }
    store.set(String(orderId), updated);
    // ⚠ **성공도 남긴다** (2026-08-25). 예전엔 실패만 기록돼서, 박스를 끌어 손절·익절을
    //   몇 번 어떻게 옮겼는지가 아무 데도 남지 않았다. 옛 값을 같이 적어야
    //   "언제 손절을 넓혔나"를 되짚을 수 있다
    log("TPSL_UPDATED", { orderId, ctx: "pendingOrder", posSide: sideToPosition(existing.side),
      tp: updated.tp ?? null, sl: updated.sl ?? null,
      prevTp: existing.tp ?? null, prevSl: existing.sl ?? null,
      presetFailed: preset?.failed?.map(f => f.type) ?? [] });
    res.json({
      success: true,
      warning: preset?.failed?.length
        ? `${preset.failed.map(f => f.type).join(", ")} 재등록 실패 — 체결 시 다시 시도합니다`
        : null,
    });
  } catch (err) {
    log("TPSL_UPDATE_FAILED", { level: "error", ctx: "pendingOrder",
      orderId: req.body?.orderId ?? null, err: errOf(err) });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
