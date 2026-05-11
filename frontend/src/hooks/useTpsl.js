import { useEffect, useCallback } from "react";
import { api } from "../api/client";
import { POLLING } from "../constants";
import { useStore } from "../store";

export function useTpsl() {
  const hasPos  = useStore(s => !!(s.position?.long || s.position?.short));
  const setTpsl = useStore(s => s.setTpsl);

  const fetch_ = useCallback(async () => {
    if (!hasPos) { setTpsl({ tp: null, sl: null, splitTps: [] }); return; }
    try {
      const data = await api("GET", "/api/tpsl");
      setTpsl({
        long:  { tp: data.long?.tp  ?? null, sl: data.long?.sl  ?? null, splitTps: data.long?.splitTps  ?? [] },
        short: { tp: data.short?.tp ?? null, sl: data.short?.sl ?? null, splitTps: data.short?.splitTps ?? [] },
      });
    }
    catch(e) { console.error(e); }
  }, [hasPos, setTpsl]);

  useEffect(() => {
    useStore.setState({ _refetchTpsl: fetch_ });
    fetch_();
    const id = setInterval(fetch_, POLLING.TPSL_MS);
    return () => clearInterval(id);
  }, [fetch_]);
}
