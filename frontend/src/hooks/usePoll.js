import { useEffect } from "react";
import { useStore } from "../store";

// 사이드바 폴링 훅 공통 패턴: 초기 fetch + interval + (선택) 스토어에 refetch 콜백 등록
//
// @param enabled false면 실계좌를 읽지 않는다 — 리플레이용.
//   ⚠ refetch 콜백도 **no-op으로 바꿔 등록한다.** 그냥 두면 다른 코드가 무심코
//     _refetchPos()를 불렀을 때 페이퍼 포지션이 실계좌 값으로 덮여, 연습 중이던
//     포지션이 화면에서 사라진다.
export function usePoll(fetchFn, intervalMs, refetchKey, enabled = true) {
  useEffect(() => {
    if (refetchKey) useStore.setState({ [refetchKey]: enabled ? fetchFn : () => {} });
    if (!enabled) return;
    fetchFn();
    const id = setInterval(fetchFn, intervalMs);
    return () => clearInterval(id);
  }, [fetchFn, intervalMs, refetchKey, enabled]);
}
