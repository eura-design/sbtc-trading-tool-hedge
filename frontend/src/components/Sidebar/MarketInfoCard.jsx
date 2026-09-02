import { useTheme } from "../../ThemeContext";
import { useMarketInfo } from "../../hooks/useMarketInfo";
import { useStore } from "../../store";
import { useAccordion } from "../../hooks/useAccordion";
import { SECTION_HEADER, headerArrow, sectionBox } from "../sidebarBtn";
import { PALETTE } from "../../constants";

// 공포·탐욕 단계 — **다섯 단계다** (2026-08-26 사용자 요청).
// alternative.me가 주는 `value_classification`을 그대로 옮긴다 — 경계를 우리가 정하면
// 출처와 어긋나서 "저기선 공포인데 여긴 중립"이 된다.
const FG_LABEL = {
  "Extreme Fear":  "극심한 공포",
  "Fear":          "공포",
  "Neutral":       "중립",
  "Greed":         "탐욕",
  "Extreme Greed": "극심한 탐욕",
};
// 라벨이 없거나 처음 보는 문자열이면 숫자로 판정한다 — **영어를 그대로 띄우지 않기 위해서다**.
// 경계는 **전체 이력 3125일을 훑어 실측**했다 (2026-08-26). 빈틈도 겹침도 없었다:
//   0~25 극심한 공포 / 26~46 공포 / 47~54 중립 / 55~75 탐욕 / 76~100 극심한 탐욕
// ⚠ 이건 폴백이다 — 평소에는 위 표(출처가 준 라벨)가 답한다.
//   출처가 경계를 바꾸면 위 표는 따라가지만 이 숫자는 안 따라간다. 그래서 폴백이다
const fgLabel = (fg) => FG_LABEL[fg.label]
  ?? (fg.value <= 25 ? "극심한 공포"
    : fg.value <= 46 ? "공포"
    : fg.value <= 54 ? "중립"
    : fg.value <= 75 ? "탐욕" : "극심한 탐욕");

// ── 펀딩비 색 (2026-08-26 사용자 지정) ──────────────────────────────────────
//   ~0.01% 초록 / ~0.02% 금색 / ~0.03% 주황 / 0.03% 초과 빨강
// ⚠ **구간 끝값은 낮은 쪽(연한 색)에 붙는다** — `0.01%까지 초록`이라는 지시 그대로다.
//   그래서 `0.0100%`는 초록, `0.0101%`부터 금색이다. 비교가 `>=`가 아니라 `>`인 이유다
// ※ 2026-08-26에 한 단계씩 내렸다 (0.02/0.03/0.04 → 0.01/0.02/0.03)
// ⚠ 주황은 PALETTE에 없다 — **여기서만 쓰는 색**이라 전역 토큰으로 만들지 않았다.
//   전역에 두면 "주황은 무슨 뜻"이라는 자리를 하나 더 만드는 셈이다
//   (이 앱의 색은 뜻이 정해져 있다: 초록=롱/수익, 빨강=숏/손실, 보라=연습, 금색=사이드바)
// 그 아래(=평상시)는 **초록**이다 — 공포·탐욕의 중립과 **같은 색**(`PALETTE.long`)이다.
// 한 카드 안에서 `초록 = 치우치지 않은 상태`로 읽히도록 맞춘 것이다 (2026-08-26 사용자 지정)
//
// ⚠ **음수도 같이 칠한다 — 판정은 절댓값이다** (2026-08-26 사용자 지정).
//   `-0.05%`도 빨강이다. 평상시가 초록이 된 뒤로는 음수를 안 칠하면 큰 마이너스가
//   "정상"이라고 말하는 셈이 되기 때문이다 — 음수는 뜻이 반대일 뿐 크면 그것도 극단이다.
//   ⚠ 그 대가로 **`+0.03%`와 `-0.03%`가 같은 주황**이다. 색은 "얼마나 치우쳤나"만 말하고
//     **어느 쪽으로 치우쳤나는 부호가 말한다**(값에 `+`/`-`가 늘 붙어 있다).
//     색으로 방향까지 나타내려 하지 말 것 — 이 카드에 색이 다섯 벌 필요해진다
const FUNDING_ORANGE = "#fb923c";
const fundingColor = (r) => {
  const a = Math.abs(r);
  return a > 0.03 ? PALETTE.short
    : a > 0.02 ? FUNDING_ORANGE
    : a > 0.01 ? PALETTE.warn
    : PALETTE.long;
};

// ── 공포·탐욕 단계별 색 (2026-08-26 사용자 요청) ────────────────────────────
// **중립을 가운데 둔 양방향 눈금**이다 — 가운데가 초록이고 양 끝으로 갈수록 치우친 색이 된다.
//   극심한 공포 ← 파랑 ┊ **초록(중립)** ┊ 금색 → 주황 (극심한 탐욕)
// ⚠ **중립이 초록**인 것은 2026-08-26 사용자 지정이다. 회색이었던 것을 바꿨다 —
//   가운데가 "치우치지 않은 좋은 상태"라는 뜻이 되어 눈금이 한눈에 읽힌다.
//   되돌리지 말 것.
//   ※ 색은 **수익 초록과 같은 `PALETTE.long`(#0ecb81)** 이다 (2026-08-26 사용자 지정).
//     한때 겹침을 피하려고 다른 색조(#4ade80)를 썼는데 같은 날 이걸로 바꿨다 —
//     되돌리지 말 것. 펀딩비의 평상시 색도 같은 값이라, 이 카드에서 초록은
//     **치우치지 않은 상태**라는 한 가지 뜻으로 읽힌다
// ⚠ 빨강은 여전히 쓰지 않는다 — 펀딩비 최고 단계 전용으로 남긴다
// ※ 탐욕 쪽 금색→주황은 **펀딩비 색과 같은 두 색**이다 (같은 카드 안에서
//   `금색 = 주의 / 주황 = 더 심함`으로 읽히도록)
const FG_COLOR = {
  "극심한 공포": "#60a5fa",
  "공포":        "#93c5fd",
  "중립":        PALETTE.long,
  "탐욕":        PALETTE.warn,
  "극심한 탐욕": FUNDING_ORANGE,
};

