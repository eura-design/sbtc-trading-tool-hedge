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
    // ⚠ **심볼 필터를 걸지 않는다** (2026-09-02). 한도의 기준은 지갑 잔고이고
    //   그건 계정 전체 값이다 — 손익만 BTCUSDT로 좁히면, 다른 코인에서 잃은 돈이
    //   `todayPnl`에 안 잡혀 **한도가 실제보다 헐거워진다.**
    //   (그전에는 BTCUSDT만 거래해서 결과가 같았다)
    binance("GET", "/fapi/v1/income", {
      incomeType: "REALIZED_PNL",
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
    res.status(err.status ?? 500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
