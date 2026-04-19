const express = require("express");
const { binance } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const router  = express.Router();

router.get("/", async (req, res) => {
  try {
    // 바이낸스를 source of truth로 — 포지션 + 미체결 주문을 동시 조회
    const [{ data: posData }, { data: openOrders }, { data: fundingData }] = await Promise.all([
      binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/openOrders",   { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/premiumIndex", { symbol: "BTCUSDT" }),
    ]);

    const pos = posData.find(p => parseFloat(p.positionAmt) !== 0);

    // 바이낸스 미체결 LIMIT 진입 주문 (TP/SL, SCALE_IN 제외)
    const entryOrders = openOrders.filter(o => {
      if (o.type !== "LIMIT") return false;
      if (o.status !== "NEW" && o.status !== "PARTIALLY_FILLED") return false;
      const stored = store.get(String(o.orderId));
      return stored?.status !== "SCALE_IN" && stored?.status !== "SPLIT_TP";
    });

    // 우리 store에 있으면 drawing 데이터 병합, 없으면 바이낸스 데이터만 사용
    let pending = null;
    if (entryOrders.length > 0) {
      const o = entryOrders[0]; // 첫 번째 미체결 주문
      const stored = store.get(o.orderId);
      pending = {
        orderId:  String(o.orderId),
        side:     o.side,
        price:    parseFloat(o.price),
        qty:      parseFloat(o.origQty),
        status:   o.status,
        drawing:  stored?.drawing ?? null,
        tp:       stored?.tp ?? null,
        sl:       stored?.sl ?? null,
        source:   stored ? "system" : "external",  // 우리 시스템 vs 바이낸스 직접
      };
    }

    // store에 WATCHING인데 바이낸스에 없는 주문 → 이미 취소/체결됨 → 정리
    // 단, 생성 직후 30초 이내는 Binance 반영 지연 가능 → 보존 (레이스 컨디션 방지)
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
      }));

    const funding = {
      rate:         parseFloat(fundingData.lastFundingRate) * 100, // %
      nextFundingTime: fundingData.nextFundingTime,
    };

    if (!pos) return res.json({ open: false, pending, scaleInOrders, funding });
    res.json({
      open:             true,
      side:             parseFloat(pos.positionAmt) > 0 ? "LONG" : "SHORT",
      size:             Math.abs(parseFloat(pos.positionAmt)),
      scaleInOrders,
      entryPrice:       parseFloat(pos.entryPrice),
      unrealizedPnl:    parseFloat(pos.unRealizedProfit),
      leverage:         parseInt(pos.leverage),
      liquidationPrice: parseFloat(pos.liquidationPrice) || null,
      funding,
      pending,
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
