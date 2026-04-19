import { useState, useLayoutEffect } from "react";

export function useChartSize(containerRef) {
  const [size, setSize] = useState({ w: 800, h: 500 });

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.max(width, 300), h: Math.max(height, 300) });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  return size;
}
