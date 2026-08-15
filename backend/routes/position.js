const express = require("express");
const { binance } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const { resolveOrphans } = require("../services/orderWatcher");
const { resolveEntryInfo } = require("../services/entryTime");
const router  = express.Router();

router.get("/", async (req, res) => {
  try {
    const [{ data: posData }, { data: openOrders }, { data: fundingData }] = await Promise.all([
      binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/openOrders",   { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/premiumIndex", { symbol: "BTCUSDT" }),
    ]);

    // 헷지모드: LONG / SHORT 각각 분리
    const longPos  = posData.find(p => p.positionSide === "LONG"  && parseFloat(p.positionAmt) > 0);
    const shortPos = posData.find(p => p.positionSide === "SHORT" && parseFloat(p.positionAmt) < 0);

    const makePos = p => !p ? null : {
      size:             Math.abs(parseFloat(p.positionAmt)),
      entryPrice:       parseFloat(p.entryPrice),
      unrealizedPnl:    parseFloat(p.unRealizedProfit),
      leverage:         parseInt(p.leverage),
      liquidationPrice: parseFloat(p.liquidationPrice) || null,
      entryTime:        null,   // 아래에서 채운다
      entrySteps:       null,   // 〃
    };

    // 바이낸스 미체결 LIMIT 진입 주문 (TP/SL, SCALE_IN 제외)
    const entryOrders = openOrders.filter(o => {
      if (o.type !== "LIMIT") return false;
      if (o.status !== "NEW" && o.status !== "PARTIALLY_FILLED") return false;
      const stored = store.get(String(o.orderId));
      return stored?.status !== "SCALE_IN" && stored?.status !== "SPLIT_TP";
    });

    // 헷지모드: LONG/SHORT 각각 독립 pending 추적
    let longPending  = null;
    let shortPending = null;
    for (const o of entryOrders) {
      const stored = store.get(String(o.orderId));
      const pendingObj = {
        orderId: String(o.orderId),
        side:    o.side,
        price:   parseFloat(o.price),
        qty:     parseFloat(o.origQty),
        status:  o.status,
        drawing: stored?.drawing ?? null,
        tp:      stored?.tp ?? null,
        sl:      stored?.sl ?? null,
        source:  stored ? "system" : "external",
      };
      if (o.positionSide === "LONG") longPending = pendingObj;
      else if (o.positionSide === "SHORT") shortPending = pendingObj;
    }
    const pending = (longPending || shortPending)
      ? { long: longPending, short: shortPending }
      : null;

    // store에 WATCHING인데 바이낸스 미체결 목록에 없는 주문 → 실제 상태를 확인해 처리
    //
    // ⚠ **여기서 바로 store.delete를 하지 말 것** (2026-08-15, 실계좌 재현).
    //   체결된 주문과 취소된 주문은 **둘 다** openOrders에서 사라진다. 구분 없이 지우면
    //   체결된 주문의 store 항목이 없어지고, 그 순간 TP/SL을 등록할 경로가 **전부** 죽는다
    //   (onFilled의 `!store.has` / pollForFills의 WATCHING 필터 / reconcile의 relevant 필터).
    //   실제로 orderId 1103367652357(LIMIT BUY LONG)이 이렇게 SL 없이 1.6시간 방치됐다.
    //   게다가 이 유예(30초)가 reconcile 주기(60초)보다 **짧아서**, 복구가 오기 전에
    //   삭제가 먼저 도달하는 게 오히려 일반적이었다.
    //   → 지우는 판단은 바이낸스에 물어본 뒤 resolveOrphans가 한다.
    const GRACE_PERIOD = 30_000;
    const now = Date.now();
    const openIds = new Set(openOrders.map(o => String(o.orderId)));
    const orphans = [...store.entries()].filter(([orderId, info]) =>
      info.status === "WATCHING" &&
      !openIds.has(String(orderId)) &&
      !(info.createdAt && now - info.createdAt < GRACE_PERIOD)
    );
    // fire-and-forget — 폴링 응답을 주문 조회만큼 늦추지 않는다
    if (orphans.length) resolveOrphans(orphans).catch(e => console.warn("[POSITION] 고아 주문 처리 실패:", e.message));

    // 바이낸스에 살아있는 SCALE_IN 주문 목록
    const scaleInOrders = openOrders
      .filter(o => store.get(String(o.orderId))?.status === "SCALE_IN")
      .map(o => ({
        orderId: String(o.orderId),
        price:   parseFloat(o.price),
        qty:     parseFloat(o.origQty),
        side:    o.side,
      }))
      .sort((a, b) => b.price - a.price);

    const funding = {
      rate:            parseFloat(fundingData.lastFundingRate) * 100,
      nextFundingTime: fundingData.nextFundingTime,
    };

    const out = { long: makePos(longPos), short: makePos(shortPos) };

    // entryTime / entrySteps — 차트 진입선을 **진입봉부터 계단식으로** 긋는 데 쓴다
    // (PositionLines.jsx). entrySteps = [{ t, avg }] — 그 시각부터 유효했던 평단.
    // ⚠ positionRisk의 updateTime을 쓰지 말 것. 그건 "마지막으로 바뀐 시각"이라
    //   부분 청산 때마다 앞으로 밀린다 (실측 8시간 차이) — services/entryTime.js 주석 참고.
    // 포지션이 바뀌지 않으면 캐시라 추가 요청이 없다. 실패하면 null이고,
    // 그때는 프론트가 예전처럼 전 폭 직선으로 긋는다
    const entry = await resolveEntryInfo(out);
    for (const [key, side] of [["long", "LONG"], ["short", "SHORT"]]) {
      if (!out[key]) continue;
      out[key].entryTime  = entry[side]?.time  ?? null;
      out[key].entrySteps = entry[side]?.steps ?? null;
    }

    res.json({
      ...out,
      pending,
      scaleInOrders,
      funding,
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
