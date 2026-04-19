import { useEffect, useRef } from "react";
import { useTheme } from "../../ThemeContext";

export function LineOpacityPopup({ popup, lines, onChangeOpacity, onToggleLock, onToggleAlert, onClose, channels, onChangeChannelOpacity, onToggleChannelLock, onToggleChannelAlert, circles, onChangeCircleOpacity, onToggleCircleLock, onToggleCircleAlert }) {
  const { theme } = useTheme();
  const ref  = useRef(null);
  const isChannel = popup.type === "channel";
  const isCircle  = popup.type === "circle";
  const item = isChannel ? channels?.find(c => c.id === popup.id)
             : isCircle  ? circles?.find(c => c.id === popup.id)
             : lines.find(l => l.id === popup.id);
  const opacity = item?.opacity ?? 1.0;
  const locked  = item?.locked  ?? false;
  const alert   = item?.alert   ?? false;

  const handleOpacity = v => isChannel ? onChangeChannelOpacity(popup.id, v) : isCircle ? onChangeCircleOpacity(popup.id, v) : onChangeOpacity(popup.id, v);
  const handleLock    = () => isChannel ? onToggleChannelLock(popup.id)    : isCircle ? onToggleCircleLock(popup.id)    : onToggleLock(popup.id);
  const handleAlert   = () => isChannel ? onToggleChannelAlert(popup.id)   : isCircle ? onToggleCircleAlert(popup.id)   : onToggleAlert(popup.id);

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
        <span style={{ fontSize: "12px", color: theme.textMuted }}>{isChannel ? "채널 투명도" : isCircle ? "원 투명도" : "선 투명도"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "#c084fc", fontWeight: "700" }}>
            {Math.round(opacity * 100)}%
          </span>
          <button onClick={handleAlert} title={alert ? "알림 ON — 클릭하여 OFF" : "알림 OFF — 클릭하여 ON"} style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: "14px", lineHeight: 1, opacity: alert ? 1 : 0.35,
            color: alert ? "#f0b90b" : theme.textMuted,
          }}>
            🔔
          </button>
          <button onClick={handleLock} style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: "14px", lineHeight: 1, opacity: locked ? 1 : 0.4,
            color: locked ? "#f0b90b" : theme.textMuted,
          }}>
            {locked ? "🔒" : "🔓"}
          </button>
        </div>
      </div>
      <input
        type="range" min={0.25} max={1} step={0.25}
        value={opacity}
        onChange={e => handleOpacity(Math.max(0.25, parseFloat(e.target.value)))}
        style={{ width: "100%", accentColor: "#c084fc", cursor: "pointer" }}
      />
    </div>
  );
}
