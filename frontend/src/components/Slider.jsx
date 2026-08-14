import { useTheme } from "../ThemeContext";

export function Slider({ label, value, min, max, step, onChange, format, color = "#f0b90b" }) {
  const { theme } = useTheme();
  // 지나온 구간을 색으로 채운다.
  // ⚠ `appearance:none`(손잡이 크기를 줄이려면 필수 — index.css 참고)을 걸면 `accent-color`가
  //   해주던 이 채움이 사라진다. 브라우저가 "채워진 쪽"만 칠하는 표준 방법을 주지 않으므로
  //   값 비율로 자른 linear-gradient를 트랙 배경으로 넣어 되살린다.
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const track = `linear-gradient(to right, ${color} ${pct}%, ${theme.borderSec} ${pct}%)`;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
      <span style={{ fontSize:"12px", color:theme.textMuted, flexShrink:0 }}>{label}</span>
      {/* 손잡이를 9px로 줄인 얇은 슬라이더 — 스타일은 index.css의 `.slim-range`.
          accentColor로는 크기를 못 바꿔서 트랙까지 직접 그린다 (그쪽 주석 참고).
          색 두 개는 CSS 변수로 넘긴다: 손잡이는 슬라이더마다 다르고, 트랙은 테마를 탄다 */}
      <input type="range" className="slim-range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex:1, cursor:"pointer", "--sl-color": color, "--sl-track": track }} />
      <span style={{ fontSize:"13px", color, fontWeight:"600", flexShrink:0, minWidth:"36px", textAlign:"right" }}>{format(value)}</span>
    </div>
  );
}
