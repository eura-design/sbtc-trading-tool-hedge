import { useState, useCallback, useEffect } from "react";
import { api } from "../api/client";

export const INDICATOR_DEFAULTS = {
  vol: { colorMode: "neutral" },
  rsi: { period: 14, overbought: 70, oversold: 30 },
  fvg: { lookback: 400, max_display: 20, mitigation_pct: 50, disp_threshold: 1.8, disp_atr_period: 14, displacement_only: false },
  ob:  { swing_lb: 5, bos_window: 30, ob_lookback: 20, scan_from: 500, mitigation_pct: 50, max_display: 15, disp_threshold: 1.8, disp_atr_period: 14, displacement_only: false, use_wick: false },
  sr:  { kde_range: 20, persistence_atr: 0.5, bandwidth_atr: 0.3, peak_min_pers: 0.08, limit: 1000, top_n: 5 },
  // max_choch(표시 개수, null = 전체) / alert_choch(CHoCH 발생 알림) / opacity(투명도)는
  // 지표 메뉴가 아니라 **ZZ 선 클릭 → 더블클릭 팝업**에서 조작한다 (수동 구조와 같은 조작감).
  // max_choch 기본이 숫자면 낮춰둔 걸 잊고 "CHoCH가 안 뜬다"고 오해한다 → 기본은 전체
  zz:  { left_bars: 5, use_filter: true, atr_mult: 1.5, atr_period: 14, max_choch: null, show_choch: true, alert_choch: true, opacity: 1.0 },
  // 수동 구조(Custom Structure Zigzag)
  //   tfs — 표시할 타임프레임 (중복 선택 가능, 기본 1h). **여기 있는 건 이것뿐이다.**
  //   ※ CHoCH 표시 on/off·개수는 구조마다 localStorage에 있다 (st.showChoch / st.maxChoch,
  //     더블클릭 팝업에서 설정 — Structures.jsx [R6])
  //   ※ 지표 전체 CHoCH 스위치(show_choch)는 2026-08-12 제거 — 구조별 토글과 AND로 걸려
  //     OFF로 저장돼 있으면 구조별 ON이 먹지 않는데 그걸 알아챌 UI가 없었다
  struct: { tfs: ["1h"] },
  ema: [
    { id: 1, period: 10, color: "#888888", enabled: true },
    { id: 2, period: 20, color: "#f0b90b", enabled: true },
    { id: 3, period: 60, color: "#c084fc", enabled: true },
  ],
};

function mergeWithDefaults(saved) {
  const result = {};
  for (const key of Object.keys(INDICATOR_DEFAULTS)) {
    const def = INDICATOR_DEFAULTS[key];
    if (Array.isArray(def)) {
      result[key] = Array.isArray(saved?.[key]) && saved[key].length > 0
        ? saved[key]
        : [...def];
    } else {
      result[key] = { ...def, ...(saved?.[key] || {}) };
    }
  }
  return result;
}

export function useIndicatorParams() {
  const [params, setParams] = useState(() => mergeWithDefaults(null));

  // 마운트 시 서버에서 로드 (없으면 localStorage 마이그레이션)
  useEffect(() => {
    api("GET", "/api/indicator-params")
      .then(data => {
        const merged = mergeWithDefaults(data);
        setParams(merged);
        // localStorage 마이그레이션
        try {
          const local = JSON.parse(localStorage.getItem("indicatorParams") || "{}");
          if (Object.keys(local).length > 0) {
            const migrated = mergeWithDefaults(local);
            setParams(migrated);
            api("POST", "/api/indicator-params", migrated).catch(() => {});
            localStorage.removeItem("indicatorParams");
          }
        } catch {}
      })
      .catch(() => {
        // 서버 연결 실패 시 localStorage 폴백
        try {
          const local = JSON.parse(localStorage.getItem("indicatorParams") || "{}");
          setParams(mergeWithDefaults(local));
        } catch {}
      });
  }, []);

  const setParam = useCallback((indicator, key, value) => {
    setParams(prev => {
      const next = { ...prev, [indicator]: { ...prev[indicator], [key]: value } };
      api("POST", "/api/indicator-params", next).catch(() => {});
      return next;
    });
  }, []);

  const setEmaList = useCallback((newList) => {
    setParams(prev => {
      const next = { ...prev, ema: newList };
      api("POST", "/api/indicator-params", next).catch(() => {});
      return next;
    });
  }, []);

  const resetIndicator = useCallback((indicator) => {
    setParams(prev => {
      const def = INDICATOR_DEFAULTS[indicator];
      const next = { ...prev, [indicator]: Array.isArray(def) ? [...def] : { ...def } };
      api("POST", "/api/indicator-params", next).catch(() => {});
      return next;
    });
  }, []);

  return { params, setParam, setEmaList, resetIndicator };
}
