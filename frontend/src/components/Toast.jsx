import { useTheme } from "../ThemeContext";

export function Toast({ toasts }) {
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
        <div key={t.id} style={{
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
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: t.sticky ? 22 : 18 }}>🔔</span>
            <span>{t.message}</span>
          </div>
          {t.sticky && (
            <button
              onClick={t.onConfirm}
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
        </div>
      ))}
    </div>
  );
}
