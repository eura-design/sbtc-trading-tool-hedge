const fs   = require("fs");
const path = require("path");
const { log, errOf } = require("./logStore");

// ⚠ 저장 위치가 backend/가 아니라 **기타/**다 (2026-08-22 사용자 요청).
//   monthly_tracker.html이 그 폴더에 있고, 사용자가 데이터도 같은 자리에서 보길 원했다.
//   백업·git 관리도 페이지 옆에 있어야 짝이 맞는다
const FILE = path.join(__dirname, "..", "..", "기타", "tracker_data.json");

// autoSkip = 자동이 넣었다가 **사용자가 지운 달** (2026-09-26). 이게 없으면 지운 줄이
// 다음 자동 실행에 되살아나 지울 방법이 없어진다 (`utils/trackerMonths.mergeAuto` 참고)
const DEFAULTS = { seed: 3000, entries: [], autoSkip: [] };

function load() {
  try {
    if (!fs.existsSync(FILE)) return { ...DEFAULTS, entries: [], autoSkip: [] };
    const saved = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return {
      seed:    Number.isFinite(saved.seed) && saved.seed > 0 ? saved.seed : DEFAULTS.seed,
      entries: Array.isArray(saved.entries) ? saved.entries : [],
      // 2026-09-26 이전 파일에는 이 칸이 없다 — 없으면 빈 목록이다
      autoSkip: Array.isArray(saved.autoSkip) ? saved.autoSkip.filter(m => typeof m === "string") : [],
    };
  } catch (e) {
    log("STORE_IO_FAILED", { level: "error", store: "tracker", op: "load", err: errOf(e) });
    return { ...DEFAULTS, entries: [], autoSkip: [] };
  }
}

// ⚠ 임시 파일에 쓰고 rename한다 — 결산 기록은 손으로 넣은 값이라 다시 만들 수 없다.
//   writeFileSync가 중간에 끊기면 원본이 반쯤 잘린 채 남아 통째로 날아간다
function save(data) {
  const tmp = FILE + ".tmp";
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, FILE);
    return true;
  } catch (e) {
    log("STORE_IO_FAILED", { level: "error", store: "tracker", op: "save", err: errOf(e) });
    try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

module.exports = { load, save, DEFAULTS, FILE };
