import { useState, useCallback } from "react";

const DEFAULT = {
  "5m":  { rsiOB: false, rsiOS: false, div: false, hiddenDiv: false, close: false, tri: false },
  "15m": { rsiOB: false, rsiOS: false, div: false, hiddenDiv: false, close: false, tri: false },
  "1h":  { rsiOB: false, rsiOS: false, div: false, hiddenDiv: false, close: false, tri: false },
  "4h":  { rsiOB: false, rsiOS: false, div: false, hiddenDiv: false, close: false, tri: false },
  "1d":  { rsiOB: false, rsiOS: false, div: false, hiddenDiv: false, close: false, tri: false },
};

export function useNotificationSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("notifSettings") || "null");
      if (!saved) return DEFAULT;
      // 저장된 값과 DEFAULT 병합 (새 키 누락 방지)
      const merged = {};
      for (const tf of Object.keys(DEFAULT)) {
        merged[tf] = { ...DEFAULT[tf], ...(saved[tf] || {}) };
      }
      return merged;
    } catch { return DEFAULT; }
  });

  const toggle = useCallback((tf, key) => {
    setSettings(prev => {
      const next = { ...prev, [tf]: { ...prev[tf], [key]: !prev[tf][key] } };
      localStorage.setItem("notifSettings", JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, toggle };
}
