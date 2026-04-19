import { useEffect, useCallback } from "react";
import { api } from "../api/client";
import { POLLING } from "../constants";
import { useStore } from "../store";

export function usePosition() {
  const setPosition = useStore(s => s.setPosition);

  const fetch_ = useCallback(async () => {
    try { setPosition(await api("GET", "/api/position")); }
    catch(e) { console.error(e); }
  }, [setPosition]);

  useEffect(() => {
    useStore.setState({ _refetchPos: fetch_ });
    fetch_();
    const id = setInterval(fetch_, POLLING.POSITION_MS);
    return () => clearInterval(id);
  }, [fetch_]);
}
