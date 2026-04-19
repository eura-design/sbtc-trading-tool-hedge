import { useTheme } from "../ThemeContext";

/**
 * 주문/TP·SL 결과 알림 배너.
 * @param {{ type:"success"|"error", msg:string }} status
 * @param {function} onClose
 */
export function StatusAlert({ status, onClose }) {
  const { theme } = useTheme();
  if (!status) return null;

  const ok = status.type === "success";
  return (
    <div style={{
      padding:"8px 10px", borderRadius:"5px", fontSize:"11px", marginBottom:"12px",
      background: ok ? theme.bgSuccess : theme.bgError,
      border:`1px solid ${ok ? "#0ecb8133" : "#f6465d33"}`,
      color: ok ? "#0ecb81" : "#f6465d",
      display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"6px",
    }}>
      <span>{ok ? "✓" : "✗"} {status.msg}</span>
      <button onClick={onClose}
        style={{ background:"none", border:"none", color:"#374151", cursor:"pointer", fontSize:"13px", flexShrink:0 }}>
        ×
      </button>
    </div>
  );
}
