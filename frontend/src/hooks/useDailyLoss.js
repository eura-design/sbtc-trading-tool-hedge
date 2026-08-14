import { useState, useCallback } from "react";
import { api } from "../api/client";
import { usePoll } from "./usePoll";

const POLL_MS = 60_000;

// @param enabled 리플레이 중에는 실계좌를 읽지 않는다 — 페이퍼 한도는
//   replay/dailyLoss.js가 재생 시각 기준으로 따로 계산한다
export function useDailyLoss(enabled = true) {
  const [data, setData] = useState(null);

  const fetch_ = useCallback(async () => {
    try { setData(await api("GET", "/api/daily-loss")); }
    catch { /* 실패 시 무시 — 다음 폴링에서 재시도 */ }
  }, []);

  usePoll(fetch_, POLL_MS, undefined, enabled);
  return data;
}
