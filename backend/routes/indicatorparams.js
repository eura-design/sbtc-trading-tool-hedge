const router = require("express").Router();
const store  = require("../store/indicatorParamsStore");

router.get("/", (req, res) => {
  res.json(store.load());
});

router.post("/", (req, res) => {
  const params = req.body;
  if (!params || typeof params !== "object") return res.status(400).json({ error: "params 객체가 필요합니다" });
  store.save(params);
  res.json({ ok: true });
});

module.exports = router;
