const router           = require("express").Router();
const { getCache, runKDE } = require("../services/srService");

// 캐시 조회
router.get("/", (req, res) => {
  res.json(getCache());
});

// 파라미터로 KDE 즉시 재실행
router.post("/refresh", async (req, res) => {
  const params = req.body || {};
  const result = await runKDE(params);
  if (!result) return res.status(500).json({ error: "KDE 실행 실패" });
  res.json(result);
});

module.exports = router;
