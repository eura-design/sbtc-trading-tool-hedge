// 수동 구조(Custom Structure Zigzag) 렌더가 남기는 모듈 상태 — 읽기 전용 소비자용
//
// Structures.jsx가 매 렌더에서 계산하는 값 중, **React 상태로는 꺼낼 수 없는데
// 다른 곳에서 필요한 것**만 여기에 기록한다. 왜 모듈 상태여야 하는가:
//   - 라이브 레그 CHoCH·진행 중 레그는 candlesRef(진행 중 봉의 최신 고가/저가)로만
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

// ── 진행 중 레그(점선) ──────────────────────────────────────────────────────
// { t1, p1, t2, p2, prev } | null — 마지막 꼭짓점 → 현재 구간 극값.
// 레그 hover 표시(hitDetection.findHoveredLeg)가 확정 레그와 함께 훑는다.
// 구조 전체를 통틀어 하나뿐이다 (Structures.jsx [R3] — liveOwnerId 참고).
//
// prev = { t1, t2 } | null — **직전 동일방향 레그**(두 칸 앞, pts[n-3]→pts[n-2]).
// 진행 중 레그는 확정 레그 목록에 없어서 소비하는 쪽이 직전 레그를 찾을 수 없다.
// 여기 실어 보내지 않으면 진행 중 레그만 거래량 비교(↑↓%)가 통째로 빠진다
// (Structures.jsx [R8] — 사용자 지적으로 추가).
let _liveSegment = null;

export function setStructLiveSegment(seg) { _liveSegment = seg; }
export function getStructLiveSegment()    { return _liveSegment; }

// ── 진행 중 레그에서 감지된 CHoCH ───────────────────────────────────────────
// [{ structId, dir, price }] — useChochAlert가 "새로 뜬 것"을 골라 알림을 띄운다.
//
// **확정 CHoCH는 여기 넣지 않는다.** deriveStructure는 순수 함수라 꼭짓점을 옮기면
// 과거 CHoCH가 통째로 다시 계산된다 — 편집할 때마다 알림이 터진다.
// 알릴 가치가 있는 "지금 발생"은 진행 중 레그에서 나온 것(ev.live)뿐이다.
// (그 마크는 나중에 꼭짓점이 찍히면 확정분으로 바뀌지만 키가 같아 중복 알림이 없다)
//
// 표시 옵션(구조별 showChoch / maxChoch)과 무관하게 전부 담는다 —
// 켜고 끄는 건 알림 전용 플래그(alertChoch)이고, 그 판단은 useChochAlert가 한다.
let _liveChochs = [];

export function setStructLiveChochs(list) { _liveChochs = list; }
export function getStructLiveChochs()     { return _liveChochs; }
