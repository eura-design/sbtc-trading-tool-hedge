// 도형(line/channel/circle) 공통 인터페이스
//
// App.jsx가 useTrendLines의 상태/액션을 kind별로 묶어 단일 객체로 전달:
//   drawables = {
//     line:    { id, items, delete, toggleAlert, toggleLock, setOpacity, setSelectedId, label },
//     channel: { ... },
//     circle:  { ... },
//   }
//
// 모든 도형 관련 컴포넌트는 이 객체를 받아 if/else 3분기 없이 dispatch한다.

// 우선순위 — useKeyboardShortcuts 기존 동작과 동일: 채널 > 원 > 선
// structure(수동 구조)는 근접 알림이 없어 toggleAlert가 CHoCH 알림 토글로 쓰인다 (App.jsx 참고)
//
// "zz"(자동 Structure Zigzag)는 **도형이 아니라 지표**지만, 선택·투명도·알림 조작을
// 다른 도형과 똑같이 하려고 같은 인터페이스로 감쌌다 (App.jsx의 가짜 drawable).
//   - 항목이 하나뿐이라 id는 상수 "zz"
//   - delete/toggleLock은 no-op — 지표는 지우거나 잠글 대상이 아니다
//   - 맨 뒤 우선순위: 지그재그가 화면을 넓게 덮어 다른 도형 선택을 삼키면 안 된다
export const DRAWABLE_KINDS = ["channel", "circle", "line", "structure", "zz"];

// 자동 ZZ 가짜 drawable의 고정 id (선택 상태를 boolean 대신 id로 표현)
export const ZZ_ID = "zz";

// 현재 선택된 도형을 반환. 우선순위에 따라 첫 번째 선택을 찾음.
// 반환 형태: { kind, ...drawables[kind], item } | null
export function getSelectedDrawable(drawables) {
  for (const kind of DRAWABLE_KINDS) {
    const d = drawables[kind];
    if (d?.id != null) {
      const item = d.items?.find(x => x.id === d.id) ?? null;
      return { kind, ...d, item };
    }
  }
  return null;
}

// 모든 도형 선택 해제
export function clearAllSelections(drawables) {
  for (const kind of DRAWABLE_KINDS) drawables[kind]?.setSelectedId(null);
}

// 한 도형(kind, id)만 선택하고 다른 종류는 모두 해제
export function selectDrawable(drawables, kind, id) {
  for (const k of DRAWABLE_KINDS) {
    drawables[k]?.setSelectedId(k === kind ? id : null);
  }
}
