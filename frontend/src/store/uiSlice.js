// Module-level timer: drawing localStorage 동기화 debounce
let _drawingTimer = null;

// ── 플랜 박스도 모드별로 나눈다 ──────────────────────────────────────────
// 다른 도형(추세선·구조 등)은 replay/drawingKeys.js가 나누는데, 진입/TP/SL 박스는
// 스토어에 있어서 빠져 있었다. 그대로 두면 **실거래 박스가 지워진다**:
// 리플레이에 들어가면 App의 drawing↔pending 동기화가 페이퍼 position(pending 없음)을
// 보고 `setDrawing(null)`을 실행한다. 반대로 연습 중 그린 박스가 실거래로 새기도 한다.
const LIVE_KEY = "drawing";
const REPLAY_KEY = "replay_drawing";
let _drawingKey = LIVE_KEY;

/** 저장 키를 바꾸고 그 키의 내용을 돌려준다. 전환 전 보류 중인 저장은 먼저 흘려보낸다 */
export function swapDrawingStorage(replayOn, current) {
  // ⚠ debounce 타이머가 남아 있으면 **이전 모드의 박스가 새 키에 덮인다**
  clearTimeout(_drawingTimer);
  if (current) localStorage.setItem(_drawingKey, JSON.stringify(current));
  else localStorage.removeItem(_drawingKey);

  _drawingKey = replayOn ? REPLAY_KEY : LIVE_KEY;
  return loadDrawing();
}

function loadDrawing() {
  try {
    const saved = JSON.parse(localStorage.getItem(_drawingKey) || "null");
    if (saved) {
      // tStart/tEnd는 숫자 타임스탬프로 유지
      if (typeof saved.tStart === "string") saved.tStart = +new Date(saved.tStart);
      if (typeof saved.tEnd   === "string") saved.tEnd   = +new Date(saved.tEnd);
      // 구버전 iStart/iEnd만 있는 drawing은 무효화
      if (!saved.tStart && saved.iStart !== undefined) return null;
    }
    return saved;
  } catch { return null; }
}

export const createUiSlice = (set, get) => ({
  // ── 드로잉 (localStorage 동기화) ─────────────────────────────────────────
  drawing: loadDrawing(),

  // ── 모드 / UI 상태 ────────────────────────────────────────────────────────
  drawMode:      false,
  orderStatus:   null,
  criticalAlert: null,
  tpslSaving:    false,
  selectedBox:   false,
  opacityPopup:  null,

  // ── 드래그 상태 ──────────────────────────────────────────────────────────
  dragTpsl:    null,
  dragScaleIn: null,
  dragSplitTp: null,

  setDrawing: (v) => {
    const next = typeof v === "function" ? v(get().drawing) : v;
    set({ drawing: next });
    clearTimeout(_drawingTimer);
    const key = _drawingKey;   // 저장 시점이 아니라 **호출 시점**의 키로 쓴다
    _drawingTimer = setTimeout(() => {
      if (next) localStorage.setItem(key, JSON.stringify(next));
      else      localStorage.removeItem(key);
    }, 200);
  },

  setDrawMode:      (v) => set({ drawMode: typeof v === "function" ? v(get().drawMode) : v }),
  setOrderStatus:   (v) => set({ orderStatus: v }),
  setCriticalAlert: (v) => set({ criticalAlert: v }),
  setTpslSaving:    (v) => set({ tpslSaving: v }),
  setSelectedBox:   (v) => set({ selectedBox: v }),
  setOpacityPopup:  (v) => set({ opacityPopup: v }),

  setDragTpsl:    (v) => set({ dragTpsl: v }),
  setDragScaleIn: (v) => set({ dragScaleIn: v }),
  setDragSplitTp: (v) => set({ dragSplitTp: v }),
});
