import { useEffect, useCallback } from "react";
import { api } from "../api/client";
import { POLLING } from "../constants";
import { useStore } from "../store";

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

  useEffect(() => {
    useStore.setState({ _refetchBal: fetch_ });
    fetch_();
    const id = setInterval(fetch_, POLLING.BALANCE_MS);
    return () => clearInterval(id);
  }, [fetch_]);
}
