import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { POLLING } from "../constants";

const RETRY_MS = 60_000;

export function useSRLevels() {
  const [srLevels,  setSrLevels]  = useState([]);
  const [srLoading, setSrLoading] = useState(false);

  useEffect(() => {
    let timer;

    const fetch_ = async () => {
      try {
        const data   = await api("GET", "/api/sr-levels");
        const levels = data.levels || [];
        setSrLevels(levels);
        timer = setTimeout(fetch_, levels.length ? POLLING.SR_LEVELS_MS : RETRY_MS);
      } catch {
        timer = setTimeout(fetch_, RETRY_MS);
      }
    };

    fetch_();
    return () => clearTimeout(timer);
  }, []);

  // S/R 파라미터를 백엔드로 보내 KDE 즉시 재실행 — 성공/실패를 caller에 전달
  const refreshSR = useCallback(async (srParams) => {
    setSrLoading(true);
    try {
      const data = await api("POST", "/api/sr-levels/refresh", srParams);
      if (data.levels) setSrLevels(data.levels);
      return true;
    } catch (e) {
      console.error("[SR] refresh 실패:", e);
      throw e; // caller가 에러를 처리할 수 있도록 전파
    } finally {
      setSrLoading(false);
    }
  }, []);

  return { srLevels, srLoading, refreshSR };
}
