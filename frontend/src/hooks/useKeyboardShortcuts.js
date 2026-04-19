import { useEffect } from "react";

const TF_KEYS = ["tf5m", "tf15m", "tf1h", "tf4h", "tf1d", "tf1w"];
const TF_VALUES = ["5m", "15m", "1h", "4h", "1d", "1w"];

export function useKeyboardShortcuts({
  shortcuts,
  setDrawMode, setCurrent,
  cancelDraw, cancelChannelDraw, cancelCircleDraw,
  selectedLineId, setSelectedLineId,
  selectedChannelId, setSelectedChannelId,
  selectedCircleId, setSelectedCircleId,
  setSelectedBox,
  drawing, hasPending, locked,
  selectedBox,
  deleteBox, deleteLine, deleteChannel, deleteCircle,
  toggleLineAlert, toggleChannelAlert, toggleCircleAlert,
  toggleLineLock,  toggleChannelLock,  toggleCircleLock,
  lines, channels, circles,
  setLineOpacity, setChannelOpacity, setCircleOpacity,
  onIntervalChange,
}) {
  useEffect(() => {
    const match = (e, id) => e.key.toLowerCase() === shortcuts[id].key.toLowerCase()
      || e.key === shortcuts[id].key;

    const onKey = e => {
      if (match(e, "escape")) {
        setDrawMode(false); setCurrent(null);
        cancelDraw(); cancelChannelDraw(); cancelCircleDraw();
        setSelectedLineId(null); setSelectedChannelId(null); setSelectedCircleId(null);
        setSelectedBox(false);
        return;
      }

      if (match(e, "delete")) {
        if (selectedChannelId !== null)                    deleteChannel(selectedChannelId);
        else if (selectedCircleId !== null)                deleteCircle(selectedCircleId);
        else if (selectedLineId !== null)                  deleteLine(selectedLineId);
        else if (selectedBox && (drawing || hasPending))   deleteBox();
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

      if (match(e, "alert")) {
        if (selectedChannelId !== null)      toggleChannelAlert(selectedChannelId);
        else if (selectedCircleId !== null)  toggleCircleAlert(selectedCircleId);
        else if (selectedLineId !== null)    toggleLineAlert(selectedLineId);
      }

      if (match(e, "lock")) {
        if (selectedChannelId !== null)      toggleChannelLock(selectedChannelId);
        else if (selectedCircleId !== null)  toggleCircleLock(selectedCircleId);
        else if (selectedLineId !== null)    toggleLineLock(selectedLineId);
      }

      if (match(e, "opacityDown") || match(e, "opacityUp")) {
        const delta = match(e, "opacityDown") ? -0.25 : 0.25;
        const clamp = v => Math.min(1, Math.max(0.25, Math.round((v + delta) * 4) / 4));
        if (selectedChannelId !== null) {
          const ch = channels.find(c => c.id === selectedChannelId);
          if (ch) setChannelOpacity(selectedChannelId, clamp(ch.opacity));
        } else if (selectedCircleId !== null) {
          const ci = circles.find(c => c.id === selectedCircleId);
          if (ci) setCircleOpacity(selectedCircleId, clamp(ci.opacity));
        } else if (selectedLineId !== null) {
          const ln = lines.find(l => l.id === selectedLineId);
          if (ln) setLineOpacity(selectedLineId, clamp(ln.opacity));
        }
        return;
      }

      // 타임프레임 전환
      for (let i = 0; i < TF_KEYS.length; i++) {
        if (match(e, TF_KEYS[i])) {
          onIntervalChange(TF_VALUES[i]);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    shortcuts,
    selectedLineId, selectedChannelId, selectedCircleId, selectedBox, drawing, hasPending, locked,
    deleteBox, deleteLine, deleteChannel, deleteCircle,
    toggleChannelAlert, toggleCircleAlert, toggleLineAlert,
    toggleChannelLock,  toggleCircleLock,  toggleLineLock,
    lines, circles, channels,
    setLineOpacity, setCircleOpacity, setChannelOpacity,
    onIntervalChange,
  ]);
}
