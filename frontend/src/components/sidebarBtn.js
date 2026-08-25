// 사이드바 버튼 규격 — **성격이 같은 버튼은 같은 크기여야 한다** (2026-08-22 사용자 요청).
//
// 전수 조사에서 같은 성격인데 높이가 갈린 그룹이 셋이었다:
//   · 전체폭 실행 버튼 : 플랜 32 / 청산 33 / 추가매수·분할TP 34   → 33으로 통일
//   · 접기 헤더        : 시장정보·일일손실·거래통계·설정 17 / 포지션 19 → 20으로 통일
//   · 아이콘 버튼      : 잔고 ⟳ 17 / 통계 ⟳ 14 / 주문취소 ✕ 16    → 16×16으로 통일
//
// ⚠ **각 컴포넌트에 치수를 복사해 두지 말 것.** 위 어긋남이 전부 그렇게 생겼다.
// ⚠ 원인의 절반은 `lineHeight`를 안 정한 것이었다. `▲`·`▼`·`✓`·`✕`·`⟳`는 이 앱 폰트
//   스택(JetBrains Mono)에 없어 **OS 폴백 폰트**가 그리는데, 그 폰트의 줄 높이가 더 커서
//   버튼 박스를 밀어 올린다. 그래서 여기 모든 규격이 `lineHeight:"1"`을 못박는다 —
//   빼면 글자가 바뀔 때마다 높이가 다시 흔들린다 (ReplayBar 일시정지 글리프와 같은 원인).
//
// ※ **폭은 규격에 넣지 않는다.** 버튼은 담긴 칸을 채우고(`width:100%` 또는 `flex:1`),
//   칸 폭은 자리마다 다르다(설정 구역 239px / 포지션 카드 201px). 절대 폭을 맞추면
//   넓은 쪽에 빈자리가 생긴다. 같은 칸 안에서 나란한 버튼끼리는 자동으로 같은 폭이 된다.

// ── ① 전체폭 실행 버튼 (33px) ───────────────────────────────────────────────
//    플랜 / 청산 / 추가 매수 / 분할 TP 추가 / 확인 / 취소 / 적용 — 전부 이 높이다.
//    "누르면 무슨 일이 일어난다"가 공통 성격이라 크기를 나눌 이유가 없다.
const ACTION = {
  padding: "9px 0",
  borderRadius: "5px",
  fontFamily: "inherit",
  fontSize: "13px",
  fontWeight: "700",
  lineHeight: "1",
};

export const CONFIRM_ROW = { display: "flex", gap: "6px" };

