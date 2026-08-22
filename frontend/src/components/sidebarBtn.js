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
