const router = require("express").Router();
const { udsStatus, accountStatus } = require("../services/orderWatcher");

router.get("/", (req, res) => {
  res.json({
    ok:     true,
    hasKey: !!(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET),
    uptime: Math.floor(process.uptime()),
    // 체결 감지 WebSocket 상태 — 끊겨 있으면 **바이낸스에서 직접 낸 주문이 화면에
    // 늦게 뜬다**(프론트 30초 폴링까지 기다린다). 프론트는 ok만 쓰므로 화면은 그대로다
    uds: udsStatus(),
    // 계정 변화 감시 — UDS가 조용해도 이게 돌면 밖에서 낸 매매가 몇 초 안에 뜬다
    account: accountStatus(),
  });
});

module.exports = router;
