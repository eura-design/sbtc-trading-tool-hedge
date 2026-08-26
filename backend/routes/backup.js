// 백업 라우트 (2026-08-26) — store/backupStore.js 참고
//
// ⚠ **인증이 없다.** 로컬 전용이라는 전제다 (`routes/log.js`와 같다).
//   밖에 노출할 일이 생기면 반드시 막을 것 — 여기로 브라우저 저장소가 통째로 오간다.
// ⚠ 되돌리기(restore)는 **여기에 없다.** 브라우저 쪽은 브라우저가 직접 쓰고
//   (`__restoreBackup()`), 백엔드 파일은 `node backend/tools/backup.js --restore`가 한다.
//   되돌리기는 덮어쓰는 동작이라 웹 요청 한 번으로 일어나면 안 된다.

const express = require("express");
const router  = express.Router();
const backup  = require("../store/backupStore");

/** 브라우저 저장소를 받아 오늘 백업에 담는다 */
router.post("/browser", (req, res) => {
  const r = backup.putBrowser(req.body?.items);
  if (!r.ok) return res.status(400).json({ error: r.reason });
  res.json({ ok: true, keys: r.keys, size: r.size });
});

/** 어떤 백업이 있나 */
router.get("/list", (_req, res) => res.json({ backups: backup.list() }));

/** 되살릴 내용 — 날짜를 안 주면 가장 최근 것 */
router.get("/latest", (req, res) => {
  const snap = backup.read(req.query.day);
  if (!snap) return res.status(404).json({ error: "백업이 없습니다" });
  res.json(snap);
});

module.exports = router;
