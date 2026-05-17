import { useEffect, useRef } from "react";
import { useTheme } from "../../ThemeContext";
import { PALETTE } from "../../constants";

const KIND_LABEL = { line: "선", channel: "채널", circle: "원" };

export function LineOpacityPopup({ popup, drawables, onClose }) {
  const { theme } = useTheme();
  const ref  = useRef(null);
  const kind = popup.type; // "line" | "channel" | "circle"
  const d    = drawables[kind];
  const item = d?.items?.find(x => x.id === popup.id) ?? null;

  // 대상 도형이 사라지면(Delete 키 등) popup 자동 닫기
  useEffect(() => {
    if (!item) onClose();
  }, [item, onClose]);

  const opacity = item?.opacity ?? 1.0;
  const locked  = item?.locked  ?? false;
  const alert   = item?.alert   ?? false;

  // 외부 클릭 시 닫기
  useEffect(() => {
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey  = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown",   onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown",   onKey);
    };
  }, [onClose]);

  // 팝업이 화면 밖으로 나가지 않도록 위치 조정
  const W = 160, H = 80;
  const x = Math.min(popup.x, window.innerWidth  - W - 8);
  const y = Math.min(popup.y, window.innerHeight - H - 8);

  return (
    <div ref={ref} style={{
      position: "fixed", left: x, top: y,
      width: W, padding: "10px 12px",
      background: theme.bgCard,
      border: `1px solid ${theme.borderSec}`,
      borderRadius: "6px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      zIndex: 1000,
      userSelect: "none",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <span style={{ fontSize: "12px", color: theme.textMuted }}>{KIND_LABEL[kind]} 투명도</span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: PALETTE.accent, fontWeight: "700" }}>
            {Math.round(opacity * 100)}%
          </span>
          <button onClick={() => d.toggleAlert(popup.id)}
            title={alert ? "알림 ON — 클릭하여 OFF" : "알림 OFF — 클릭하여 ON"} style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: "14px", lineHeight: 1, opacity: alert ? 1 : 0.35,
            color: alert ? PALETTE.warn : theme.textMuted,
          }}>
            🔔
          </button>
          <button onClick={() => d.toggleLock(popup.id)} style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: "14px", lineHeight: 1, opacity: locked ? 1 : 0.4,
            color: locked ? PALETTE.warn : theme.textMuted,
          }}>
            {locked ? "🔒" : "🔓"}
          </button>
        </div>
      </div>
      <input
        type="range" min={0.25} max={1} step={0.25}
        value={opacity}
        onChange={e => d.setOpacity(popup.id, Math.max(0.25, parseFloat(e.target.value)))}
        style={{ width: "100%", accentColor: PALETTE.accent, cursor: "pointer" }}
      />
    </div>
  );
}
