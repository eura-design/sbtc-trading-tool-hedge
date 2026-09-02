export const DARK = {
  bgMain:       "#060a12",
  bgSidebar:    "#080e1a",
  bgCard:       "#0b1120",
  bgCardAlt:    "#0d1218",
  bgWarning:    "#160f00",
  bgError:      "#1c0a0a",
  bgSuccess:    "#0a1a0a",
  bgMarket:     "#1a0d00",
  border:       "#0d1421",
  borderSec:    "#1f2937",
  textPrimary:  "#e2e8f0",
  textSec:      "#94a3b8",
  textMuted:    "#4b5563",
  textFaint:    "#374151",
  textBare:     "#1f2937",
  textDisabled: "#2d3748",
};

export const LIGHT = {
  bgMain:       "#ffffff",
  bgSidebar:    "#f1f5f9",
  bgCard:       "#e8edf5",
  bgCardAlt:    "#f1f5f9",
  bgWarning:    "#fffbeb",
  bgError:      "#fef2f2",
  bgSuccess:    "#f0fdf4",
  bgMarket:     "#fff7ed",
  border:       "#e2e8f0",
  borderSec:    "#cbd5e1",
  textPrimary:  "#0f172a",
  textSec:      "#64748b",
  textMuted:    "#475569",
  textFaint:    "#94a3b8",
  textBare:     "#e2e8f0",
  textDisabled: "#94a3b8",
};

export const SIDEBAR_W = 272;
export const M         = { top: 20, right: 72, bottom: 36, left: 6 };
export const RSI_H     = 160;
export const RSI_GAP   = 1;
// ※ `RSI_ZONE_MAX`(구간 배경 개수 상한)는 2026-08-15 제거됐다 — 개수 조절 자체가
//   없어졌기 때문이다. 지금은 마지막 구간과 같은 종류로 연속된 꼬리만 칠한다
//   (chart/overlayRenderers.js의 lastRsiZoneRun)
export const VOL_H     = 80;
export const VOL_GAP   = 1;
// ⚠ **BTCUSDT의 값이자, 서버에서 못 받았을 때의 대비책일 뿐이다** (2026-09-02).
//   진짜 값은 바이낸스 `exchangeInfo`가 정하고 `GET /api/symbols`로 내려온다
//   (`hooks/useSymbolFilters.js`). 코인마다 다르다 — SOL은 0.01, DOGE는 **1**이다.
//   ⚠ 새 코드에서 이걸 직접 import하지 말 것. 화면에 DOGE를 띄워 놓고 0.001로
//     계산하면 "0.001 DOGE 주문"이 뜨는데 실제로는 나갈 수 없는 수량이다.
//     `useSymbolFilters()`가 주는 값을 쓸 것
export const MIN_QTY   = 0.001;
export const QTY_STEP  = 0.001;
export const HIT       = 8;

// 도형 선택 시 뜨는 금색 핸들의 반지름 (px) — **트렌드라인/채널/원/피보나치/수동 구조 공통**.
//
// ⚠ 2026-08-14 사용자 지정: 기준은 **수동 구조 꼭짓점**이다. 나머지 도형이 r=5라 두 배로
//   커 보였고, "구조의 점 크기가 마음에 든다"며 전부 여기 맞췄다. 한 곳만 되돌리지 말 것 —
//   같은 금색 핸들인데 도형마다 크기가 다르면 선택 상태가 도형별로 달라 보인다.
// ※ **잡는 반경과는 무관하다.** 드래그 히트 판정은 hitDetection의 10px 고정이라
//   점을 작게 그려도 집기 어려워지지 않는다 (보이는 크기만 줄인 것).
// ※ 그리는 중 프리뷰 점(r=3)은 대상이 아니다 — 그건 "선택"이 아니라 "지금 찍은 첫 점" 표시고
//   구조 draft 점과 이미 같은 크기다.
export const SEL_HANDLE_R = 2.5;

// 처음 켤 때의 심볼. 사용자가 고른 값은 localStorage("symbol")에 남는다
export const DEFAULT_SYMBOL = "BTCUSDT";

export const API_BASE  = "http://localhost:3002";
export const BN_PUBLIC = "https://fapi.binance.com";
export const BN_WS     = "wss://fstream.binance.com/market";

