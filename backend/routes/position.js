const express = require("express");
const { binance } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
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

    // store에 WATCHING인데 바이낸스에 없는 주문 → 제거
    const GRACE_PERIOD = 30_000;
    const now = Date.now();
    const openIds = new Set(openOrders.map(o => String(o.orderId)));
    for (const [orderId, info] of store.entries()) {
      if (info.status === "WATCHING" && !openIds.has(String(orderId))) {
        if (info.createdAt && now - info.createdAt < GRACE_PERIOD) continue;
        console.log(`[POSITION] store 주문 ${orderId}이 바이낸스에 없음 → 제거`);
        store.delete(orderId);
      }
    }

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

    res.json({
      long:  makePos(longPos),
      short: makePos(shortPos),
      pending,
      scaleInOrders,
      funding,
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
