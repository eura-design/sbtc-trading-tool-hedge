const { spawn }    = require("child_process");
const path         = require("path");
const paramStore   = require("../store/indicatorParamsStore");

const KDE_SCRIPT   = path.resolve(__dirname, "../../기타/KDE.py");
const INTERVAL_MS  = 4 * 60 * 60 * 1000;

let cache = { price: null, timestamp: null, levels: [] };
let timer = null;

// ── KDE 실행 (params 선택적) ───────────────────────────────────────────────────
function runKDE(params = {}) {
  return new Promise((resolve) => {
    const args = [KDE_SCRIPT, "--json"];

    if (params.kde_range       != null) args.push("--kde-range",       String(params.kde_range / 100));
    if (params.persistence_atr != null) args.push("--persistence-atr", String(params.persistence_atr));
    if (params.bandwidth_atr   != null) args.push("--bandwidth-atr",   String(params.bandwidth_atr));
    if (params.peak_min_pers   != null) args.push("--peak-min-pers",   String(params.peak_min_pers));
    if (params.limit           != null) args.push("--limit",           String(params.limit));
    if (params.top_n           != null) args.push("--top-n",           String(params.top_n));

    const proc = spawn("python", args);
    let stdout = "";

    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => {
      const line = d.toString().trim();
      if (line) console.log("[SR]", line);
    });

    proc.on("close", (code) => {
      if (code !== 0) { console.error("[SR] KDE.py 종료 코드:", code); resolve(false); return; }
      try {
        const jsonLine = stdout.split("\n").find(l => l.trim().startsWith("{"));
        if (!jsonLine) { console.error("[SR] JSON 라인 없음"); resolve(false); return; }
        const result = JSON.parse(jsonLine.trim());
        cache = result;
        console.log(`[SR] S/R 업데이트 완료 — ${cache.levels.length}개 레벨 (현재가 $${cache.price})`);
        resolve(result);
      } catch (e) {
        console.error("[SR] JSON 파싱 실패:", e.message);
        resolve(false);
      }
    });
  });
}

async function start() {
  const { sr } = paramStore.load();
  await runKDE(sr || {});
  timer = setInterval(() => {
    const { sr: srParams } = paramStore.load();
    runKDE(srParams || {});
  }, INTERVAL_MS);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function getCache() { return cache; }

module.exports = { start, stop, getCache, runKDE };