// 폴링 주기 (ms) — WS push가 주 경로, 폴링은 안전망 역할
export const POLLING = {
  BALANCE_MS:    60_000,
  POSITION_MS:   30_000,
  TPSL_MS:       60_000,
};

// ── SVG/스타일 공통 색상 토큰 ────────────────────────────────────────────────
// 다크/라이트 양쪽에서 동일하게 사용되는 의미 기반 팔레트.
// 새 코드/리팩토링에서는 하드코딩된 hex 대신 이 토큰을 사용한다.
export const PALETTE = {
  long:     "#0ecb81",   // LONG/BULL/성공
  short:    "#f6465d",   // SHORT/BEAR/실패
  info:     "#60a5fa",   // 정보 (대기 주문, 청산 액션 등)
  accent:   "#c084fc",   // 강조 (드로잉/지표 활성)
  accent2:  "#a78bfa",   // 보조 강조 (R:R 등)
  warn:     "#f0b90b",   // 경고 (변경 확인, 평균가 등)
  liq:      "#ff4444",   // 청산가
  neutralFg:"#94a3b8",   // 보조 텍스트 — 색 강조 없는 수치
};

// ── 캔버스 공통 색상 토큰 ─────────────────────────────────────────────────────
export const CANVAS_C = {
  BULL_DARK:   "#0ecb81",
  BULL_LIGHT:  "#70ccbd",
  BEAR_DARK:   "#f6465d",
  BEAR_LIGHT:  "#faa1a4",
  NEUTRAL:     "#888888",
  // RSI 과매수/과매도 — **색으로 구분한다** (2026-08-13 사용자 요청으로 변경.
  //   그전에는 둘 다 파랑이었다 — "지금 극단 구간"만 알면 된다는 이유였는데,
  //   과매수는 붉은 계열이 직관적이라는 판단으로 바꿨다. 되돌리지 말 것)
  // ⚠ RSI 패널의 선·기준선과 메인 차트 구간 배경이 **같은 토큰**을 쓴다 —
  //   한쪽만 바꾸면 같은 조건인데 패널은 파랑, 배경은 빨강처럼 어긋난다
  RSI_ZONE_OB: "#f6465d",   // 과매수 — 캔들 하락색과 같은 빨강(경고의 의미가 통일된다)
  RSI_ZONE_OS: "#60a5fa",   // 과매도 — 기존 파랑 그대로
  // ※ 구 S/R Levels(KDE)의 보라 점선 색(SR_LINE_DARK/LIGHT)은 지표째로 제거됐다 (2026-08-13)
  // Pivot Levels — 지지=청록 / 저항=장미. **현재가 기준 방향을 색으로만** 알린다
  // (숫자 라벨을 붙이지 않기로 했으므로 방향은 색이 유일한 단서다).
  // ⚠ 캔들의 BULL/BEAR(#0ecb81 / #f6465d)와 **일부러 다른 값**이다 —
  //   같은 색이면 포지션 라인(진입/TP/SL)과 한눈에 구분이 안 된다
  // ⚠ S/R처럼 테마별로 나눠 둔다: 밝은 톤은 흰 배경에서, 진한 톤은 검은 배경에서 묻힌다
  PIVOT_SUP_DARK:  "#2dd4bf",
  PIVOT_SUP_LIGHT: "#0d9488",
  PIVOT_RES_DARK:  "#fb7185",
  PIVOT_RES_LIGHT: "#e11d48",
  AXIS:        "#1f2937",
  XTICK:       "#374151",
  YTICK:       "#4b5563",
};

export const INTERVALS = [
  { label: "5분",  value: "5m"  },
  { label: "15분", value: "15m" },
  { label: "1시간", value: "1h" },
  { label: "4시간", value: "4h" },
  { label: "1일",  value: "1d"  },
  { label: "1주",  value: "1w"  },
  { label: "1월",  value: "1M"  },
];

// 타임프레임별 봉 길이(ms) — INTERVAL_MS / TF_SECS 대체 단일 소스
export const TF_MS = {
  "5m":  5  * 60_000,
  "15m": 15 * 60_000,
  "1h":  60 * 60_000,
  "4h":  4  * 60 * 60_000,
  "1d":  24 * 60 * 60_000,
  "1w":  7  * 24 * 60 * 60_000,
  "1M":  30 * 24 * 60 * 60_000,
};
