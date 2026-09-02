import { useState, useCallback } from "react";
import { lsGetJSON, lsSetJSON } from "../utils/storage";

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
  //     ⚠ 기본값을 바꿔도 **이미 저장된 쪽이 이긴다** — 처음 쓰는 브라우저에만 적용된다
  //   ※ 여기 있던 "alert_choch는 자동 ZZ만 ON" 줄은 지웠다 (2026-08-26) —
  //     2026-08-24에 둘 다 OFF로 통일했는데 그 줄만 남아 **바로 위 줄과 모순**됐다.
  //     실제 값은 위 한 줄(둘 다 false)이 맞다
  //   alert_tfs — **CHoCH를 감시할 타임프레임** (중복 선택, 2026-09-02 사용자 요청).
  //     `alert_choch`(켜고 끄기)와 AND다. **화면 필터가 아니라 감시 대상 목록이다** —
  //     RSI 알림(useAlertMonitor)처럼 TF마다 캔들을 따로 받아 백그라운드로 굴리므로,
  //     5분 차트를 보는 중에도 1시간 CHoCH가 울린다 (hooks/useChochAlert.js).
  //     ⚠ 화면 TF와 엮지 말 것 — 엮는 순간 이 기능이 있기 전으로 돌아간다
  //     ⚠ 기본값은 **전 TF**다 — struct처럼 좁혀 두면 이미 알림을 켜 둔 사용자에게
  //       기능이 고장 난 것처럼 보인다 (rsi.tfs와 같은 이유)
  //     ※ TF를 늘리면 그만큼 kline WebSocket이 늘어난다. 알림이 꺼져 있으면 하나도 안 연다
  zz:  { left_bars: 2, use_filter: true, atr_mult: 1.0, atr_period: 14, max_choch: null, show_choch: true, alert_choch: false, show_legvol: false, opacity: 0.3,
         alert_tfs: ["5m", "15m", "1h", "4h", "1d", "1w", "1M"] },
  // 수동 구조(Custom Structure Zigzag)
  //   tfs — 표시할 타임프레임 (중복 선택 가능, 기본 1h). **여기 있는 건 이것뿐이다.**
  //   ※ CHoCH 표시 on/off·개수는 구조마다 localStorage에 있다 (st.showChoch / st.maxChoch,
  //     더블클릭 팝업에서 설정 — Structures.jsx [R6])
  //   ※ 지표 전체 CHoCH 스위치(show_choch)는 2026-08-12 제거 — 구조별 토글과 AND로 걸려
  //     OFF로 저장돼 있으면 구조별 ON이 먹지 않는데 그걸 알아챌 UI가 없었다
  //   alert_tfs — **CHoCH를 감시할 타임프레임** (중복 선택, 기본 전 TF / 2026-09-02 사용자 요청).
  //     ⚠ **위 `tfs`(표시 TF)와 아무 관계가 없다.** 구조의 꼭짓점은 timestamp라 전 TF 공유이고,
  //       알림은 화면을 보지 않고 TF마다 캔들을 따로 받아 감시한다 (hooks/useChochAlert.js).
  //       표시 목록에 없는 TF도, 지금 보고 있지 않은 TF도 울린다. 같은 패널에 나란히 있지만
  //       하는 일이 다르니 **한쪽을 다른 쪽으로 거르지 말 것**
  //     ⚠ 구조별 🔔(alertChoch)와는 AND다 — "어느 구조를"은 팝업, "어느 TF에서"는 여기다.
  //       거기에 그 구조가 **자동 이어그리기(autoZz)를 켰는지**도 본다 (끈 구조는 "지금 발생"을
  //       추적하지 않아 알릴 것이 없다 — useChochAlert 주석)
  struct: { tfs: ["1h"], alert_tfs: ["5m", "15m", "1h", "4h", "1d", "1w", "1M"] },
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

// ⚠ **저장은 브라우저(localStorage) 하나뿐이다** (2026-08-26 정리).
//
// 그전에는 **파라미터는 서버**(`backend/indicator_params.json`), **지표 on/off는 브라우저**
// (`indicators`)로 갈려 있었다. 같은 지표 메뉴에서 만지는데 저장되는 곳이 달라서:
//   ① 한쪽만 지워지면 **반쪽만 초기화**된다 (브라우저를 청소하면 지표가 다 꺼지는데
//      세부 숫자는 그대로, 백엔드 파일이 없어지면 그 반대)
//   ② 백엔드가 꺼져 있을 때 세부 숫자를 바꾸면 `.catch(() => {})`에 먹혀
//      **아무 말 없이 사라졌다**
// 지표 설정은 도형·알림·단축키와 같은 "보기 설정"이고, 그것들은 전부 브라우저에 있다.
// 백엔드가 꺼져 있어도 차트는 그려져야 하므로 브라우저 쪽으로 모았다.
//
// ⚠ **서버로 되돌리지 말 것.** 되돌리면 위 두 문제가 그대로 돌아온다.
//   백업은 별도로 받는다 — 브라우저 저장소 전체를 백엔드가 스냅샷으로 뜬다.
//
// ※ 2026-08-26 하루 동안 백엔드 파일이 "옮겨 적기용"으로 남아 있었는데(브라우저에 값이
//   없을 때만 한 번 읽는 용도), 같은 날 **통째로 지웠다** — 이관이 끝난 뒤에는
//   그 파일이 **오늘 시점에 얼어붙은 낡은 사본**일 뿐이라, 나중에 브라우저를 비우면
//   한 달 전 설정이 슬쩍 되살아난다. 되살릴 방법은 백업이 있고 그쪽이 항상 최신이다.
//   (`backend/indicator_params.json` · `store/indicatorParamsStore.js` ·
//    `routes/indicatorparams.js`가 그때 함께 사라졌다)
const STORAGE_KEY = "indicatorParams";

export function useIndicatorParams() {
  const [params, setParams] = useState(() => mergeWithDefaults(lsGetJSON(STORAGE_KEY, null)));

  // 저장은 항상 브라우저. 실패해도 lsSetJSON이 로그를 남긴다
  const persist = useCallback((next) => { lsSetJSON(STORAGE_KEY, next); return next; }, []);

  const setParam = useCallback((indicator, key, value) => {
    setParams(prev => persist({ ...prev, [indicator]: { ...prev[indicator], [key]: value } }));
  }, [persist]);

  const setEmaList = useCallback((newList) => {
    setParams(prev => persist({ ...prev, ema: newList }));
  }, [persist]);

  const resetIndicator = useCallback((indicator) => {
    setParams(prev => {
      const def = INDICATOR_DEFAULTS[indicator];
      return persist({ ...prev, [indicator]: Array.isArray(def) ? [...def] : { ...def } });
    });
  }, [persist]);

  return { params, setParam, setEmaList, resetIndicator };
}