// 한글 부분의 글자 크기 — 숫자(13px)와 **눈으로 같아 보이게** 맞춘 값 (2026-08-26 사용자 요청).
// ⚠ 같은 px인데도 크기가 달라 보이는 건 **한글이 폴백 폰트**이기 때문이다
//   (앱 폰트 스택에 한글이 없어 OS 글꼴이 그린다 — 그쪽이 같은 px에서 더 커 보인다).
//   ReplayBar 일시정지 글리프·사이드바 `lineHeight:"1"`이 겪은 것과 같은 원인이다.
// ⚠ 어긋나 보이면 **이 숫자 하나만** 고칠 것 — 폰트가 바뀌면 다시 맞춰야 할 수 있다
// (13 → 12 → **11**. 2026-08-26에 사용자가 두 번 줄였다)
const FG_LABEL_FS = "11px";

export function MarketInfoCard() {
  const { theme } = useTheme();
  // 리플레이면 재생 시각의 과거 값을 보여준다 — 오늘의 펀딩비·심리 지표가 뜨면
  // 그것 자체가 미래 정보다 (둘 다 이력 API가 있다 — useMarketInfo 상단 참고)
  const replayNowMs = useStore(s => s.replayOn ? s.replayNowMs : null);
  // 심볼은 스토어에서 바로 읽는다 - 이 카드 하나 때문에 App -> Sidebar로 props를
  // 한 단계 더 흘리지 않는다 (펀딩비는 심볼마다 다르다)
  const symbol = useStore(s => s.symbol);
  const { fundingRate, fundingCountdown, fearGreed } = useMarketInfo(replayNowMs, symbol);
  const [open, toggle] = useAccordion("accordion_marketInfo");

  // ※ 예전엔 라벨 옆에 붙이는 `sub`가 있었다 — 펀딩비 카운트다운 전용이었는데
  //   2026-08-26에 카운트다운이 헤더로 올라가면서 쓰는 곳이 없어져 뺐다
  // ⚠ 값은 **한 덩어리로 같은 스타일**이다 — 공포·탐욕의 `62 · 탐욕`에서 숫자와 글자를
  //   다르게 꾸미지 말 것 (2026-08-26 사용자 지정). 둘은 한 값이다
  const row = (label, value, color = "#94a3b8") => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"4px 0", borderBottom:`1px solid ${theme.border}` }}>
      <span style={{ fontSize:"12px", color:theme.textMuted }}>{label}</span>
      <span style={{ fontSize:"13px", color, fontWeight:"600" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ padding:"8px 16px", ...sectionBox(theme, open), flexShrink:0 }}>
      <button
        onClick={toggle}
        style={SECTION_HEADER}
      >
        <span style={{ fontSize:"12px", color:theme.textMuted }}>시장 정보</span>
        <span style={headerArrow(theme)}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ marginTop:"6px" }}>
          {/* 펀딩 카운트다운 — **펀딩비 바로 윗줄, 가운데, 크게** (2026-08-26 사용자 지정).
              라벨을 붙이지 않는다: 바로 아래가 `펀딩비`라 무엇의 시계인지 이미 읽힌다.
              ⚠ `lineHeight:"1"` 필수 — 20px는 이 카드에서 가장 큰 글자라
                줄 높이를 안 정하면 아래 줄까지 밀어낸다 */}
          {fundingCountdown && (
            <div style={{ textAlign:"center", padding:"2px 0 7px", fontSize:"20px",
              fontWeight:600, lineHeight:"1", color:theme.textPrimary,
              fontVariantNumeric:"tabular-nums", letterSpacing:"0.02em" }}>
              {fundingCountdown}
            </div>
          )}
          {row(
            "펀딩비",
            fundingRate === null ? "—" : `${fundingRate >= 0 ? "+" : ""}${fundingRate.toFixed(4)}%`,
            fundingRate === null ? "#94a3b8" : fundingColor(fundingRate),
          )}
          {/* 숫자와 한글을 **따로** 넣는다 — 같은 px이면 한글이 더 커 보여서
              (폴백 폰트) 한 값인데 두 크기로 읽힌다. 색은 둘이 같다 — 한 값이므로 */}
          {fearGreed
            ? row("공포·탐욕", (
                <>
                  {fearGreed.value}
                  <span style={{ opacity:0.45, margin:"0 4px" }}>·</span>
                  <span style={{ fontSize:FG_LABEL_FS }}>{fgLabel(fearGreed)}</span>
                </>
              ), FG_COLOR[fgLabel(fearGreed)] ?? "#94a3b8")
            : row("공포·탐욕", "—")}
        </div>
      )}
    </div>
  );
}
