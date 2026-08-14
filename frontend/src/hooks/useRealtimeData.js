import { useEffect, useRef } from "react";
import { API_BASE } from "../constants";
import { useStore } from "../store";

const WS_URL = API_BASE.replace(/^http/, "ws");

/**
 * 백엔드 WebSocket에 연결해 실시간 업데이트 신호를 수신.
 * 콜백은 useStore.getState()로 항상 최신 참조 사용 → deps 불필요.
 * 연결 끊김 시 5초 후 자동 재연결.
 */
export function useRealtimeData() {
  const wsRef    = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    let alive = true;

    function connect() {
      if (!alive) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

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
            // 리플레이 중에는 억누른다 — 실계좌 경보가 연습 화면 위에 뜨면
            // 어느 쪽 계좌 얘기인지 구분이 안 된다 (알림 자체는 실거래로 돌아오면 다시 뜬다)
            if (!useStore.getState().replayOn) setCriticalAlert(msg.msg);
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!alive) return;
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
}
