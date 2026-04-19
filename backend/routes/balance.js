const express = require("express");
const { binance } = require("../services/binanceClient");
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { data } = await binance("GET", "/fapi/v2/balance");
    const usdt = data.find(a => a.asset === "USDT");
    if (!usdt) return res.status(404).json({ error: "USDT 잔고 없음" });
    res.json({
      balance:          parseFloat(usdt.balance),
      availableBalance: parseFloat(usdt.availableBalance),
      crossUnPnl:       parseFloat(usdt.crossUnPnl),
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
