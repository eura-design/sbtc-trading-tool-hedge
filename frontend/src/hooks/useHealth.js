import { useState, useEffect } from "react";
import { API_BASE } from "../constants";

export function useHealth() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // ⚠ **반드시 시간 제한을 건다** (2026-08-23). 없으면 **얼어붙은 백엔드를 못 잡는다** —
    //   포트는 열려 있어 연결은 되는데 응답이 영영 안 와서, fetch가 끝나지 않고
    //   `online`이 true인 채로 남는다. 실제로 92분간 멈춰 있었는데 점이 계속 초록이었다
    //   (콘솔 창 클릭 → 윈도우 빠른 편집 모드가 stdout을 막아 프로세스가 통째로 얼었다).
    //   **꺼진 것**은 연결이 즉시 거부돼 catch로 잡히지만, **얼어붙은 것**은 이것 없이는 못 잡는다
    const TIMEOUT_MS = 3000;
    const check = async () => {
      const ac = new AbortController();
      const t  = setTimeout(() => ac.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${API_BASE}/api/health`, { signal: ac.signal });
        setOnline(res.ok);
      } catch {
        setOnline(false);   // 응답 없음(얼어붙음) / 연결 거부(꺼짐) 둘 다 여기로
      } finally {
        clearTimeout(t);
      }
    };
    check();
    // ⚠ 주기도 60초 → 10초. 얼어붙은 걸 1분이나 모르고 있으면 점이 있으나 마나다
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, []);

  return online;
}
