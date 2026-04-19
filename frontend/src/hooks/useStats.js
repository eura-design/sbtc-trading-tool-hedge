import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";

export function useStats(startDate) {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);
  const [tick,    setTick]    = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    const qs = startDate ? `?startTime=${new Date(startDate).getTime()}` : "";
    api("GET", `/api/stats${qs}`)
      .then(data  => { if (!cancelled) setStats(data); })
      .catch(()   => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startDate, tick]);

  // 백엔드 push "stats" 수신 시 자동 refetch (CustomEvent)
  useEffect(() => {
    const handler = () => setTick(t => t + 1);
    window.addEventListener("stats-update", handler);
    return () => window.removeEventListener("stats-update", handler);
  }, []);

  return { stats, loading, error, refetch };
}
