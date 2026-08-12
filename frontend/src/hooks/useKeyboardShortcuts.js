import { useEffect } from "react";
import { getSelectedDrawable, clearAllSelections } from "../chart/drawables";

const INTERVAL_VALUES = ["5m", "15m", "1h", "4h", "1d", "1w", "1M"];

export function useKeyboardShortcuts({
  shortcuts,
  setDrawMode, setCurrent,
  cancelDraw, cancelChannelDraw, cancelCircleDraw, cancelStructDraw,
  setStructMode, structEnabled,
  drawables,   // { line, channel, circle, structure } — chart/drawables.js 인터페이스
  setSelectedBox,
  drawing, hasPending, locked,
  selectedBox,
  deleteBox,
  interval_,
  onIntervalChange,
}) {
  useEffect(() => {
    const match = (e, id) => e.key.toLowerCase() === shortcuts[id].key.toLowerCase()
      || e.key === shortcuts[id].key;

    const onKey = e => {
      if (match(e, "escape")) {
        setDrawMode(false); setCurrent(null);
        cancelDraw(); cancelChannelDraw(); cancelCircleDraw();
        cancelStructDraw();   // 그리던 구조는 확정하지 않고 버린다 (확정은 우클릭/더블클릭)
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
          cancelDraw(); cancelChannelDraw(); cancelCircleDraw(); cancelStructDraw();
          setDrawMode(m => !m);
        }
        return;
      }

      if (match(e, "drawStruct")) {
        if (!structEnabled) return;   // 지표 OFF면 그려도 안 보이므로 진입 차단 (TopBar 버튼도 동일)
        setDrawMode(false);
        cancelDraw(); cancelChannelDraw(); cancelCircleDraw();
        setStructMode(m => { if (m) cancelStructDraw(); return !m; });
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
      if (match(e, "prevTF")) {
        const idx = INTERVAL_VALUES.indexOf(interval_);
        if (idx > 0) {
          onIntervalChange(INTERVAL_VALUES[idx - 1]);
        }
        return;
      }
      if (match(e, "nextTF")) {
        const idx = INTERVAL_VALUES.indexOf(interval_);
        if (idx !== -1 && idx < INTERVAL_VALUES.length - 1) {
          onIntervalChange(INTERVAL_VALUES[idx + 1]);
        }
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, drawables, selectedBox, drawing, hasPending, locked, deleteBox, interval_, onIntervalChange,
      setDrawMode, setCurrent, cancelDraw, cancelChannelDraw, cancelCircleDraw, cancelStructDraw,
      setStructMode, structEnabled, setSelectedBox]);
}
