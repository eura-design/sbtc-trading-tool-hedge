import { useState, useRef, useEffect } from "react";
import { useTheme } from "../ThemeContext";

const TFS  = ["5m", "15m", "1h", "4h", "1d", "1w", "1M"];
const ROWS = [
  { key: "rsiOB",     label: "RSI 과매수" },
  { key: "rsiOS",     label: "RSI 과매도" },
  { key: "div",       label: "다이버전스" },
  { key: "hiddenDiv", label: "히든 다이버전스" },
  { key: "close",     label: "봉 마감" },
];

function Checkbox({ on, onClick, theme }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 14, height: 14, flexShrink: 0,
        border: `1.5px solid ${on ? "#f0b90b" : theme.textFaint}`,
        borderRadius: 3,
        background: on ? "#f0b90b" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, color: "#000", fontWeight: "700",
        cursor: "pointer", transition: "all 0.12s",
      }}
    >
      {on ? "✓" : ""}
    </div>
  );
}

export function NotificationMenu({ settings, onToggle }) {
  const { theme } = useTheme();
  const [open, setOpen]   = useState(false);
  const ref               = useRef(null);

  useEffect(() => {
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // 활성화된 알림 수 계산
  const activeCount = TFS.reduce((acc, tf) =>
    acc + ROWS.filter(r => settings[tf]?.[r.key]).length, 0
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="알림 설정"
        style={{
          height: "22px", padding: "0 9px",
          borderRadius: "3px", cursor: "pointer", flexShrink: 0,
          display: "flex", alignItems: "center", gap: 4,
          fontSize: "13px", fontFamily: "inherit",
          background: open ? theme.borderSec : "transparent",
          border: `1px solid ${activeCount > 0 ? "#f0b90b" : open ? theme.textMuted : theme.textFaint}`,
          color: activeCount > 0 ? "#f0b90b" : theme.textMuted,
          transition: "all 0.15s",
        }}
      >
        🔔{activeCount > 0 && <span style={{ fontSize: 11, fontWeight: 700 }}>{activeCount}</span>}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "30px", right: 0, zIndex: 300,
          background: theme.bgCard,
          border: `1px solid ${theme.borderSec}`,
          borderRadius: 6,
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          padding: "10px 12px",
          userSelect: "none",
        }}>
          {/* 헤더 */}
          <div style={{ display: "flex", marginBottom: 6 }}>
            <div style={{ width: 110 }} />
            {TFS.map(tf => (
              <div key={tf} style={{
                width: 36, textAlign: "center",
                fontSize: 11, fontWeight: 700,
                color: theme.textSec,
              }}>{tf}</div>
            ))}
          </div>

          {/* 행 */}
          {ROWS.map(row => (
            <div key={row.key} style={{
              display: "flex", alignItems: "center",
              paddingTop: 5, paddingBottom: 5,
              borderTop: `1px solid ${theme.border}`,
            }}>
              <div style={{ width: 110, fontSize: 12, color: theme.textMuted, whiteSpace: "nowrap" }}>
                {row.label}
              </div>
              {TFS.map(tf => (
                <div key={tf} style={{ width: 36, display: "flex", justifyContent: "center" }}>
                  <Checkbox
                    on={settings[tf]?.[row.key] ?? false}
                    onClick={() => onToggle(tf, row.key)}
                    theme={theme}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
