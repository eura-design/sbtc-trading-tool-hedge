import { useState, useCallback, useRef, useEffect } from "react";
import { RSI_H } from "../constants";

const MIN_H = 50;
const MAX_H = 300;

export function useRsiResize() {
  const [rsiH, setRsiH] = useState(() => Number(localStorage.getItem("rsiH")) || RSI_H);
  const dragRef    = useRef(null);
  const handlersRef = useRef(null);

  useEffect(() => { localStorage.setItem("rsiH", rsiH); }, [rsiH]);

  // 마운트 중 언마운트되어도 리스너가 남지 않도록 useEffect로 cleanup 보장
  useEffect(() => {
    return () => {
      if (handlersRef.current) {
        window.removeEventListener("mousemove", handlersRef.current.onMove);
        window.removeEventListener("mouseup",   handlersRef.current.onUp);
        handlersRef.current = null;
      }
    };
  }, []);

  const onDividerMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startY: e.clientY, startH: rsiH };

    const onMove = (ev) => {
      if (!dragRef.current) return;
      const dy = dragRef.current.startY - ev.clientY;
      setRsiH(Math.min(Math.max(dragRef.current.startH + dy, MIN_H), MAX_H));
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
  }, [rsiH]);

  return { rsiH, onDividerMouseDown };
}
