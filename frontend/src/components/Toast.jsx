import { useEffect, useRef, useState } from "react";
import { useTheme } from "../ThemeContext";

const AUTO_DISMISS_MS = 30000; // 일반 토스트 자동 제거 시간

// 개별 토스트 — 마운트 시 자체 타이머 시작
function ToastItem({ t, onRemove, theme }) {
  const [progress, setProgress] = useState(1); // 1→0
  const startRef = useRef(Date.now());
  const rafRef   = useRef(null);

  useEffect(() => {
    if (t.sticky) return; // sticky는 자체 타이머 없음

    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const ratio   = Math.max(0, 1 - elapsed / AUTO_DISMISS_MS);
      setProgress(ratio);
      if (ratio > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        onRemove(t.id);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [t.id, t.sticky]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirm = () => {
    onRemove(t.id);
    t.onConfirm?.();
  };

  return (
    <div style={{
      padding: t.sticky ? "16px 20px" : "12px 18px",
      background: theme.bgCard,
      border: `1.5px solid ${t.sticky ? "#f6465d" : "#f0b90b"}`,
      borderRadius: 8,
      fontSize: t.sticky ? 15 : 14,
      fontWeight: 600,
      color: theme.textPrimary,
      boxShadow: t.sticky
        ? "0 6px 28px rgba(246,70,93,0.35)"
        : "0 4px 20px rgba(0,0,0,0.5)",
      display: "flex",
      flexDirection: "column",
      gap: t.sticky ? 14 : 0,
      pointerEvents: t.sticky ? "auto" : "none",
      minWidth: t.sticky ? 280 : 200,
      animation: "toastIn 0.2s ease",
      overflow: "hidden",
      position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: t.sticky ? 22 : 18 }}>🔔</span>
        <span>{t.message}</span>
      </div>
      {t.sticky && (
        <button
          onClick={handleConfirm}
          style={{
            padding: "8px 0",
            borderRadius: 5,
            border: "none",
            background: "#f6465d",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            letterSpacing: "0.03em",
          }}
        >
          확인
        </button>
      )}
      {/* 진행 바 — sticky 아닐 때만 */}
      {!t.sticky && (
        <div style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: 3,
          width: `${progress * 100}%`,
          background: "#f0b90b",
          borderRadius: "0 0 0 8px",
        }} />
      )}
    </div>
  );
}

export function Toast({ toasts, onRemove }) {
  const { theme } = useTheme();
  if (!toasts.length) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      zIndex: 9999,
      pointerEvents: "none",
    }}>
      {toasts.map(t => (
        <ToastItem key={t.id} t={t} onRemove={onRemove} theme={theme} />
      ))}
    </div>
  );
}
