const express = require("express");
const { binance } = require("../services/binanceClient");
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { data } = await binance("GET", "/fapi/v2/balance");
    const usdt = data.find(a => a.asset === "USDT");
    if (!usdt) return res.status(404).json({ error: "USDT 잔고 없음" });
    // ⚠ 필드명은 **페이퍼 브로커(replay/paperBroker.balanceSnapshot)와 같아야 한다** —
    //   사이드바가 실거래·연습을 모르는 채로 같은 슬롯을 읽는다.
    //   바이낸스가 주는 이름은 `balance`지만 `balance.balance`가 되어 뜻이 안 읽히고,
    //   페이퍼가 이미 `walletBalance`로 내고 있었다 (2026-08-22 통일)
    res.json({
      walletBalance:    parseFloat(usdt.balance),
      availableBalance: parseFloat(usdt.availableBalance),
      crossUnPnl:       parseFloat(usdt.crossUnPnl),
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
