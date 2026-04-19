const fs   = require("fs");
const path = require("path");

const LOG_FILE  = path.join(__dirname, "../trade_log.json");
const MAX_ENTRIES = 1000;

/**
 * 체결/TP/SL 이벤트를 trade_log.json에 추가.
 * 파일이 없으면 생성, 있으면 append. 최대 1000건 유지.
 */
async function append(entry) {
  try {
    let logs = [];
    if (fs.existsSync(LOG_FILE)) {
      const raw = fs.readFileSync(LOG_FILE, "utf-8");
      logs = JSON.parse(raw);
    }
    logs.push({ ...entry, ts: entry.ts || Date.now() });
    if (logs.length > MAX_ENTRIES) logs = logs.slice(-MAX_ENTRIES);
    await fs.promises.writeFile(LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error("[TRADELOG] 저장 실패:", e.message);
  }
}

module.exports = { append };
