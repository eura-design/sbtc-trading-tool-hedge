import { useState, useCallback } from "react";
import { api } from "../api/client";
import { usePoll } from "./usePoll";

const POLL_MS = 60_000;

export function useDailyLoss() {
  const [data, setData] = useState(null);

  const fetch_ = useCallback(async () => {
    try { setData(await api("GET", "/api/daily-loss")); }
    catch { /* 실패 시 무시 — 다음 폴링에서 재시도 */ }
  }, []);

  usePoll(fetch_, POLL_MS);
  return data;
}
