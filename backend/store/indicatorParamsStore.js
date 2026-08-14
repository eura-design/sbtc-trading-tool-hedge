const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../indicator_params.json");

const DEFAULTS = {
  vol: { colorMode: "neutral" },
  // zone_bg/zone_max — 과매수·과매도 구간 배경(메인 차트) 표시 여부 / 최근 N개(1~10, null = 전체)
  // tfs — **구간 배경**을 칠할 타임프레임(중복 선택, 2026-08-14). RSI 패널(선)은 전 TF 공통이다.
  //   기본은 전 TF = 현상 유지.
  //   ⚠ 이 키가 없으면 load()가 통째로 버려서 선택이 새로고침마다 되돌아간다 (struct.tfs와 같은 함정)
  rsi: { period: 14, overbought: 70, oversold: 30, zone_bg: true, zone_max: 5,
         tfs: ["5m", "15m", "1h", "4h", "1d", "1w", "1M"] },
  // ※ RSI 다이버전스(`rsidiv`)는 2026-08-13 지표째로 제거됐다 — 키를 되살리지 말 것
  //   (load()는 여기 있는 키만 통과시키므로, 저장 파일에 남은 rsidiv는 자연히 버려진다)
  fvg: { lookback: 400, max_display: 20, mitigation_pct: 50, disp_threshold: 1.8, disp_atr_period: 14, displacement_only: false },
  ob:  { swing_lb: 5, bos_window: 30, ob_lookback: 20, scan_from: 500, mitigation_pct: 50, max_display: 15, disp_threshold: 1.8, disp_atr_period: 14, displacement_only: false, use_wick: false },
  // ※ 구 S/R Levels(KDE.py)의 `sr` 키는 2026-08-13 지표째로 제거됐다 — Pivot Levels가 대체한다
  liq: { swing_lb: 5, tolerance_pct: 0.15, scan_from: 500, max_display: 10, min_touches: 2 },
  // Pivot Levels (프론트 계산형 지지/저항) — 프론트 INDICATOR_DEFAULTS.pivot와 같은 값 유지.
  // tfs = 레벨을 계산할 타임프레임(중복 선택). lookback은 UI에 없지만
  // 여기 키가 없으면 load()가 버려서 저장이 안 된다
  pivot: { tfs: ["1h", "4h", "1d"], pivot_bars: 8, merge_atr: 0.5, min_touch: 2, top_n: 3, lookback: 600 },
  // show_choch(표시 on/off) / max_choch(표시 개수, null = 전체)는 ZZ 선 더블클릭 팝업 + 지표 메뉴 ZZ ⚙
  // (같은 값을 가리키는 거울). alert_choch / opacity는 팝업에만 있다
  // ※ show_legvol은 **없다** — 자동 ZZ의 레그 hover 거래량 비교는 2026-08-14 사용자 요청으로
  //   기능째로 제거됐다 (거래량 3줄은 수동 구조 전용, 구조마다 localStorage의 showLegVol).
  //   키를 되살리지 말 것 — 프론트가 더 이상 읽지 않는다
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
