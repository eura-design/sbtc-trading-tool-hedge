import { useEffect, useRef } from "react";
import { API_BASE } from "../constants";
import { useStore } from "../store";

const WS_URL = API_BASE.replace(/^http/, "ws");

/**
 * 백엔드 WebSocket에 연결해 실시간 업데이트 신호를 수신.
 * 콜백은 useStore.getState()로 항상 최신 참조 사용 → deps 불필요.
 * 연결 끊김 시 5초 후 자동 재연결.
 *
 * @param onNotice  급하지 않은 경보를 띄울 콜백 (App이 넘기는 `addToast`)
 */
export function useRealtimeData(onNotice) {
  const wsRef    = useRef(null);
  const timerRef = useRef(null);

  // ⚠ ref로 들고 있는다 — 아래 useEffect가 `[]` deps라 클로저가 첫 렌더의 값을
  //   붙들기 때문이다. addToast는 지금 stable하지만, 그 사실에 기대면 저쪽이
  //   바뀌는 순간 **경보가 조용히 사라진다**(에러도 안 난다)
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
            if (!useStore.getState().replayOn) {
              // ⚠ **level에 따라 뜨는 자리가 갈린다** (2026-08-25 사용자 요청).
              //   예전엔 level을 **읽지도 않고** 전부 빨간 배너로 띄웠다 —
              //   `⚠ LONG 포지션에 SL이 없습니다`(손절 없음)와
              //   `TP 등록 실패 — 수동 설정 필요`(익절만 빠짐)가 같은 무게로 보여서,
              //   빨간 줄을 봐도 **읽어보기 전에는 손을 쓸지 정할 수 없었다**.
              //   이제 빨강은 뜻이 하나다 — **손절이 없거나 모자라다**.
              //
              // ⚠ **판정은 "notice면 내린다"이지 "critical이면 올린다"가 아니다.**
              //   기본이 빨강이라 **level을 안 붙이면 빨강**이 된다 — 새 경보를 추가하며
              //   level을 빠뜨려도 시끄러워질 뿐 조용히 묻히지 않는다.
              //   `=== "critical"`로 뒤집지 말 것: 그러면 빠뜨린 경보가 금색으로 내려가
              //   30초 뒤 저절로 사라진다. 손절 경보가 그렇게 되면 알 방법이 없다
              //   (이 저장소의 "모르면 불리하게" 원칙 — replay/paperBroker.js)
              if (msg.level === "notice") noticeRef.current?.(msg.msg);
              else pushCriticalAlert(msg.msg);
            }
          }

          // 백엔드가 "그 경보는 해소됐다"고 알려오면 배너를 거둔다 (2026-08-22)
          // ⚠ **리플레이 중에도 지운다** — 뜨는 것만 억누르고 거두는 걸 억누르면,
          //   연습에 들어간 사이에 해소된 경보가 나올 때까지 화면에 남는다
          // ⚠ 문구가 키다 — 백엔드(`nakedMsg`)와 글자 하나라도 어긋나면 안 닫힌다
          if (msg.type === "alert-clear") dismissCriticalAlert(msg.msg);
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
