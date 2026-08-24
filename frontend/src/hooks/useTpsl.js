import { useCallback } from "react";
import { api } from "../api/client";
import { POLLING } from "../constants";
import { useStore } from "../store";
import { usePoll } from "./usePoll";

export function useTpsl(enabled = true) {
  const hasPos  = useStore(s => !!(s.position?.long || s.position?.short));
  const setTpsl = useStore(s => s.setTpsl);

  const fetch_ = useCallback(async () => {
    // ⚠ 포지션 유무는 **스토어에서 즉시** 읽는다 — 클로저에 잡힌 hasPos를 쓰면 안 된다.
    //   체결 push는 position/tpsl 갱신을 함께 보내는데, 그때 클로저의 hasPos는 아직
    //   "포지션 없음"이라 조회를 건너뛰고 TP/SL을 **지워버린다**.
    //   hasPos는 deps에만 남긴다 — 포지션이 새로 생긴 순간 즉시 1회 조회하기 위한 트리거다.
    const posNow = useStore.getState().position;
    if (!(posNow?.long || posNow?.short)) {
      setTpsl({ long:  { tp: null, sl: null, splitTps: [], partialSls: [] },
                short: { tp: null, sl: null, splitTps: [], partialSls: [] } });
      return;
    }
    if (useStore.getState().tpslSaving) return;

    try {
      const data = await api("GET", "/api/tpsl");
      if (useStore.getState().tpslSaving) return;
      
      setTpsl({
        // ⚠ 여기는 응답을 **필드별로 골라 담는다** — 백엔드에 항목이 생기면 이 줄도
        //   같이 늘려야 화면에 도달한다 (분할 SL을 넣을 때 실제로 빠뜨렸다)
        long:  { tp: data.long?.tp  ?? null, sl: data.long?.sl  ?? null,
                 splitTps: data.long?.splitTps  ?? [], partialSls: data.long?.partialSls  ?? [] },
        short: { tp: data.short?.tp ?? null, sl: data.short?.sl ?? null,
                 splitTps: data.short?.splitTps ?? [], partialSls: data.short?.partialSls ?? [] },
      });
    }
    catch(e) { console.error(e); }
  }, [hasPos, setTpsl]);

  usePoll(fetch_, POLLING.TPSL_MS, "_refetchTpsl", enabled);
}
