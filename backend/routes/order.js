const express = require("express");
const { binance, roundPrice, placeTPSL } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const { validateOrder } = require("../middleware/validate");
const { checkDailyLoss } = require("./dailyloss");
const { sideToPosition } = require("../utils/side");
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
        console.log(`[ORDER] 반대쪽 ${oppositeSide} 포지션 있음 → 레버리지 변경 생략 (요청값: ${leverage}x)`);
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
      quantity: parseFloat(quantity).toFixed(3),
      ...(orderType === "LIMIT" && { price: roundPrice(entry), timeInForce: "GTC" }),
    };
    const { data: entryOrder } = await binance("POST", "/fapi/v1/order", entryParams);
    const orderId   = entryOrder.orderId;
    const drawingData = req.body.drawing || null;
    const orderInfo = { side, closeSide, tp, sl, qty: quantity, status: "WATCHING", drawing: drawingData };

    if (orderType === "MARKET") {
      const ap = parseFloat(entryOrder.avgPrice);
      const fillPrice  = ap > 0 ? ap : parseFloat(entryOrder.price || 0);
      const slippagePct = entry && fillPrice ? Math.abs(fillPrice - entry) / entry * 100 : 0;
      const slippageWarn = slippagePct > 0.3
        ? `슬리피지 ${slippagePct.toFixed(2)}% (계획 $${entry} → 체결 $${fillPrice.toFixed(1)}) — TP/SL 가격을 수동 점검하세요`
        : null;

      const tpsl       = await placeTPSL(orderInfo);
      const hasFailure = tpsl.failed.length > 0;
      // 실패 시 store에 저장 → reconcileWithBinance가 15초 내 재시도
      if (hasFailure) {
        store.set(orderId, { ...orderInfo, status: "TPSL_PARTIAL", tpsl, fillPrice, filledAt: Date.now() });
        console.error(`[MARKET] TP/SL 실패 → store 저장 (reconcile 재시도 대기) orderId=${orderId}`);
      }
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
      // LIMIT: User Data Stream이 체결을 감지하므로 store에만 등록
      store.set(orderId, orderInfo);
      res.json({
        success: true, type: "LIMIT",
        entry: { orderId, status: entryOrder.status },
        message: "지정가 주문 등록 완료 — 체결 시 TP/SL 자동 등록 (User Data Stream 감시중)",
      });
    }
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    // M1: 레버리지는 변경됐지만 주문 실패한 경우 사용자에게 알림
    const fullMsg = leverageChanged ? `${msg} (레버리지 ${leverage}x 변경됨)` : msg;
    console.error("[POST /api/order]", fullMsg, err.response?.data);
    res.status(err.status || 500).json({ error: fullMsg });
  }
});

// PATCH /api/order — 미체결 지정가 주문의 TP/SL을 store에서만 업데이트
// (지정가 주문 자체는 바이낸스에 그대로 유지, 체결 시 새 tp/sl 값으로 TP/SL 등록)
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
    store.set(String(orderId), updated);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
