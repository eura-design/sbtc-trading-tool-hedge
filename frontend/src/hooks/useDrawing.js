import { useState, useEffect } from "react";

/**
 * 드로잉 박스 + 현재 그리기 중인 사각형 상태 관리 훅.
 * drawing은 localStorage에 저장되어 F5 후에도 복원됨.
 * localStorage 쓰기는 200ms debounce (드래그 중 60fps 직렬화 방지).
 */
export function useDrawing() {
  const [drawing, setDrawing] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("drawing") || "null");
      if (saved) {
        if (typeof saved.tStart === "string") saved.tStart = +new Date(saved.tStart);
        if (typeof saved.tEnd   === "string") saved.tEnd   = +new Date(saved.tEnd);
        if (!saved.tStart && saved.iStart !== undefined) return null;
      }
      return saved;
    } catch { return null; }
  });
  const [current,  setCurrent]  = useState(null);
  const [drawMode, setDrawMode] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      if (drawing) localStorage.setItem("drawing", JSON.stringify(drawing));
      else         localStorage.removeItem("drawing");
    }, 200);
    return () => clearTimeout(id);
  }, [drawing]);

  return { drawing, setDrawing, current, setCurrent, drawMode, setDrawMode };
}
