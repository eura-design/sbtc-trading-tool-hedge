import { useState, useRef, useEffect } from "react";
import { useTheme } from "../ThemeContext";
import { DEFAULT_SHORTCUTS, keyToDisplay } from "../hooks/useShortcutSettings";

const SHORTCUT_IDS = Object.keys(DEFAULT_SHORTCUTS);

export function ShortcutMenu({ shortcuts, onUpdate, onReset }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(null); // 현재 녹음 중인 단축키 id
  const ref = useRef(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    const onDown = e => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setRecording(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // 키 녹음
  useEffect(() => {
    if (!recording) return;
    const onKey = e => {
      e.preventDefault();
      e.stopPropagation();
      onUpdate(recording, e.key);
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onUpdate]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => { setOpen(o => !o); setRecording(null); }}
        title="단축키 설정"
        style={{
          height: "22px", padding: "0 7px", borderRadius: "3px",
          cursor: "pointer", flexShrink: 0,
          fontSize: "12px", fontFamily: "inherit",
          background: open ? theme.borderSec : "transparent",
          border: `1px solid ${open ? theme.textMuted : theme.textFaint}`,
          color: theme.textMuted, transition: "all 0.15s",
        }}
      >⌨</button>

      {open && (
        <div style={{
          position: "absolute", top: "30px", left: 0, zIndex: 300,
          background: theme.bgCard, border: `1px solid ${theme.borderSec}`,
          borderRadius: 6, boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          padding: "10px 14px", minWidth: 260, userSelect: "none",
        }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: theme.textPrimary,
            marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>단축키 설정</span>
            <button onClick={onReset} style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 3,
              background: "transparent", border: `1px solid ${theme.textFaint}`,
              color: theme.textMuted, cursor: "pointer",
            }}>초기화</button>
          </div>

          {SHORTCUT_IDS.map(id => {
            const sc = shortcuts[id];
            const isRec = recording === id;
            return (
              <div key={id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "5px 0", borderTop: `1px solid ${theme.border}`,
              }}>
                <span style={{ fontSize: 12, color: theme.textMuted }}>{sc.label}</span>
                <button
                  onClick={() => setRecording(isRec ? null : id)}
                  style={{
                    minWidth: 50, height: 22, padding: "0 8px",
                    borderRadius: 3, cursor: "pointer",
                    fontSize: 11, fontFamily: "inherit", fontWeight: 600,
                    background: isRec ? "#f0b90b" : theme.border,
                    border: `1px solid ${isRec ? "#f0b90b" : theme.borderSec}`,
                    color: isRec ? "#000" : theme.textPrimary,
                    transition: "all 0.12s",
                  }}
                >
                  {isRec ? "키 입력..." : keyToDisplay(sc.key)}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
