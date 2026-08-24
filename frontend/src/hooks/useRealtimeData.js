import { useEffect, useRef } from "react";
import { API_BASE } from "../constants";
import { useStore } from "../store";

const WS_URL = API_BASE.replace(/^http/, "ws");

/**
 * 백엔드 WebSocket에 연결해 실시간 업데이트 신호를 수신.
 * 콜백은 useStore.getState()로 항상 최신 참조 사용 → deps 불필요.
 * 연결 끊김 시 5초 후 자동 재연결.
 */
export function useRealtimeData(onNotice) {
  const wsRef    = useRef(null);
  const timerRef = useRef(null);
  // 연결 이펙트는 deps가 비어 있어 클로저가 첫 렌더 값을 붙든다 → ref로 최신 것을 본다
  // (파일 상단 주석의 "항상 최신 참조" 원칙과 같은 이유)
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;

  useEffect(() => {
    let alive = true;

    function connect() {
      if (!alive) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const { _refetchPos, _refetchBal, _refetchTpsl,
                  pushCriticalAlert, dismissCriticalAlert } = useStore.getState();

          if (msg.type === "update") {
            const targets = msg.targets || [];
            if (targets.includes("balance"))  _refetchBal?.();
            if (targets.includes("stats"))    window.dispatchEvent(new CustomEvent("stats-update"));

            // ⚠ position → tpsl **순서**를 지킨다. useTpsl은 "포지션이 있나"를 보고
            //   조회 여부를 정하는데, 체결 직후엔 아직 포지션이 스토어에 없어서
            //   동시에 부르면 TP/SL을 조회 없이 지워버린다 (그 뒤 60초 폴링까지 공백).
            const wantPos  = targets.includes("position");
            const wantTpsl = targets.includes("tpsl");
            if (wantPos && wantTpsl) {
              Promise.resolve(_refetchPos?.()).finally(() => useStore.getState()._refetchTpsl?.());
            } else {
              if (wantPos)  _refetchPos?.();
              if (wantTpsl) _refetchTpsl?.();
            }
          }

          if (msg.type === "alert") {
            // 리플레이 중에는 억누른다 — 실계좌 경보가 연습 화면 위에 뜨면
            // 어느 쪽 계좌 얘기인지 구분이 안 된다 (알림 자체는 실거래로 돌아오면 다시 뜬다)
            if (!useStore.getState().replayOn) pushCriticalAlert(msg.msg);
          }

          // 백엔드가 "그 경보는 해소됐다"고 알려오면 배너를 거둔다 (2026-08-22)
          // ⚠ **리플레이 중에도 지운다** — 뜨는 것만 억누르고 거두는 걸 억누르면,
          //   연습에 들어간 사이에 해소된 경보가 나올 때까지 화면에 남는다
          // ⚠ 문구가 키다 — 백엔드(`nakedMsg`)와 글자 하나라도 어긋나면 안 닫힌다
          if (msg.type === "alert-clear") dismissCriticalAlert(msg.msg);

          // 지나가는 알림 — 금색 토스트 (2026-08-24)
          // 무방비 경보가 **왜 사라졌는지**를 알려준다. 배너가 소리 없이 없어지면
          // 봤던 사람은 해결된 것인지 오작동이었는지 알 수 없다
          // ⚠ 경보와 같은 이유로 리플레이 중에는 억누른다 — 실계좌 얘기라
          //   연습 화면 위에 뜨면 어느 쪽 계좌인지 구분이 안 된다
          if (msg.type === "notice") {
            if (!useStore.getState().replayOn) noticeRef.current?.(msg.msg);
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
