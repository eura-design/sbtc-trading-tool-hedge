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
export const VOL_H     = 80;
export const VOL_GAP   = 1;
export const MIN_QTY   = 0.001;
export const QTY_STEP  = 0.001;
export const HIT       = 8;
export const API_BASE  = "http://localhost:3002";
export const BN_PUBLIC = "https://demo-fapi.binance.com";
export const BN_WS     = "wss://demo-fstream.binance.com";

// 폴링 주기 (ms) — WS push가 주 경로, 폴링은 안전망 역할
export const POLLING = {
  BALANCE_MS:    60_000,
  POSITION_MS:   30_000,
  TPSL_MS:       60_000,
  SR_LEVELS_MS: 4 * 60 * 60_000,
};

// ── SVG/스타일 공통 색상 토큰 ────────────────────────────────────────────────
// 다크/라이트 양쪽에서 동일하게 사용되는 의미 기반 팔레트.
// 새 코드/리팩토링에서는 하드코딩된 hex 대신 이 토큰을 사용한다.
export const PALETTE = {
  long:     "#0ecb81",   // LONG/BULL/성공
  short:    "#f6465d",   // SHORT/BEAR/실패
  info:     "#60a5fa",   // 정보 (대기 주문, 청산 액션 등)
  accent:   "#c084fc",   // 강조 (드로잉/지표 활성)
  accent2:  "#a78bfa",   // 보조 강조 (R:R, 다이버전스 등)
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
];
