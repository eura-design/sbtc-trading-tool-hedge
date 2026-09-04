import { useState, useCallback } from "react";
import { lsGet, lsSet } from "../utils/storage";

// ⚠ **RSI는 과매수·과매도가 한 칸이다** (2026-09-04 사용자 요청). 예전엔 `rsiOB`·`rsiOS`로
//   나뉘어 7 TF × 2 = 14칸이었다. 나눠서 얻는 것이 거의 없었다 — 알림 문구가 이미
//   `RSI 과매수 진입` / `RSI 과매도 진입`으로 갈리므로 **울린 뒤에 어느 쪽인지 알 수 있다.**
const DEFAULT = {
  "5m":  { rsi: false, close: false },
  "15m": { rsi: false, close: false },
  "1h":  { rsi: false, close: false },
  "4h":  { rsi: false, close: false },
  "1d":  { rsi: false, close: false },
  "1w":  { rsi: false, close: false },
  "1M":  { rsi: false, close: false },
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
        // 옛 두 칸(`rsiOB`/`rsiOS`)을 한 칸으로 옮긴다 — **둘 중 하나라도 켰으면 켠 것으로 본다.**
        //   ⚠ 위 루프는 DEFAULT에 없는 키를 버리므로, 이 줄이 없으면 켜 두었던 알림이
        //     조용히 꺼진다. 새 값(`rsi`)이 이미 저장돼 있으면 그것이 이긴다
        if (s.rsi === undefined && (s.rsiOB || s.rsiOS)) merged[tf].rsi = true;
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
