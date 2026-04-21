const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../indicator_params.json");

const DEFAULTS = {
  vol: { colorMode: "neutral" },
  rsi: { period: 14, overbought: 70, oversold: 30 },
  fvg: { lookback: 400, max_display: 20, mitigation_pct: 50, disp_threshold: 1.8, disp_atr_period: 14, displacement_only: false },
  ob:  { swing_lb: 5, bos_window: 30, ob_lookback: 20, scan_from: 500, mitigation_pct: 50, max_display: 15, disp_threshold: 1.8, disp_atr_period: 14, displacement_only: false },
  div: { peak_lb: 5, scan_candles: 300, max_show: 10 },
  tri: { lb: 5, scan: 200 },
  sr:  { kde_range: 20, persistence_atr: 0.5, bandwidth_atr: 0.3, peak_min_pers: 0.08, limit: 1000, top_n: 5 },
  liq: { swing_lb: 5, tolerance_pct: 0.15, scan_from: 500, max_display: 10, min_touches: 2 },
  ms:  { swing_lb: 5, scan_from: 500, max_display: 15, close_only: true },
  pd:  { swing_lb: 5, lookback: 200 },
  ema: [
    { id: 1, period: 10, color: "#888888", enabled: true },
    { id: 2, period: 20, color: "#f0b90b", enabled: true },
    { id: 3, period: 60, color: "#c084fc", enabled: true },
  ],
};

function load() {
  try {
    if (!fs.existsSync(FILE)) return DEFAULTS;
    const saved = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    const result = {};
    for (const key of Object.keys(DEFAULTS)) {
      const def = DEFAULTS[key];
      if (Array.isArray(def)) {
        result[key] = Array.isArray(saved[key]) && saved[key].length > 0 ? saved[key] : [...def];
      } else {
        result[key] = { ...def, ...(saved[key] || {}) };
      }
    }
    return result;
  } catch (e) {
    console.error("[IndicatorParamsStore] 로드 실패:", e.message);
    return DEFAULTS;
  }
}

function save(params) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(params), "utf-8");
  } catch (e) {
    console.error("[IndicatorParamsStore] 저장 실패:", e.message);
  }
}

module.exports = { load, save, DEFAULTS };
