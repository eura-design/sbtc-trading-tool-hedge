import { useEffect } from "react";
import { useStore } from "../store";

// 사이드바 폴링 훅 공통 패턴: 초기 fetch + interval + (선택) 스토어에 refetch 콜백 등록
export function usePoll(fetchFn, intervalMs, refetchKey) {
  useEffect(() => {
    if (refetchKey) useStore.setState({ [refetchKey]: fetchFn });
    fetchFn();
    const id = setInterval(fetchFn, intervalMs);
    return () => clearInterval(id);
  }, [fetchFn, intervalMs, refetchKey]);
}
