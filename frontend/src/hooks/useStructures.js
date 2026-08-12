import { useState, useCallback } from "react";
import { useDrawableStore } from "./useDrawableStore";
import { normalizeStructurePoints } from "../chart/deriveStructure";

// 신규 구조 기본 투명도 — 사용자 지정값. 1.0으로 되돌리지 말 것 ([R2] 참고).
// 지그재그는 배경처럼 깔리고 CHoCH 마크만 또렷하게 보이도록 한 설정이다.
// 개별 조절은 단축키 `[` `]` (0.25 단위) 또는 더블클릭 팝업.
export const STRUCT_DEFAULT_OPACITY = 0.5;

/**
 * 수동 구조(Structure) 도형 스토어
 *
 * 데이터: { id, points: [{ t, p, type:"H"|"L" }], opacity, locked, showChoch, alertChoch, maxChoch }
 *   maxChoch: 표시할 CHoCH 개수(최신 N개). undefined = 제한 없음 (기본)
 *   showChoch / alertChoch 모두 **undefined = ON** (기본값). 이미 저장된 구조가
 *   새 필드 때문에 전부 꺼진 채로 뜨면 안 되므로 false만 OFF로 읽는다.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║ 사용자 확정 사양 — 임의 변경 금지 (2026-08-12 확정, 실사용 테스트 통과)    ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 * [S1] **전 TF 공유** — storageKey에 타임프레임을 넣지 말 것. 사용자 명시 요구사항.
 *      좌표가 timestamp라 tsToIdx가 TF별 bar index를 다시 뽑는다
 *      (트렌드라인/채널/원과 동일 방식). TF별로 분리하는 건 기능 후퇴다.
 *
 * [S2] 저장은 localStorage. 백엔드 영속화가 필요하다고 판단하지 말 것 —
 *      localStorage는 F5·서버 재시작 모두 살아남고, 사용자는 다른 PC 공유를
 *      명시적으로 필요 없다고 했다.
 *
 * [S3] **선분 중간에 꼭짓점을 끼우는 기능은 없다. 다시 추가하지 말 것.**
 *      고/저 교대 구조라 H–L 사이에 넣는 점은 어느 타입이든 양옆 중 하나와 겹치고,
 *      normalizeStructurePoints가 병합해버려 결과적으로 아무 일도 안 일어난다.
 *      한번 구현했다가 동작하지 않아 사용자 요청으로 제거했다("빠진 기능"이 아니다).
 *      점을 늘리는 경로는 startExtendStruct / mergeStructIntoDraft 뿐이다.
 *
 * [S4] 끝점 클릭은 상황에 따라 두 가지로 동작한다 (hitDetection.js 0.7 참고):
 *      draft 없음 → startExtendStruct(연장) / draft 있음 → mergeStructIntoDraft(흡수).
 *      구조를 쪼개두면 deriveStructure가 각각 bias=0으로 시작해 **경계 CHoCH가 유실**되므로,
 *      둘 다 반드시 하나의 구조로 합쳐져야 한다. 별개 구조로 남기지 말 것.
 *
 * [S5] 흡수된 구조(mergeIds)는 finishStruct에서 반드시 제거한다.
 *      남기면 같은 꼭짓점이 두 벌이 되어 CHoCH가 겹쳐 그려진다.
 *
 * [S6] 부분 삭제는 **꼭짓점을 클릭해 선택 → Delete**다. 예전의 "꼭짓점 Shift+클릭
 *      즉시 삭제"로 되돌리지 말 것 — 사용자가 명시적으로 바꾼 조작이다.
 *
 * [S7] **선분(몸통) 부분 선택·삭제는 없다** (2026-08-12 사용자 요청으로 제거).
 *      "꼭짓점 제거만 있으면 된다" — 몸통을 클릭했을 때 선이 파랗게 물드는 게
 *      거슬린다는 이유였다. removeStructSegment / structPart.kind==="segment" 경로를
 *      되살리지 말 것. 지금 몸통 클릭은 구조 전체 선택, 더블클릭은 팝업이다.
 */
