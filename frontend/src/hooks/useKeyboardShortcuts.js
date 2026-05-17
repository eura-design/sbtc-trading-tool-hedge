import { useEffect } from "react";
import { getSelectedDrawable, clearAllSelections } from "../chart/drawables";

const TF_KEYS   = ["tf5m", "tf15m", "tf1h", "tf4h", "tf1d", "tf1w"];
const TF_VALUES = ["5m",   "15m",   "1h",   "4h",   "1d",   "1w"];

export function useKeyboardShortcuts({
  shortcuts,
  setDrawMode, setCurrent,
  cancelDraw, cancelChannelDraw, cancelCircleDraw,
  drawables,   // { line, channel, circle } — chart/drawables.js 인터페이스
  setSelectedBox,
  drawing, hasPending, locked,
  selectedBox,
  deleteBox,
  onIntervalChange,
}) {
  useEffect(() => {
    const match = (e, id) => e.key.toLowerCase() === shortcuts[id].key.toLowerCase()
      || e.key === shortcuts[id].key;

    const onKey = e => {
      if (match(e, "escape")) {
        setDrawMode(false); setCurrent(null);
        cancelDraw(); cancelChannelDraw(); cancelCircleDraw();
        clearAllSelections(drawables);
        setSelectedBox(false);
        return;
      }

      if (match(e, "delete")) {
        const sel = getSelectedDrawable(drawables);
        if (sel)                                          sel.delete(sel.id);
        else if (selectedBox && (drawing || hasPending))  deleteBox();
        return;
      }

      // 입력 필드 포커스 시 나머지 단축키 무시
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (match(e, "drawBox")) {
        if (!locked) {
          cancelDraw(); cancelChannelDraw(); cancelCircleDraw();
          setDrawMode(m => !m);
        }
        return;
      }

      const sel = getSelectedDrawable(drawables);

      if (match(e, "alert")) { sel?.toggleAlert(sel.id); return; }
      if (match(e, "lock"))  { sel?.toggleLock(sel.id);  return; }

      if (match(e, "opacityDown") || match(e, "opacityUp")) {
        if (!sel?.item) return;
        const delta = match(e, "opacityDown") ? -0.25 : 0.25;
        const clamp = v => Math.min(1, Math.max(0.25, Math.round((v + delta) * 4) / 4));
        sel.setOpacity(sel.id, clamp(sel.item.opacity));
        return;
      }

      // 타임프레임 전환
      for (let i = 0; i < TF_KEYS.length; i++) {
        if (match(e, TF_KEYS[i])) { onIntervalChange(TF_VALUES[i]); return; }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, drawables, selectedBox, drawing, hasPending, locked, deleteBox, onIntervalChange,
      setDrawMode, setCurrent, cancelDraw, cancelChannelDraw, cancelCircleDraw, setSelectedBox]);
}
