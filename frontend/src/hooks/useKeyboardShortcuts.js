import { useEffect } from "react";
import { getSelectedDrawable, clearAllSelections } from "../chart/drawables";

const INTERVAL_VALUES = ["5m", "15m", "1h", "4h", "1d", "1w", "1M"];

export function useKeyboardShortcuts({
  shortcuts,
  setDrawMode, setCurrent,
  cancelDraw, cancelChannelDraw, cancelCircleDraw, cancelFibDraw, cancelStructDraw,
  setStructMode, structEnabled, structMode, ensureStructTf,
  setFibMode,
  drawables,   // { line, channel, circle, fib, structure, zz } — chart/drawables.js 인터페이스
  setSelectedBox,
  drawings, hasPending, locked,
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
        cancelDraw(); cancelChannelDraw(); cancelCircleDraw(); cancelFibDraw();
        cancelStructDraw();   // 그리던 구조는 확정하지 않고 버린다 (확정은 우클릭/더블클릭)
        clearAllSelections(drawables);
        setSelectedBox(null);
        return;
      }

      if (match(e, "delete")) {
        const sel = getSelectedDrawable(drawables);
        if (sel)                                          sel.delete(sel.id);
        // ⚠ 플랜 박스가 롱·숏 둘이라 **선택된 사이드를 넘겨야 한다** (2026-08-19).
        //   `selectedBox`가 그 사이드다 (`"long"`|`"short"` — 불리언이 아니다).
        //   안 넘기면 deleteBox가 "박스가 하나뿐일 때만" 사이드를 추론하므로,
        //   둘 다 그려 뒀을 때 아무것도 안 지워진다
        else if (selectedBox && (drawings?.[selectedBox] || hasPending))
          deleteBox(selectedBox === "long" ? "LONG" : "SHORT");
        return;
      }

      // 입력 필드 포커스 시 나머지 단축키 무시
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (match(e, "drawBox")) {
        if (!locked) {
          cancelDraw(); cancelChannelDraw(); cancelCircleDraw(); cancelFibDraw(); cancelStructDraw();
          setDrawMode(m => !m);
        }
        return;
      }

      if (match(e, "drawStruct")) {
        if (!structEnabled) return;   // 지표 OFF면 그려도 안 보이므로 진입 차단 (TopBar 버튼도 동일)
        if (!structMode) ensureStructTf?.();   // 진입 시 현재 TF를 표시 목록에 편입 (TopBar 버튼과 동일)
        setDrawMode(false);
        cancelDraw(); cancelChannelDraw(); cancelCircleDraw(); cancelFibDraw();
        setStructMode(m => { if (m) cancelStructDraw(); return !m; });
        return;
      }

      // 피보나치는 지표 관문이 없다 — 선/채널/원과 같다 (chart/fib.js [F1], 2026-08-15)
      if (match(e, "drawFib")) {
        setDrawMode(false);
        cancelDraw(); cancelChannelDraw(); cancelCircleDraw(); cancelStructDraw();
        setFibMode(m => { if (m) cancelFibDraw(); return !m; });
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
  }, [shortcuts, drawables, selectedBox, drawings, hasPending, locked, deleteBox, interval_, onIntervalChange,
      setDrawMode, setCurrent, cancelDraw, cancelChannelDraw, cancelCircleDraw, cancelFibDraw, cancelStructDraw,
      setStructMode, structEnabled, structMode, ensureStructTf,
      setFibMode, setSelectedBox]);
}