export function useStructures() {
  const store = useDrawableStore("structures");

  const [structMode,       setStructMode]       = useState(false);
  const [structDraft,      setStructDraft]      = useState(null);   // { points: [...] } — 그리는 중
  const [structPreview,    setStructPreview]    = useState(null);   // { t, p, type } — 커서 스냅 미리보기
  const [selectedStructId, setSelectedStructIdRaw] = useState(null);

  // 선택된 구조 **안에서** 다시 고른 꼭짓점 — { kind: "point", idx } | null
  // 꼭짓점을 클릭하면 여기 담기고, Delete가 구조 전체 대신 이것만 지운다.
  // (예전엔 꼭짓점 Shift+클릭 즉시 삭제였다 — 클릭 → Delete로 변경, 사용자 요청)
  // kind가 "point" 하나뿐이어도 구조는 유지한다 — 판정부가 전부 kind로 분기한다 ([S7])
  const [structPart, setStructPart] = useState(null);

  const clearStructPart  = useCallback(() => setStructPart(null), []);
  const selectStructPart = useCallback(part => setStructPart(part), []);

  // 구조 선택이 바뀌면 부분 선택은 의미가 없어지므로 같이 비운다
  const setSelectedStructId = useCallback((id) => {
    setSelectedStructIdRaw(id);
    setStructPart(null);
  }, []);

  const cancelStructDraw = useCallback(() => {
    setStructMode(false); setStructDraft(null); setStructPreview(null);
  }, []);

  // ── 그리기 ────────────────────────────────────────────────────────────────
  const addStructDraftPoint = useCallback((pt) => {
    setStructDraft(prev => ({ ...prev, points: [...(prev?.points ?? []), pt] }));
    setStructPreview(null);
  }, []);

  /**
   * 기존 구조를 이어서 그리기 — 확정 시 새로 만들지 않고 그 구조를 갱신한다.
   *
   * 구조를 쪼개면 deriveStructure가 각각 bias=0으로 새로 시작해서 경계의 CHoCH가
   * 유실되므로, 시간이 지나 꼭짓점을 늘릴 때는 반드시 원본을 이어야 한다.
   *
   * fromStart(첫 점에서 과거 방향으로 연장)면 draft를 뒤집어 seed한다.
   * 그래야 "마지막 draft 점"이 연장 기준점이 되어 고/저 타입 교대와 프리뷰 선이 맞는다.
   * 최종 순서는 finishStruct의 normalize가 시간순으로 정렬하므로 draft 순서는 무관하다.
   */
  const startExtendStruct = useCallback((id, fromStart = false) => {
    const item = store.items.find(x => x.id === id);
    if (!item) return;
    const pts = fromStart ? [...item.points].reverse() : [...item.points];
    setStructDraft({ points: pts, extendId: id, mergeIds: [] });
    setStructPreview(null);
  }, [store]);

  /**
   * 그리는 중에 **다른 구조**의 끝점을 눌러 그 구조를 draft에 흡수한다 (두 구조 잇기).
   *
   * 흡수된 구조는 finishStruct에서 제거한다 — 안 지우면 같은 꼭짓점이 두 벌 남고,
   * 그러면 CHoCH도 두 번 계산돼 화면이 겹친다.
   *
   * 클릭한 쪽 끝점부터 이어지도록 방향을 맞춘다(첫 점을 눌렀으면 정순, 끝 점이면 역순).
   * 최종 순서는 finishStruct의 normalize가 시간순으로 정렬하므로 결과에는 영향이 없고,
   * 그리는 도중 미리보기 폴리라인이 자연스럽게 이어지도록 하기 위함이다.
   */
  const mergeStructIntoDraft = useCallback((id, fromStart = false) => {
    const item = store.items.find(x => x.id === id);
    if (!item?.points?.length) return;
    setStructDraft(prev => {
      if (!prev) return prev;
      if (prev.extendId === id || prev.mergeIds?.includes(id)) return prev;
      const add = fromStart ? [...item.points] : [...item.points].reverse();
      return {
        ...prev,
        points:   [...prev.points, ...add],
        mergeIds: [...(prev.mergeIds ?? []), id],
      };
    });
    setStructPreview(null);
  }, [store]);

  // 확정. dropLast는 더블클릭 확정용 — 더블클릭은 mousedown이 2번 들어와
  // 같은 봉에 꼭짓점이 하나 더 찍히므로 마지막 하나를 버린다.
  const finishStruct = useCallback((opts = {}) => {
    let pts = structDraft?.points ?? [];
    const extendId = structDraft?.extendId ?? null;
    const mergeIds = structDraft?.mergeIds ?? [];
    if (opts.dropLast) pts = pts.slice(0, -1);
    pts = normalizeStructurePoints(pts);

    if (pts.length >= 2) {
      if (extendId != null) store.update(extendId, { points: pts });
      // 지그재그는 배경처럼 깔리는 게 낫다 (CHoCH 마크는 투명도와 무관하게 항상 100%)
      else                  store.add({ points: pts, opacity: STRUCT_DEFAULT_OPACITY });
      // 흡수된 구조 제거 — 남겨두면 같은 꼭짓점이 두 벌이 된다
      for (const id of mergeIds) store.remove(id);
    } else if (extendId != null) {
      // 이어 그리기를 시작해놓고 점이 다 지워진 비정상 상태 — 원본을 지운다
      store.remove(extendId);
    }
    setStructDraft(null); setStructMode(false); setStructPreview(null);
  }, [structDraft, store]);

  // ── 편집 ──────────────────────────────────────────────────────────────────
  // 드래그 중에는 순서를 건드리지 않는다 (커서 아래에서 점이 튀는 걸 방지).
  // 시간순 정렬·동일타입 병합은 드래그 종료 시 normalizeStruct에서 한 번에 처리.
  const moveStructPoint = useCallback((id, idx, t, p) => {
    store.update(id, item => ({
      points: item.points.map((pt, k) => (k === idx ? { ...pt, t, p } : pt)),
    }));
  }, [store]);

  const normalizeStruct = useCallback((id) => {
    store.update(id, item => ({ points: normalizeStructurePoints(item.points) }));
  }, [store]);

  // 선분 중간 삽입은 제공하지 않는다 — 고/저 교대 구조라 점 하나를 끼우면
  // 반드시 양옆 중 하나와 타입이 겹쳐 normalizeStructurePoints가 병합해버린다.
  // 점을 늘리는 경로는 startExtendStruct(끝점에서 이어 그리기) 하나로 통일.
  const removeStructPoint = useCallback((id, idx) => {
    const item = store.items.find(x => x.id === id);
    if (!item) return;
    const points = normalizeStructurePoints(item.points.filter((_, k) => k !== idx));
    setStructPart(null);   // 인덱스가 밀리므로 부분 선택은 반드시 비운다
    // 꼭짓점이 2개 미만이면 구조 자체가 의미 없으므로 통째로 삭제
    if (points.length < 2) { store.remove(id); setSelectedStructIdRaw(null); return; }
    store.update(id, { points });
  }, [store]);

  const deleteStruct = useCallback((id) => {
    store.remove(id); setSelectedStructIdRaw(null); setStructPart(null);
  }, [store]);

  // Delete 키 처리 — 꼭짓점이 선택돼 있으면 그것만, 아니면 구조 전체
  const deleteStructSelection = useCallback((id) => {
    if (structPart?.kind === "point") removeStructPoint(id, structPart.idx);
    else                              deleteStruct(id);
  }, [structPart, removeStructPoint, deleteStruct]);

  /**
   * 이 구조의 CHoCH 마크 표시 on/off (더블클릭 팝업에서 조작).
   *
   * 구조를 여러 개 그려두면 마크가 뒤엉키므로 "보고 싶은 구조만" 켜기 위한 것.
   * **CHoCH 마크를 끄는 곳은 이것 하나뿐이다** — 지표 메뉴에 있던 전체 스위치
   * (struct.show_choch)는 2026-08-12 제거됐다 (Structures.jsx [R6]).
   *
   * 기본값은 ON이므로 저장 필드는 undefined = ON으로 읽는다
   * (이미 저장돼 있는 기존 구조가 전부 꺼진 채로 뜨지 않게).
   */
  const toggleStructChoch = useCallback((id) => {
    store.update(id, item => ({ showChoch: item.showChoch === false }));
  }, [store]);

  /**
   * 이 구조에 CHoCH가 발생하면 알림을 띄울지 (더블클릭 팝업, 기본 ON).
   *
   * 표시(showChoch)와 **독립**이다 — 화면은 깔끔하게 두고 알림만 받는 조합이
   * 성립해야 한다. 알림 대상은 진행 중 레그에서 나온 CHoCH뿐이라
   * 꼭짓점을 편집한다고 울리지는 않는다 (structRenderState.js 주석 참고).
   */
  const toggleStructChochAlert = useCallback((id) => {
    store.update(id, item => ({ alertChoch: item.alertChoch === false }));
  }, [store]);

  /**
   * 이 구조에서 표시할 CHoCH 개수(최신 N개). null = 제한 없음(전체).
   *
   * **구조마다 따로** 두는 이유는 Structures.jsx [R6] 참고 — 전역 값 하나로 두면
   * 낮춰놓은 걸 잊고 "CHoCH가 안 뜬다"고 오해하게 된다. 기본값도 제한 없음이다.
   */
  const setStructMaxChoch = useCallback((id, n) => {
    store.update(id, { maxChoch: n > 0 ? n : undefined });
  }, [store]);

  return {
    structures: store.items,
    structMode,       setStructMode,
    structDraft,      setStructDraft,
    structPreview,    setStructPreview,
    selectedStructId, setSelectedStructId,
    structPart, selectStructPart, clearStructPart,
    cancelStructDraw, addStructDraftPoint, startExtendStruct, mergeStructIntoDraft, finishStruct,
    moveStructPoint, normalizeStruct, removeStructPoint,
    deleteStruct, deleteStructSelection,
    setStructOpacity:  store.setOpacity,
    toggleStructLock:  store.toggleLock,
    toggleStructChoch, toggleStructChochAlert, setStructMaxChoch,
  };
}