// 채운 버튼 (청산의 `✓ 확인`, 레버리지의 `적용`)
export function primaryBtn(theme, color, textColor = "#fff", disabled = false) {
  return {
    ...ACTION, flex: 1,
    background: disabled ? theme.borderSec : color,
    border: `1px solid ${disabled ? theme.borderSec : color}`,
    color: disabled ? theme.textMuted : textColor,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

// 테두리만 있는 되돌리기 버튼 (양쪽 모두 `취소`)
export function ghostBtn(theme) {
  return {
    ...ACTION, flex: 1,
    background: "transparent",
    border: `1px solid ${theme.borderSec}`,
    color: theme.textMuted,
    cursor: "pointer",
  };
}

// 테두리만 있는 전체폭 실행 버튼 (플랜 / 추가 매수 / 분할 TP 추가)
//   hover 배경은 부르는 쪽이 건다 — 색이 버튼마다 다르다
export function actionBtn(theme, color, disabled = false, weight) {
  return {
    ...ACTION, width: "100%",
    background: "transparent",
    border: `1px solid ${disabled ? theme.borderSec : color}`,
    color: disabled ? theme.textFaint : color,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: weight ?? ACTION.fontWeight,
    transition: "background 0.15s",
  };
}

// ── ② 접기/펼치기 헤더 (20px) ───────────────────────────────────────────────
//    시장 정보 / 일일 손실 한도 / 거래 통계 / 설정 / ▲ LONG 포지션
//    ⚠ 글자 크기는 자리마다 다르다(섹션 12px, 포지션 13px). 그건 위계 표현이라 그대로 두고
//      **박스 높이만** 맞춘다 — 안 그러면 접힌 줄들의 간격이 제각각으로 보인다.
//    ※ 카드 안쪽 아코디언(시장가 청산·추가 진입·분할 TP)은 **다른 그룹**이다:
//      위에 구분선을 이고 있어 여백이 더 넓다(32px). 셋이 한 컴포넌트라 서로 갈릴 일이 없다.
export const SECTION_HEADER = {
  width: "100%",
  height: "20px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: 0,
  fontFamily: "inherit",
  lineHeight: "1",
};

// ── 펼쳐진 구역 표시 (2026-08-25 사용자 요청) ──────────────────────────────
// 접기 헤더가 있는 최상위 구역(시장 정보·일일 손실 한도·거래 통계·설정)이
// **열려 있는 동안** 파란 사각형 테두리를 두른다.
//
// ⚠ 색은 **`#60a5fa`** — 이 시스템에서 이미 **"지금 켜져 있다"**는 뜻이다
//   (상단 바의 선·원·채널·피보나치·구조 모드 버튼이 활성일 때 이 색).
//   다른 색은 뜻이 차 있어서 못 쓴다: 초록=롱/수익, 빨강=숏/손실·경보,
//   보라=연습 모드, 금색=사이드바 전반(슬라이더·플랜 버튼)에 이미 많다
//
// ⚠ **`border`가 아니라 `outline`이다.** 두 가지를 한꺼번에 푼다:
//   ① `outline`은 레이아웃을 밀지 않는다 — border로 하면 열고 닫을 때마다 안쪽
//      내용이 두께만큼 밀려서 글자가 흔들린다
//   ② 두께를 올려도 **구분선(아래 1px)은 그대로다** — border로 묶어 두면 두께를
//      키우는 순간 닫힌 구역들 사이 구분선까지 같이 두꺼워진다
//   `outlineOffset`을 음수로 줘서 상자 **안쪽**에 그린다 (밖으로 나가면 위아래
//   구역과 겹친다)
//
// ⚠ 열렸을 때는 아래 구분선을 **투명으로** 만든다 — 안 그러면 파란 선 바로 밑에
//   회색 선이 한 줄 더 붙어 두 겹으로 보인다
//
// ⚠ **카드 안쪽 아코디언에는 쓰지 말 것** (시장가 청산·추가 진입·분할 TP/SL).
//   사용자가 "내부 메뉴는 상관없다"고 정했다 — 넣으면 파란 상자가 상자 안에 겹친다
// ⚠ **사각형을 구역 가장자리에서 살짝 들여 그린다**(`SECTION_OPEN_GAP`, 2026-08-25
//   사용자 지적). 딱 붙여 그렸더니 **열린 구역이 둘 이어질 때** 위 상자의 아랫선과
//   아래 상자의 윗선이 맞닿아 2+2=4px 띠로 보였다 — 거기만 유독 두꺼워 보인다.
//   틈을 주면 같은 두께인데도 **상자 둘로 읽힌다**.
//   ⚠ 이걸 0으로 되돌리지 말 것 — 한 구역만 열어 보면 멀쩡해서 눈치채기 어렵다
export const SECTION_OPEN_COLOR = "#60a5fa";
const SECTION_OPEN_PX  = 2;   // 선 두께 — 여기 한 곳
const SECTION_OPEN_GAP = 3;   // 구역 가장자리와 사각형 사이 틈 (붙은 구역끼리는 그 두 배)
export function sectionBox(theme, open) {
  return {
    // 구분선은 **늘 1px** — 여기 두께를 건드리면 닫힌 구역 사이 선까지 두꺼워진다
    borderBottom: `1px solid ${open ? "transparent" : theme.border}`,
    outline: open ? `${SECTION_OPEN_PX}px solid ${SECTION_OPEN_COLOR}` : "none",
    // 음수 offset = 안쪽으로. 선은 이 위치에서 **바깥쪽으로** 그려지므로
    // 실제 틈 = offset − 두께 (= SECTION_OPEN_GAP)
    outlineOffset: `-${SECTION_OPEN_PX + SECTION_OPEN_GAP}px`,
  };
}

// 헤더 오른쪽 ▲/▼ 화살표 — 크기·색이 다섯 군데에서 같아야 한다
export function headerArrow(theme) {
  return { fontSize: "10px", color: theme.textFaint, lineHeight: "1" };
}

// ── ③ 아이콘 전용 버튼 (16×16) ──────────────────────────────────────────────
//    잔고·통계의 `⟳`, 추가 진입·분할 TP 주문의 `✕`
//    ⚠ 글자만 놓으면 글리프 폰트에 따라 상자가 달라진다 → 박스를 못박고 가운데 정렬한다.
//      그래야 옆 글자와 세로 중심이 맞고, 누를 수 있는 넓이도 자리마다 같아진다.
export function iconBtn(color, fontSize = "14px") {
  return {
    width: "16px",
    height: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize,
    lineHeight: "1",
    color,
    flex: "none",
  };
}
