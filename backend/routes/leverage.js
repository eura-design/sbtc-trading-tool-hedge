const express  = require("express");
const { binance } = require("../services/binanceClient");
const router   = express.Router();

// POST /api/leverage — 레버리지 즉시 변경 (포지션 보유 중 증가 시 사용)
router.post("/", async (req, res) => {
  const { leverage } = req.body;
  const lev = parseInt(leverage);
  if (!lev || lev < 1 || lev > 125) {
    return res.status(400).json({ error: "leverage는 1~125 사이 정수여야 합니다" });
  }
  try {
    const { data } = await binance("POST", "/fapi/v1/leverage", {
      symbol: "BTCUSDT", leverage: lev,
    });
    res.json({ success: true, leverage: data.leverage, maxNotionalValue: data.maxNotionalValue });
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    console.error("[POST /api/leverage]", msg);
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
