import { useState, useCallback } from "react";
import { useTheme } from "../../ThemeContext";
import { PALETTE } from "../../constants";

// localStorage에 영속화되는 percent state — 추가진입/분할TP 카드에서 공유
export function usePersistedPct(storageKey, defaultPct = 50) {
  const [pct, setPctState] = useState(() => Number(localStorage.getItem(storageKey)) || defaultPct);
  const setPct = useCallback((v) => {
    setPctState(v);
    localStorage.setItem(storageKey, v);
  }, [storageKey]);
  return [pct, setPct];
}

// 0~100% 슬라이더 (5% 단위, 최소 5%) + 상단 라벨/값 + 하단 0~100 가이드
export function PercentSlider({ pct, onChange, color, label, secondaryText }) {
  const { theme } = useTheme();
  return (
    <div style={{ marginBottom: "6px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "11px", color: theme.textMuted }}>{label}</span>
        <span style={{ fontSize: "12px", color, fontWeight: "600" }}>{secondaryText}</span>
      </div>
      <input
        type="range" min={0} max={100} step={5} value={pct}
        onChange={e => onChange(Math.max(5, Number(e.target.value)))}
        style={{ width: "100%", accentColor: color, cursor: "pointer", height: "3px" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between",
        fontSize: "11px", color: theme.textBare, marginTop: "2px" }}>
        <span>0%</span><span>100%</span>
      </div>
    </div>
  );
}

// "가격" 라벨 + 숫자 입력 + 방향 오류 메시지
export function PriceField({ price, onChange, error, label = "가격" }) {
  const { theme } = useTheme();
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "6px",
        marginBottom: error ? "4px" : "8px" }}>
        <span style={{ fontSize: "11px", color: theme.textMuted, flexShrink: 0 }}>{label}</span>
        <input
          type="number" value={price}
          onChange={e => onChange(e.target.value)}
          style={{
            flex: 1, padding: "4px 6px", borderRadius: "4px",
            background: theme.bgCard,
            border: `1px solid ${error ? PALETTE.short : theme.borderSec}`,
            color: theme.textPrimary, fontSize: "12px", fontFamily: "inherit", outline: "none",
          }}
        />
      </div>
      {error && (
        <div style={{ fontSize: "10px", color: PALETTE.short, marginBottom: "8px" }}>
          {error}
        </div>
      )}
    </>
  );
}

// 외곽선 + 색상 토큰 + 호버 강조 — 사이드바 액션 카드의 제출 버튼
export function SubmitButton({ disabled, onClick, color, children }) {
  const { theme } = useTheme();
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        width: "100%", padding: "8px 0", borderRadius: "5px",
        cursor: disabled ? "not-allowed" : "pointer",
        background: "transparent",
        border: `1px solid ${disabled ? theme.borderSec : color}`,
        color: disabled ? theme.textFaint : color,
        fontSize: "13px", fontFamily: "inherit", fontWeight: "700",
        transition: "background 0.15s",
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = `${color}22`; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

// embedded=true면 children만 반환, false면 카드 래퍼로 감쌈
export function CardWrapper({ embedded, title, extra, children }) {
  const { theme } = useTheme();
  if (embedded) return children;
  return (
    <div style={{ padding: "10px", border: `1px solid ${theme.borderSec}`,
      borderRadius: "5px", marginBottom: "10px" }}>
      <div style={{ fontSize: "12px", color: theme.textMuted, fontWeight: "600",
        letterSpacing: "0.05em", marginBottom: "8px" }}>
        {title}
        {extra}
      </div>
      {children}
    </div>
  );
}
