import { useState, useCallback } from "react";
import { lsGet, lsSet } from "../utils/storage";

const DEFAULT = {
  "5m":  { rsiOB: false, rsiOS: false, close: false },
  "15m": { rsiOB: false, rsiOS: false, close: false },
  "1h":  { rsiOB: false, rsiOS: false, close: false },
  "4h":  { rsiOB: false, rsiOS: false, close: false },
  "1d":  { rsiOB: false, rsiOS: false, close: false },
  "1w":  { rsiOB: false, rsiOS: false, close: false },
  "1M":  { rsiOB: false, rsiOS: false, close: false },
};

export function useNotificationSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(lsGet("notifSettings") || "null");
      if (!saved) return DEFAULT;
      // 저장된 값과 DEFAULT 병합 (새 키 누락 방지)
      // DEFAULT에 있는 키만 통과시킨다 — 제거된 알림(다이버전스 등)이 되살아나지 않게
      const merged = {};
      for (const tf of Object.keys(DEFAULT)) {
        const s = saved[tf] || {};
        merged[tf] = {};
        for (const key of Object.keys(DEFAULT[tf])) {
          merged[tf][key] = s[key] ?? DEFAULT[tf][key];
        }
      }
      return merged;
    } catch { return DEFAULT; }
  });

  const toggle = useCallback((tf, key) => {
    setSettings(prev => {
      const next = { ...prev, [tf]: { ...prev[tf], [key]: !prev[tf][key] } };
      lsSet("notifSettings", JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, toggle };
}
