const router           = require("express").Router();
const { getCache, runKDE } = require("../services/srService");

// 캐시 조회
router.get("/", (req, res) => {
  res.json(getCache());
});

// 파라미터로 KDE 즉시 재실행
router.post("/refresh", async (req, res) => {
  const params = req.body || {};
  try {
    const result = await runKDE(params);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || "KDE 실행 실패" });
  }
});

module.exports = router;
