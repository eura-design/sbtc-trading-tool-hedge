import { useTheme } from "../ThemeContext";

export function Slider({ label, value, min, max, step, onChange, format, color = "#f0b90b" }) {
  const { theme } = useTheme();
  // 지나온 구간을 색으로 채운다.
  // ⚠ `appearance:none`(손잡이 크기를 줄이려면 필수 — index.css 참고)을 걸면 `accent-color`가
  //   해주던 이 채움이 사라진다. 브라우저가 "채워진 쪽"만 칠하는 표준 방법을 주지 않으므로
  //   값 비율로 자른 linear-gradient를 트랙 배경으로 넣어 되살린다.
  // ⚠ **막대는 0에서 시작한다 — 손잡이만 min 아래로 못 내려간다** (2026-08-24 사용자 요청).
  //   min이 0이 아닌 슬라이더(리스크 0.5%, 레버리지 1x)는 왼쪽 끝이 곧 최소값이라
  //   "여기가 바닥인지, 더 내려갈 수 있는데 막힌 건지"가 모양에서 안 읽혔다.
  //   0에서 시작하는 트랙 + 최소값에서 멈추는 손잡이 = 이미 청산·추가진입 슬라이더가
  //   쓰던 방식이다 (cardControls.PercentSlider의 `min={0}` + `Math.max(5, …)`).
  //   채움 비율도 같은 0 기준이라야 트랙과 어긋나지 않는다.
  const lo  = Math.min(min, 0);
  const pct = max > lo ? ((value - lo) / (max - lo)) * 100 : 0;
  const track = `linear-gradient(to right, ${color} ${pct}%, ${theme.borderSec} ${pct}%)`;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
      {/* ⚠ 라벨 폭을 고정한다 (2026-08-22 사용자 요청). 안 그러면 글자 수만큼 트랙이
          밀려서 `레버리지`(48px)만 `▲ 롱 리스크`(69.6px)보다 **22px 왼쪽에서** 시작했다.
          세 슬라이더가 세로로 붙어 있어 시작점이 어긋나면 바로 보인다.
          70 = 가장 긴 라벨(`▲ 롱 리스크`) 실측값 — 라벨을 더 길게 쓰려면 같이 올릴 것 */}
      <span style={{ fontSize:"12px", color:theme.textMuted, flexShrink:0,
        minWidth:"70px" }}>{label}</span>
      {/* ⚠ `minWidth:0`이 없으면 **행이 사이드바 밖으로 삐져나온다** (2026-08-22).
          `input[type=range]`는 브라우저 기본 너비(크롬 129px)를 갖는데, flex 아이템의
          `min-width:auto`가 그 아래로 줄어드는 걸 막는다 → `flex:1`인데도 안 줄고
          오른쪽 값(`0.9%`)이 12px 밀려났다. 다른 구역(아코디언 헤더·플랜 버튼)은
          전부 x=1069에서 끝나는데 슬라이더만 1081이라 **오른쪽 여백이 없어 보였다**
          (사용자 지적). 트랙이 그만큼 짧아지는 게 맞는 동작이다 */}
      {/* 손잡이를 9px로 줄인 얇은 슬라이더 — 스타일은 index.css의 `.slim-range`.
          accentColor로는 크기를 못 바꿔서 트랙까지 직접 그린다 (그쪽 주석 참고).
          색 두 개는 CSS 변수로 넘긴다: 손잡이는 슬라이더마다 다르고, 트랙은 테마를 탄다 */}
      <input type="range" className="slim-range" min={lo} max={max} step={step} value={value}
        onChange={e => onChange(Math.max(min, Number(e.target.value)))}
        style={{ flex:1, minWidth:0, cursor:"pointer", "--sl-color": color, "--sl-track": track }} />
      <span style={{ fontSize:"13px", color, fontWeight:"600", flexShrink:0, minWidth:"36px", textAlign:"right" }}>{format(value)}</span>
    </div>
  );
}
