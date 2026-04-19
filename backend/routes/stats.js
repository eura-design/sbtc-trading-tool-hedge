const express     = require("express");
const { binance } = require("../services/binanceClient");
const statsCache  = require("../services/statsCache");
const router      = express.Router();

const CACHE_TTL = 5 * 60 * 1000;

// GET /api/stats?startTime=<unix_ms>
router.get("/", async (req, res) => {
  try {
    const startTime = req.query.startTime ? parseInt(req.query.startTime) : null;
    const now       = Date.now();
    const { cache, cacheTime } = statsCache.getCache();

    // 캐시 (전체 기간 조회만)
    if (!startTime && cache && now - cacheTime < CACHE_TTL) {
      return res.json(cache);
    }

    const params = { symbol: "BTCUSDT", limit: 1000 };
    if (startTime) { params.startTime = startTime; params.endTime = now; }

    // REALIZED_PNL / COMMISSION / FUNDING_FEE 동시 조회
    const [pnlRes, commRes, fundingRes] = await Promise.all([
      binance("GET", "/fapi/v1/income", { ...params, incomeType: "REALIZED_PNL" }),
      binance("GET", "/fapi/v1/income", { ...params, incomeType: "COMMISSION"   }),
      binance("GET", "/fapi/v1/income", { ...params, incomeType: "FUNDING_FEE"  }),
    ]);

    const totalPnl     = pnlRes.data.reduce((s, r) => s + parseFloat(r.income), 0);
    const totalComm    = commRes.data.reduce((s, r) => s + Math.abs(parseFloat(r.income)), 0);
    const totalFunding = fundingRes.data.reduce((s, r) => s + parseFloat(r.income), 0);

    const result = {
      totalComm,
      totalFunding,
      netPnl: totalPnl - totalComm + totalFunding,
    };

    if (!startTime) statsCache.setCache(result, now);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
module.exports.invalidateCache = statsCache.invalidateCache;
