import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";

const POLL_MS = 60_000; // 1분 폴링

export function useDailyLoss() {
  const [data, setData] = useState(null);

  const fetch_ = useCallback(async () => {
    try {
      setData(await api("GET", "/api/daily-loss"));
    } catch {
      // 실패 시 무시 — 다음 폴링에서 재시도
    }
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, POLL_MS);
    return () => clearInterval(id);
  }, [fetch_]);

  return data;
}
