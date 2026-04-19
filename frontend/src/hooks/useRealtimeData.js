import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../constants";
import { useStore } from "../store";

const WS_URL = API_BASE.replace(/^http/, "ws");

/**
 * 백엔드 WebSocket에 연결해 실시간 업데이트 신호를 수신.
 * 콜백은 useStore.getState()로 항상 최신 참조 사용 → deps 불필요.
 * 연결 끊김 시 5초 후 자동 재연결.
 */
export function useRealtimeData() {
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef    = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    let alive = true;

    function connect() {
      if (!alive) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => { if (alive) setWsConnected(true); };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const { _refetchPos, _refetchBal, _refetchTpsl, setCriticalAlert } = useStore.getState();

          if (msg.type === "update") {
            const targets = msg.targets || [];
            if (targets.includes("position")) _refetchPos?.();
            if (targets.includes("balance"))  _refetchBal?.();
            if (targets.includes("tpsl"))     _refetchTpsl?.();
            if (targets.includes("stats"))    window.dispatchEvent(new CustomEvent("stats-update"));
          }

          if (msg.type === "alert") {
            setCriticalAlert(msg.msg);
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!alive) return;
        setWsConnected(false);
        timerRef.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      alive = false;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, []); // stable — 모든 콜백은 useStore.getState()로 최신 참조 사용

  return { wsConnected };
}
