const router = require("express").Router();
const { udsStatus } = require("../services/orderWatcher");

router.get("/", (req, res) => {
  res.json({
    ok:     true,
    hasKey: !!(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET),
    uptime: Math.floor(process.uptime()),
    // 체결 감지 WebSocket 상태 — 끊겨 있으면 **바이낸스에서 직접 낸 주문이 화면에
    // 늦게 뜬다**(프론트 30초 폴링까지 기다린다). 프론트는 ok만 쓰므로 화면은 그대로다
    uds: udsStatus(),
  });
});

module.exports = router;
