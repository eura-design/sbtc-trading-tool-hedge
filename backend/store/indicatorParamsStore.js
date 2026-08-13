const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../indicator_params.json");

const DEFAULTS = {
  vol: { colorMode: "neutral" },
  // zone_bg/zone_max — 과매수·과매도 구간 배경(메인 차트) 표시 여부 / 최근 N개(null = 전체)
  rsi: { period: 14, overbought: 70, oversold: 30, zone_bg: true, zone_max: 5 },
  fvg: { lookback: 400, max_display: 20, mitigation_pct: 50, disp_threshold: 1.8, disp_atr_period: 14, displacement_only: false },
  ob:  { swing_lb: 5, bos_window: 30, ob_lookback: 20, scan_from: 500, mitigation_pct: 50, max_display: 15, disp_threshold: 1.8, disp_atr_period: 14, displacement_only: false, use_wick: false },
  // S/R — 6개 전부 유지한다(KDE.py로 그대로 전달). 단 **UI에 뜨는 건 3개뿐**:
  // bandwidth_atr / peak_min_pers / top_n. 나머지는 프론트가 값만 들고 다닌다.
  // 여기서 키를 빼면 load()가 통째로 버려 숨긴 값이 저장되지 않는다
  // (프론트 INDICATOR_DEFAULTS.sr와 반드시 같은 값으로 유지 — 이유는 그쪽 주석 참고)
  sr:  { kde_range: 20, persistence_atr: 2.0, bandwidth_atr: 0.6, peak_min_pers: 0.20, limit: 1000, top_n: 8 },
  liq: { swing_lb: 5, tolerance_pct: 0.15, scan_from: 500, max_display: 10, min_touches: 2 },
  // max_choch(표시 개수, null = 전체) / alert_choch / opacity는 ZZ 선 더블클릭 팝업에서 조작
  zz:  { left_bars: 5, use_filter: true, atr_mult: 1.5, atr_period: 14, max_choch: null, show_choch: true, alert_choch: true, opacity: 1.0 },
  pd:  { swing_lb: 5, lookback: 200 },
  // 수동 구조(Custom Structure Zigzag) — tfs: 표시 타임프레임(중복 선택, 기본 1h)
  // ※ CHoCH 표시 on/off·개수는 구조마다 localStorage에 들고 있다 (st.showChoch/st.maxChoch)
  // ※ 지표 전체 스위치 show_choch는 2026-08-12 제거 (프론트가 더 이상 읽지 않는다)
  struct: { tfs: ["1h"] },
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
