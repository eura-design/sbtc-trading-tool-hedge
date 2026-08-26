// 수동 구조(Custom Structure Zigzag) 렌더가 남기는 모듈 상태 — 읽기 전용 소비자용
//
// Structures.jsx가 매 렌더에서 계산하는 값 중, **React 상태로는 꺼낼 수 없는데
// 다른 곳에서 필요한 것**만 여기에 기록한다. 왜 모듈 상태여야 하는가:
//   - 자동 이어그리기와 그 구간의 CHoCH는 candlesRef(진행 중 봉의 최신 고가/저가)로만
//     제대로 계산된다. App의 candles state는 봉마감 때만 갱신되므로, 소비하는 쪽에서
//     useMemo로 다시 계산하면 값이 조용히 어긋난다.
//   - 자동 ZZ도 같은 이유로 structureZigzag.js에 모듈 상태를 둔다(getZzChochTotal 등).
//
// 값은 "마지막 렌더 시점의 스냅샷"이다. 구독 개념이 없으므로 읽는 쪽은
// 이벤트 시점(메뉴 열기, 마우스 이동)에 직접 호출한다.

// ── 검출된 CHoCH 개수 (구조별) ──────────────────────────────────────────────
// 더블클릭 팝업의 "CHoCH 개수" 슬라이더 상한(1~N)에 쓴다.
// 표시 개수 제한은 **구조마다** 걸므로 상한도 구조마다 달라야 한다.
// 지표가 꺼져 있거나 표시 TF가 아니면 Structures가 빈 목록을 받아 비워진다.
// ※ 전 구조 합계(getStructChochTotal)는 IndicatorMenu에 있던 "검출된 CHoCH N개"
//   표시와 함께 제거됐다 (2026-08-12) — 같은 정보가 각 구조 팝업의 슬라이더에 있다
let _chochCounts = new Map();   // structId → 검출 개수

export function setStructChochCounts(m) { _chochCounts = m; }
export function getStructChochCount(id) { return _chochCounts.get(id) ?? 0; }

// ── 자동 이어그리기 체인 (구조별) ───────────────────────────────────────────
// [{ structId, points: [{ t, p, type }] }] — 자동 이어그리기를 켠 구조마다 하나씩.
//
// ⚠ **여러 개일 수 있다** — 구조마다 켜고 끌 수 있어서 동시에 여러 구조가 가진다
//   (2026-08-26 사용자 요청). 기본이 OFF라 켜지 않으면 목록은 비어 있다.
// ※ 여기 있던 진행 중 레그(마지막 꼭짓점 → 현재 극값)는 2026-08-26에 기능째 삭제됐다 —
//   되살리지 말 것 (Structures.jsx [R3]에 되살릴 때 필요한 것들이 적혀 있다).
//
// 쓰는 곳: 자동 점을 클릭해 확정하는 경로(hitDetection)와 그 커서(cursorRules).
// 자동 점은 구조 목록(st.points)에 없어서 소비하는 쪽이 알아낼 방법이 없다.
let _autoChains = [];

export function setStructAutoChains(list) { _autoChains = list; }
export function getStructAutoChains()     { return _autoChains; }

// ── 자동 이어그리기 구간에서 감지된 CHoCH ──────────────────────────────────
// [{ structId, dir, price }] — useChochAlert가 "새로 뜬 것"을 골라 알림을 띄운다.
//
// **확정 CHoCH는 여기 넣지 않는다.** deriveStructure는 순수 함수라 꼭짓점을 옮기면
// 과거 CHoCH가 통째로 다시 계산된다 — 편집할 때마다 알림이 터진다.
// 알릴 가치가 있는 "지금 발생"은 자동 이어그리기 구간에서 나온 것(ev.live)뿐이다.
// ⚠ 그래서 **자동 이어그리기를 켠 구조에서만 CHoCH 알림이 울린다** (2026-08-26).
//   그전에는 진행 중 레그가 그 역할을 했는데 그 기능이 삭제됐다 — 끈 구조는
//   더 이상 "지금 일어나는 일"을 추적하지 않으므로 알릴 것도 없다.
// (그 마크는 나중에 꼭짓점이 찍히면 확정분으로 바뀌지만 키가 같아 중복 알림이 없다)
//
// 표시 옵션(구조별 showChoch / maxChoch)과 무관하게 전부 담는다 —
// 켜고 끄는 건 알림 전용 플래그(alertChoch)이고, 그 판단은 useChochAlert가 한다.
let _liveChochs = [];

export function setStructLiveChochs(list) { _liveChochs = list; }
export function getStructLiveChochs()     { return _liveChochs; }
