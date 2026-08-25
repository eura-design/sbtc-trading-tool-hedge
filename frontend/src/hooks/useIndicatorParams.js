import { useState, useCallback, useEffect } from "react";
import { api } from "../api/client";

export const INDICATOR_DEFAULTS = {
  vol: { colorMode: "neutral" },
  // zone_bg  — 과매수/과매도 구간을 **메인 차트** 배경에 세로 밴드로 표시 (2026-08-13)
  //   ⚠ `zone_max`(최근 N개)는 2026-08-15 사용자 요청으로 **키째 제거**됐다.
  //     몇 개를 칠할지는 이제 설정이 아니라 데이터가 정한다 — 마지막 구간과 같은 종류로
  //     연속된 꼬리만 나온다 (chart/overlayRenderers.js의 lastRsiZoneRun). 되살리지 말 것
  // tfs      — **구간 배경을 칠할 타임프레임** (중복 선택, 2026-08-14 사용자 확정).
  //   ⚠ 거르는 건 **배경뿐이다. RSI 패널(선)은 전 TF에서 계속 보인다** —
  //     App.jsx가 showRsi(패널)와 showRsiZones(배경)로 나눠 갖는다. 다시 합치지 말 것
  //   ⚠ 기본값은 **전 TF**다 — struct처럼 ["1h"]로 두면 기존 사용자에게 기능이 사라진 것처럼 보인다
  // zone_all — 구간 배경을 **전 구간** 칠한다 (2026-08-15 사용자 요청).
  //   기본 OFF = 위의 "마지막 연속 구간만". 노브가 아니라 on/off라 zone_max의 부활이 아니다
  //   ⚠ 기본을 true로 두지 말 것 — 5m처럼 구간이 잦은 TF에서 화면이 통째로 물든다
  rsi: { period: 14, overbought: 70, oversold: 30, zone_bg: true, zone_all: false,
         tfs: ["5m", "15m", "1h", "4h", "1d", "1w", "1M"] },
  // ※ RSI 다이버전스(`rsidiv`)는 2026-08-13 지표째로 제거됐다 — 키를 되살리지 말 것
  fvg: { lookback: 400, max_display: 20, mitigation_pct: 50, disp_threshold: 1.8, disp_atr_period: 14, displacement_only: false },
  ob:  { swing_lb: 5, bos_window: 30, ob_lookback: 20, scan_from: 500, mitigation_pct: 50, max_display: 15, disp_threshold: 1.8, disp_atr_period: 14, displacement_only: false, use_wick: false },
  // Pivot Levels — 스윙 피벗 터치 기반 지지/저항 (구 S/R Levels(KDE)를 대체, 2026-08-13)
  //   tfs — **레벨을 계산할 타임프레임** (중복 선택). 차트 TF와 무관하게 전 프레임에서
  //     여기 고른 TF들의 레벨이 똑같이 보인다 (수동 구조의 struct.tfs는 "표시 필터"라
  //     의미가 다르다 — 이쪽은 계산 대상 자체다)
  //   노출 4개: pivot_bars / merge_atr / min_touch / top_n — 전부 단조로운 노브다
  //   숨김  1개: lookback(600) — 훑는 구간. 늘려도 몇 달 전 레벨이 후보로 붙을 뿐인데,
  //     최악 조합(bars=2, merge=0.1)에서 1500봉이면 계산이 3.3ms → 26ms로 뛴다 (실측).
  //     600봉이 성능·의미 양쪽의 안전선
  // ⚠ 기본값은 실측으로 잡았다 (BTC 5m/15m/1h/4h/1d 각 1500봉 → 화면에 4~6줄).
  //   min_touch를 1로 내리면 통과 레벨이 3배(약 30개)로 늘어 아무 데나 선이 생긴다
  pivot: { tfs: ["1h", "4h", "1d"], pivot_bars: 8, merge_atr: 0.5, min_touch: 2, top_n: 3, lookback: 600 },
  // max_choch(표시 개수, null = 전체) / alert_choch(CHoCH 발생 알림) / opacity(투명도)는
  // 지표 메뉴가 아니라 **ZZ 선 클릭 → 더블클릭 팝업**에서 조작한다 (수동 구조와 같은 조작감).
  // max_choch 기본이 숫자면 낮춰둔 걸 잊고 "CHoCH가 안 뜬다"고 오해한다 → 기본은 전체
  // ※ show_legvol은 **없다** — 자동 ZZ의 레그 hover 거래량 비교는 2026-08-14 사용자 요청으로
  //   기능째로 제거됐다 (거래량 3줄은 수동 구조 전용). 키를 되살리지 말 것
  //   show_legvol — 레그 hover 거래량 비교 3줄 (2026-08-24 되살림, 수동 구조와 짝)
  //   ⚠ **alert_choch·show_legvol 둘 다 기본 false**다 (2026-08-24 사용자 요청).
  //     수동 구조(`alertChoch`/`showLegVol`)와 초기값을 맞춘 것이다 — 한쪽만 바꾸지 말 것.
  //     읽는 쪽은 `=== true`로 본다 (App.jsx) — `!== false`로 되돌리면 저장값이 없을 때 켜진다
  //   opacity — 2026-08-25 사용자 요청으로 0.25 → **0.3** (1.0 → 0.25는 2026-08-24).
  //     수동 구조의 STRUCT_DEFAULT_OPACITY와 **같은 값이어야 한다** (초기 수치 통일).
  //     한쪽만 바꾸지 말 것
  //     ※ 0.3인 이유는 슬라이더 눈금(10% 단위)에 맞추기 위해서다 — 0.25는 그전
  //       슬라이더의 최소값이었는데 같은 날 눈금이 바뀌며 그 위의 값이 아니게 됐다
  //     ⚠ 이건 **서버에 저장되는 값**이라 기본값을 바꿔도 이미 저장된 쪽이 이긴다 —
  //       `backend/indicator_params.json`도 같이 봐야 한다
  //   ※ alert_choch는 일부러 **다르게 둔다** — 자동 ZZ는 ON, 수동 구조는 OFF.
  //     수동 구조는 알림을 켜면 선이 호박색 점선이 되어, 기본 ON이면 모든 구조가
  //     그 색이 되어 색으로 알림 여부를 구분할 수 없게 된다 (Structures.jsx [R10]).
  //     자동 ZZ는 그 스타일이 없어 ON이어도 같은 문제가 생기지 않는다
  zz:  { left_bars: 5, use_filter: true, atr_mult: 1.5, atr_period: 14, max_choch: null, show_choch: true, alert_choch: false, show_legvol: false, opacity: 0.3 },
  // 수동 구조(Custom Structure Zigzag)
  //   tfs — 표시할 타임프레임 (중복 선택 가능, 기본 1h). **여기 있는 건 이것뿐이다.**
  //   ※ CHoCH 표시 on/off·개수는 구조마다 localStorage에 있다 (st.showChoch / st.maxChoch,
  //     더블클릭 팝업에서 설정 — Structures.jsx [R6])
  //   ※ 지표 전체 CHoCH 스위치(show_choch)는 2026-08-12 제거 — 구조별 토글과 AND로 걸려
  //     OFF로 저장돼 있으면 구조별 ON이 먹지 않는데 그걸 알아챌 UI가 없었다
  struct: { tfs: ["1h"] },
  // ⚠ **`fib` 키를 되살리지 말 것** (2026-08-15 제거, chart/fib.js [F1]).
  //   피보나치는 전역 파라미터가 하나도 없다 — 레벨 목록까지 **도형별**(localStorage "fibs")로
  //   옮겨 더블클릭 팝업에서 고른다. 지표 메뉴에서 Fibonacci 행 자체가 사라졌다.
  //   전역 값을 다시 만들면 도형별 값과 AND인지 덮어쓰기인지가 화면에 안 드러난다
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
