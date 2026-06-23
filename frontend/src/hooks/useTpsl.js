import { useCallback } from "react";
import { api } from "../api/client";
import { POLLING } from "../constants";
import { useStore } from "../store";
import { usePoll } from "./usePoll";

export function useTpsl() {
  const hasPos  = useStore(s => !!(s.position?.long || s.position?.short));
  const setTpsl = useStore(s => s.setTpsl);

  const fetch_ = useCallback(async () => {
    if (!hasPos) { setTpsl({ long: { tp: null, sl: null, splitTps: [] }, short: { tp: null, sl: null, splitTps: [] } }); return; }
    if (useStore.getState().tpslSaving) return;

    try {
      const data = await api("GET", "/api/tpsl");
      if (useStore.getState().tpslSaving) return;
      
      setTpsl({
        long:  { tp: data.long?.tp  ?? null, sl: data.long?.sl  ?? null, splitTps: data.long?.splitTps  ?? [] },
        short: { tp: data.short?.tp ?? null, sl: data.short?.sl ?? null, splitTps: data.short?.splitTps ?? [] },
      });
    }
    catch(e) { console.error(e); }
  }, [hasPos, setTpsl]);

  usePoll(fetch_, POLLING.TPSL_MS, "_refetchTpsl");
}
