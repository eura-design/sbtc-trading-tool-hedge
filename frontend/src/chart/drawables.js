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
export const DRAWABLE_KINDS = ["channel", "circle", "line"];

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
