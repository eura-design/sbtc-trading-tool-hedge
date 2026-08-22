import { useCallback } from "react";
import { api } from "../api/client";
import { POLLING } from "../constants";
import { useStore } from "../store";
import { usePoll } from "./usePoll";

export function useBalance(enabled = true) {
  const setBalance  = useStore(s => s.setBalance);
  const setBalError = useStore(s => s.setBalError);

  const fetch_ = useCallback(async () => {
    try {
      const d = await api("GET", "/api/balance");
      // ⚠ 백엔드와 프론트는 **따로 뜨는 프로세스**다. 필드명을 바꾼 뒤 백엔드를
      //   재시작하지 않으면 옛 이름(`balance`)이 그대로 날아온다 — 그때 조용히
      //   undefined가 되면 총자산이 미실현 금액만으로 찍힌다(실제로 그렇게 보였다).
      //   호환은 **여기 경계 한 곳**에서만 흡수하고, 아래 컴포넌트들은
      //   `walletBalance` 하나만 안다
      setBalance({ ...d, walletBalance: d.walletBalance ?? d.balance });
      setBalError(null);
    } catch(e) {
      setBalError(e.message);
    }
  }, [setBalance, setBalError]);

  usePoll(fetch_, POLLING.BALANCE_MS, "_refetchBal", enabled);
}
