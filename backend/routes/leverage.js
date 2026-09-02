const express  = require("express");
const { binance } = require("../services/binanceClient");
const { log, errOf } = require("../store/logStore");
const symbolInfo = require("../services/symbolInfo");
const router   = express.Router();

// POST /api/leverage — 레버리지 즉시 변경 (포지션 보유 중 증가 시 사용)
router.post("/", async (req, res) => {
  const { leverage } = req.body;
  const lev = parseInt(leverage);
  if (!lev || lev < 1 || lev > 125) {
    return res.status(400).json({ error: "leverage는 1~125 사이 정수여야 합니다" });
  }
  try {
    // ⚠ 바이낸스는 레버리지를 **심볼 단위로만** 받는다 (CLAUDE.md "글로벌 상태").
    //   그래서 심볼마다 따로 걸어야 하고, 어느 심볼에 걸었는지 로그에 남아야 한다
    const symbol = symbolInfo.fromRequest(req);
    const { data } = await binance("POST", "/fapi/v1/leverage", { symbol, leverage: lev });
    log("LEVERAGE_CHANGED", { symbol, leverage: lev });
    res.json({ success: true, leverage: data.leverage, maxNotionalValue: data.maxNotionalValue });
  } catch (err) {
    const msg = err.response?.data?.msg || err.message;
    log("LEVERAGE_FAILED", { level: "error", leverage: lev, err: errOf(err) });
    res.status(err.status ?? 500).json({ error: msg });
  }
});

module.exports = router;
