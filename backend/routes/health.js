const router = require("express").Router();

router.get("/", (req, res) => {
  res.json({
    ok:     true,
    hasKey: !!(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET),
    uptime: Math.floor(process.uptime()),
  });
});

module.exports = router;
