import { useCallback } from "react";
import { api } from "../api/client";
import { POLLING } from "../constants";
import { useStore } from "../store";
import { usePoll } from "./usePoll";

// 계정 전체 포지션 — 사이드바의 **하늘색 카드**가 쓴다 (다른 코인의 포지션)
//
// ⚠ 이 요청에는 심볼을 싣지 않아도 된다. `api/client.js`가 화면 심볼을 자동으로 싣지만
//   `GET /api/positions`는 그 값을 보지 않는다 — 계정 전체를 준다.
// ⚠ **리플레이 중에는 돌지 않는다** (`enabled=false`). 페이퍼 브로커는 코인 하나만 알아서,
//   실계좌의 다른 코인 포지션이 연습 화면에 섞이면 어느 쪽 계좌인지 구분이 안 된다.
export function useAccountPositions(enabled = true) {
  const setAcctPositions = useStore(s => s.setAcctPositions);

  const fetch_ = useCallback(async () => {
    try {
      const data = await api("GET", "/api/positions");
      setAcctPositions({ at: data?.at ?? null, items: Array.isArray(data?.items) ? data.items : [] });
    } catch (e) {
      // ⚠ 실패해도 들고 있던 목록을 지우지 않는다 — 카드가 사라지면 포지션이 닫힌 것으로
      //   읽힌다. 백엔드의 `accountSnapshot`이 낡은 관측을 지우지 않는 것과 같은 이유다
      console.error(e);
    }
  }, [setAcctPositions]);

  usePoll(fetch_, POLLING.ACCT_POS_MS, "_refetchAcctPos", enabled);
}
