const router = require("express").Router();
const store  = require("../store/trackerStore");

// 월별 수익 결산 데이터 (기타/monthly_tracker.html 전용)
//   저장 위치는 기타/tracker_data.json — store 주석 참고

router.get("/", (req, res) => {
  res.json(store.load());
});

router.post("/", (req, res) => {
  const { seed, entries } = req.body || {};

  if (!Number.isFinite(seed) || seed <= 0) {
    return res.status(400).json({ error: "seed는 0보다 큰 숫자여야 합니다" });
  }
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: "entries 배열이 필요합니다" });
  }

  // ⚠ 받은 걸 그대로 쓰지 않는다 — 이 파일은 사람이 직접 열어볼 기록이고,
  //   한 번 깨진 항목이 들어가면 프론트가 조용히 NaN을 그린다
  const clean = [];
  for (const e of entries) {
    if (!e || typeof e.month !== "string" || !e.month.trim()) {
      return res.status(400).json({ error: "각 항목에 month 문자열이 필요합니다" });
    }
    if (!Number.isFinite(e.asset) || e.asset < 0) {
      return res.status(400).json({ error: `${e.month}: asset이 올바르지 않습니다` });
    }
    const withdrawal = Number.isFinite(e.withdrawal) ? e.withdrawal : 0;
    if (withdrawal < 0) {
      return res.status(400).json({ error: `${e.month}: withdrawal이 올바르지 않습니다` });
    }
    clean.push({ month: e.month.trim(), asset: e.asset, withdrawal });
  }

  if (!store.save({ seed, entries: clean })) {
    return res.status(500).json({ error: "파일 저장에 실패했습니다" });
  }
  res.json({ ok: true, count: clean.length });
});

module.exports = router;
