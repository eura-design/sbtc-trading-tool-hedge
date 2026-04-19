import { useTheme } from "../ThemeContext";

export function Slider({ label, value, min, max, step, onChange, format, color = "#f0b90b" }) {
  const { theme } = useTheme();
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
      <span style={{ fontSize:"12px", color:theme.textMuted, flexShrink:0 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex:1, accentColor:color, cursor:"pointer", height:"3px" }} />
      <span style={{ fontSize:"13px", color, fontWeight:"600", flexShrink:0, minWidth:"36px", textAlign:"right" }}>{format(value)}</span>
    </div>
  );
}
