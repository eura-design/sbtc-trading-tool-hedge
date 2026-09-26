// POST /api/scale-plan — **스케일 진입** (진입가부터 손절가까지 층을 나눠 들어간다)
//
// 2026-09-27 사용자 요청. `POST /api/order`(단일 진입)와 **따로** 둔 이유:
//   · 단일 진입 경로를 건드리지 않는다 — 돈이 걸린 길이라, 새 기능이 그 길의 모양을
//     바꾸지 않는 것이 안전하다. 이 기능이 마음에 안 들면 이 파일과 버튼만 지우면 된다
//   · 가격 규칙은 `middleware/validate.priceRuleError` **하나**를 같이 쓴다 (복사하지 않는다)
//
// ── 층마다 손절을 따로 미리 건다 (이 파일의 핵심) ──────────────────────────
// 층 하나를 낼 때마다 **그 층의 수량으로** TP/SL을 사전 등록한다 (`preplaceTPSL`).
// 묶음 전체에 큰 손절 하나를 거는 방식이 아니다. 그 이유가 둘이다:
//   ① **층을 취소하면 그 층의 손절만 같이 내려간다.** 기존 규칙("진입 주문이 사라지면
//      사전 등록분도 같이 내린다")이 그대로 맞게 돈다 — 새 규칙을 만들 필요가 없다.
//      큰 손절 하나를 첫 층에 매달면, 첫 층만 취소해도 나머지 층이 무방비가 된다
//   ② **보유 수량과 손절 수량이 늘 일치한다.** 큰 손절 하나면 "1층만 체결된 상태에서
//      손절 발동" 같은 상황에서 손절 수량이 보유량을 초과한다. 그때 거래소가 초과분을
//      잘라주는지 **확인하지 못했다** — 손절에 관한 일이라, 확인 안 된 동작에 기대는
//      대신 그 상황이 생기지 않는 설계를 택했다
// ⚠ 되돌리지 말 것. 알고 주문이 층마다 1~2개로 늘어나는 것은 이 두 가지의 대가다.
//
// ── 묶음 표시 (`scaleGroup`) ───────────────────────────────────────────────
// 층 기록에 같은 `scaleGroup`을 적는다. 쓰는 곳이 둘이다:
//   · `routes/position.js` — 층을 `pending`에서 빼고 `entryLayers`로 준다
//     (`pending`은 사이드당 1건이라, 층을 담으면 마지막 하나만 화면에 보인다)
//   · `services/orderWatcher.js` — **한 번이라도 체결된 묶음**의 포지션이 닫히면
//     남은 층을 취소한다. 안 치우면 익절 뒤 가격이 내려올 때 원치 않는 포지션이 열린다
const express = require("express");
const { binance, roundPrice, roundQty, preplaceTPSL } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const { validateScalePlan } = require("../middleware/validate");
const { checkDailyLoss } = require("./dailyloss");
const { sideToPosition } = require("../utils/side");
const { verifyImmediateFill } = require("../services/orderWatcher");
const push     = require("../services/pushService");
const symbolInfo = require("../services/symbolInfo");
const { log, errOf } = require("../store/logStore");

const router = express.Router();

let seq = 0;
const newGroupId = () => `sg${Date.now().toString(36)}${(++seq).toString(36)}`;

