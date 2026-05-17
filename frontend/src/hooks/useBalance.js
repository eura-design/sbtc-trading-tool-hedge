import { useCallback } from "react";
import { api } from "../api/client";
import { POLLING } from "../constants";
import { useStore } from "../store";
import { usePoll } from "./usePoll";

export function useBalance() {
  const setBalance  = useStore(s => s.setBalance);
  const setBalError = useStore(s => s.setBalError);

  const fetch_ = useCallback(async () => {
    try {
      setBalance(await api("GET", "/api/balance"));
      setBalError(null);
    } catch(e) {
      setBalError(e.message);
    }
  }, [setBalance, setBalError]);

  usePoll(fetch_, POLLING.BALANCE_MS, "_refetchBal");
}
