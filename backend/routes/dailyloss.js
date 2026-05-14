const express     = require("express");
const { binance } = require("../services/binanceClient");
const router      = express.Router();

function todayStartUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

async function computeDailyLoss() {
  const [balRes, pnlRes] = await Promise.all([
    binance("GET", "/fapi/v2/balance"),
    binance("GET", "/fapi/v1/income", {
      symbol: "BTCUSDT", incomeType: "REALIZED_PNL",
      startTime: todayStartUTC(), limit: 1000,
    }),
  ]);
  const usdt           = balRes.data.find(a => a.asset === "USDT");
  const walletBalance  = usdt ? parseFloat(usdt.balance) : 0;
  const todayPnl       = pnlRes.data.reduce((s, r) => s + parseFloat(r.income), 0);
  const startOfDayBalance = walletBalance - todayPnl;
  const limit          = startOfDayBalance * 0.04;
  const remaining      = limit + todayPnl;
  return { walletBalance, todayPnl, limit, remaining };
}

// GET /api/daily-loss → { walletBalance, todayPnl, limit, remaining }
router.get("/", async (req, res) => {
  try {
    const result = await computeDailyLoss();
    res.json({
      walletBalance: +result.walletBalance.toFixed(2),
      todayPnl:      +result.todayPnl.toFixed(2),
      limit:         +result.limit.toFixed(2),
      remaining:     +result.remaining.toFixed(2),
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;

// 주문 가드용 — order.js에서 import
module.exports.checkDailyLoss = async function checkDailyLoss() {
  const { todayPnl, limit } = await computeDailyLoss();
  if (todayPnl <= -limit) {
    const err = new Error(`일일 손실 한도 초과 (오늘 ${todayPnl.toFixed(2)} USDT / 한도 -${limit.toFixed(2)} USDT)`);
    err.status = 403;
    throw err;
  }
};
