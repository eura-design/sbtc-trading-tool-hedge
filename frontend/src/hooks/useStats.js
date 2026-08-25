import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";

/**
 * `YYYY-MM-DD` → 그 날의 **로컬** 시작/끝 시각.
 *
 * ⚠ `new Date("2026-08-25")`를 쓰지 말 것 — 그건 **UTC 자정**으로 읽혀서
 *   한국 기준으로는 그날 오전 9시가 된다. 달력에서 8/25를 골랐는데 그날 새벽
 *   거래가 통째로 빠진다. 사용자가 고른 날짜는 로컬 날짜다
 * ⚠ 종료일은 **그날 23:59:59.999**다. 자정으로 두면 오늘을 골랐을 때
 *   오늘 거래가 하나도 안 잡힌다
 */
function dayStart(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
function dayEnd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

export function useStats(startDate, endDate) {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);
  const [tick,    setTick]    = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    // 둘 다 비우면 백엔드가 **가능한 최대**(선물 상장일~현재)를 본다.
    // ⚠ 예전엔 시작일을 비우면 바이낸스가 최근 7일만 돌려줬다 (routes/stats.js 주석)
    const q = [];
    if (startDate) q.push(`startTime=${dayStart(startDate)}`);
    if (endDate)   q.push(`endTime=${dayEnd(endDate)}`);
    const qs = q.length ? `?${q.join("&")}` : "";
    api("GET", `/api/stats${qs}`)
      .then(data  => { if (!cancelled) setStats(data); })
      .catch(()   => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startDate, endDate, tick]);

  // 백엔드 push "stats" 수신 시 자동 refetch (CustomEvent)
  useEffect(() => {
    const handler = () => setTick(t => t + 1);
    window.addEventListener("stats-update", handler);
    return () => window.removeEventListener("stats-update", handler);
  }, []);

  return { stats, loading, error, refetch };
}