router.post("/", validateScalePlan, async (req, res) => {
  const { side, entry, tp, sl, layers, leverage } = req.body;
  const closeSide = side === "BUY" ? "SELL" : "BUY";
  const positionSide = sideToPosition(side);
  const scaleGroup = newGroupId();

  let leverageChanged = false;
  let symbol;
  try {
    symbol = symbolInfo.fromRequest(req);
    await checkDailyLoss();

    // 레버리지 — 단일 진입과 같은 규칙이다 (반대쪽 포지션이 있으면 건드리지 않는다).
    // ⚠ 층마다 부르지 않는다. 한 번이면 그 심볼에 걸리는 설정이다
    if (leverage) {
      const { data: posCheck } = await binance("GET", "/fapi/v2/positionRisk", { symbol });
      const oppositeSide = positionSide === "LONG" ? "SHORT" : "LONG";
      const hasOppositePos = posCheck.some(p =>
        p.positionSide === oppositeSide && parseFloat(p.positionAmt) !== 0);
      if (hasOppositePos) log("LEVERAGE_SKIPPED", { requested: leverage, oppositeSide });
      else {
        await binance("POST", "/fapi/v1/leverage", { symbol, leverage: parseInt(leverage) });
        leverageChanged = true;
      }
    }

    log("SCALE_PLAN_START", { symbol, scaleGroup, orderSide: side, posSide: positionSide,
      layers: layers.length, entry, tp, sl, qty: req.scalePlan.total,
      leverage: leverage ?? null });

    const placed = [];     // 나간 층
    const failed = [];     // 못 나간 층 { index, price, error }
    let slMissing = 0;     // 손절 사전 등록이 실패한 층 수

    // ⚠ **순차로 보낸다.** 한꺼번에 쏘면 증거금이 서로의 잔고를 모른 채 접수되고,
    //   어디까지 나갔는지도 알 수 없어 실패 보고가 부정확해진다
    //   (`orderSlice.placeSplitOrders`가 같은 이유로 그렇게 한다)
    for (const [i, L] of layers.entries()) {
      const qty = roundQty(L.qty, symbol);
      try {
        const { data: order } = await binance("POST", "/fapi/v1/order", {
          symbol, side, positionSide, type: "LIMIT",
          quantity: qty, price: roundPrice(L.price, symbol), timeInForce: "GTC",
        });
        const orderId = order.orderId;
        // 이 층의 수량으로 TP/SL을 미리 건다 (머리 주석 참고)
        const preset = await preplaceTPSL({ closeSide, tp, sl, qty: L.qty, symbol });
        if (preset.failed.some(f => f.type === "SL")) slMissing++;

        store.set(orderId, {
          symbol, side, closeSide, tp, sl, qty: parseFloat(qty),
          status: "WATCHING", presetTpsl: preset,
          scaleGroup, scaleIndex: i, scaleCount: layers.length,
          // 플랜 박스는 **첫 층에만** 담는다 — 재시작 복구가 박스를 되살리는 용도이고,
          // 층마다 담으면 같은 박스가 N벌이 된다
          drawing: i === 0 ? (req.body.drawing || null) : null,
        });

        log("ENTRY_PLACED", { symbol, orderId, orderSide: side, posSide: positionSide,
          orderType: "LIMIT", qty: parseFloat(qty), price: L.price, tp, sl,
          scaleGroup, scaleIndex: i, status: order.status,
          presetSl: preset.sl?.orderId ?? null, presetTp: preset.tp?.orderId ?? null });

        // 지정가가 즉시 체결됐을 수 있다 (층이 현재가 위/아래에 걸린 경우) —
        // 단일 진입과 같은 이유로 한 번 더 확인한다
        verifyImmediateFill(orderId, order);
        placed.push({ orderId: String(orderId), price: L.price, qty: parseFloat(qty),
                      presetFailed: preset.failed.map(f => f.type) });
      } catch (e) {
        const msg = e.response?.data?.msg || e.message;
        failed.push({ index: i, price: L.price, error: msg });
        log("SCALE_LAYER_FAILED", { level: "error", symbol, scaleGroup, scaleIndex: i,
          price: L.price, qty: parseFloat(qty), err: errOf(e) });
        // ⚠ **이미 나간 층을 되돌리지 않는다.** 그 층들에는 손절이 붙어 있어 살려 두는
        //   것이 안전하고, 되돌리려면 주문·사전등록을 되감아야 해서 실패 경로가 더 늘어난다.
        //   대신 몇 개가 나갔는지 반드시 알린다 (아래 응답)
        break;
      }
    }

    if (!placed.length) {
      const err = new Error(failed[0]?.error || "층을 하나도 걸지 못했습니다");
      err.status = 400;
      throw err;
    }

    log("SCALE_PLAN_PLACED", { symbol, scaleGroup, posSide: positionSide,
      placed: placed.length, requested: layers.length, slMissing,
      level: failed.length || slMissing ? "warn" : "info" });

    push.pushUpdate(["position", "balance", "tpsl"]);

    const warnings = [
      failed.length ? `${layers.length}개 중 ${placed.length}개만 등록됐습니다 (${failed[0].error})` : null,
      // ⚠ 손절 사전 등록이 실패한 층은 **체결되면 무방비**다 (백엔드가 꺼져 있으면).
      //   체결 시 `onFilled`가 다시 걸지만 그 전에 꺼지면 아무도 못 건다
      slMissing ? `⚠ ${slMissing}개 층의 손절 사전 등록 실패 — 그 층이 체결될 때 재시도되지만 그 전에 서버가 꺼지면 무방비입니다` : null,
    ].filter(Boolean);

    res.json({
      success: true, type: "SCALE",
      scaleGroup,
      layers: placed,
      placed: placed.length, requested: layers.length,
      warning: warnings.length ? warnings.join(" / ") : null,
      message: failed.length
        ? `스케일 진입 ${placed.length}/${layers.length}층 등록`
        : `스케일 진입 ${placed.length}층 + 층마다 TP/SL 등록 완료 (서버가 꺼져도 유지됩니다)`,
    });
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    const fullMsg = leverageChanged ? `${msg} (레버리지 ${leverage}x 변경됨)` : msg;
    if (err.status !== 403) {
      log("SCALE_PLAN_FAILED", { level: "error", symbol: symbol ?? null, scaleGroup,
        orderSide: side, posSide: positionSide, layers: layers?.length ?? 0,
        leverageChanged, err: errOf(err) });
    }
    res.status(err.status ?? 500).json({ error: fullMsg });
  }
});

module.exports = router;
