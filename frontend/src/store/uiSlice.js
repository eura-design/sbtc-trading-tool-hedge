// Module-level timer: drawing localStorage 동기화 debounce
let _drawingTimer = null;

function loadDrawing() {
  try {
    const saved = JSON.parse(localStorage.getItem("drawing") || "null");
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
    _drawingTimer = setTimeout(() => {
      if (next) localStorage.setItem("drawing", JSON.stringify(next));
      else      localStorage.removeItem("drawing");
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
