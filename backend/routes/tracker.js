const router = require("express").Router();
const store  = require("../store/trackerStore");

// 월별 수익 결산 데이터 (기타/monthly_tracker.html 전용)
//   저장 위치는 기타/tracker_data.json — store 주석 참고

router.get("/", (req, res) => {
  res.json(store.load());
});

router.post("/", (req, res) => {
  const { seed, entries, autoSkip } = req.body || {};

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
    // deposit = 외부에서 가져와 넣은 돈 (2026-09-26 추가). withdrawal과 같은 규칙 —
    // 없으면 0, 음수는 거절. 옛 기록에는 이 칸이 없어서 **빠져 있어도 통과해야 한다**
    const deposit = Number.isFinite(e.deposit) ? e.deposit : 0;
    if (deposit < 0) {
      return res.status(400).json({ error: `${e.month}: deposit이 올바르지 않습니다` });
    }
    const withdrawal = Number.isFinite(e.withdrawal) ? e.withdrawal : 0;
    if (withdrawal < 0) {
      return res.status(400).json({ error: `${e.month}: withdrawal이 올바르지 않습니다` });
    }
    // auto = 자동 기록(`services/trackerAuto.js`)이 넣은 줄이라는 표시.
    // ⚠ **true일 때만 실어 보낸다.** 이 표시가 없는 줄은 사람이 넣은 것으로 보고
    //   자동이 절대 덮어쓰지 않는다 (`utils/trackerMonths.mergeAuto`).
    //   ※ 결산 페이지에는 **줄을 고치는 기능이 없다** — 추가와 삭제뿐이다 (2026-09-27 확인).
    //     자동 줄의 값을 바꾸려면 `×`로 지우고(그 달이 autoSkip에 들어간다) 손으로 다시 넣는다.
    //     그렇게 넣은 줄에는 이 표시가 없으므로 그 뒤로 자동이 손대지 않는다
    const row = { month: e.month.trim(), asset: e.asset, deposit, withdrawal };
    if (e.auto === true) row.auto = true;
    clean.push(row);
  }

  // autoSkip = 자동이 넣었다가 사용자가 지운 달. 그 달을 다시 채우지 않게 하는 유일한 표시다
  const skip = Array.isArray(autoSkip)
    ? [...new Set(autoSkip.filter(m => typeof m === "string" && m.trim()).map(m => m.trim()))]
    : [];

  // ⚠ **달 순서로 정렬해 저장한다** (2026-09-27에 고친 버그). 페이지는 새 줄을 맨 끝에
  //   붙이는데, 수익은 "바로 윗줄의 월말 잔고"와 비교해 계산한다. 그래서 9월까지 있는
  //   표에 2월을 넣으면 2월이 9월 잔고와 비교되어 **그 줄과 다음 줄의 수익이 틀렸다.**
  //   자동 기록(mergeAuto)은 정렬해서 저장하지만, 바뀐 값이 없으면 저장을 건너뛰어
  //   틀린 순서가 남을 수 있었다. 저장하는 입구에서 정렬하면 어느 경로든 맞다
  //   (월은 `YYYY-MM`이라 문자열 비교가 곧 시간 순이다)
  clean.sort((a, b) => a.month.localeCompare(b.month));

  if (!store.save({ seed, entries: clean, autoSkip: skip })) {
    return res.status(500).json({ error: "파일 저장에 실패했습니다" });
  }
  res.json({ ok: true, count: clean.length });
});

module.exports = router;
