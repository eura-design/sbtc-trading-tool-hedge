import { useState, useCallback, useRef, useEffect } from "react";
import { VOL_H } from "../constants";

const MIN_H = 40;
const MAX_H = 200;

export function useVolResize() {
  const [volH, setVolH] = useState(() => Number(localStorage.getItem("volH")) || VOL_H);
  const dragRef     = useRef(null);
  const handlersRef = useRef(null);

  useEffect(() => { localStorage.setItem("volH", volH); }, [volH]);

  useEffect(() => {
    return () => {
      if (handlersRef.current) {
        window.removeEventListener("mousemove", handlersRef.current.onMove);
        window.removeEventListener("mouseup",   handlersRef.current.onUp);
        handlersRef.current = null;
      }
    };
  }, []);

  const onVolDividerMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startY: e.clientY, startH: volH };

    const onMove = (ev) => {
      if (!dragRef.current) return;
      const dy = dragRef.current.startY - ev.clientY;
      setVolH(Math.min(Math.max(dragRef.current.startH + dy, MIN_H), MAX_H));
    };
    const onUp = () => {
      dragRef.current = null;
      handlersRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };

    handlersRef.current = { onMove, onUp };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [volH]);

  return { volH, onVolDividerMouseDown };
}
