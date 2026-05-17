import { useCallback } from "react";
import { api } from "../api/client";
import { POLLING } from "../constants";
import { useStore } from "../store";
import { usePoll } from "./usePoll";

export function usePosition() {
  const setPosition = useStore(s => s.setPosition);

  const fetch_ = useCallback(async () => {
    try { setPosition(await api("GET", "/api/position")); }
    catch(e) { console.error(e); }
  }, [setPosition]);

  usePoll(fetch_, POLLING.POSITION_MS, "_refetchPos");
}
