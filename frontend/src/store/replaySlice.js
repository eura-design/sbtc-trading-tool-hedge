// 리플레이 모드 상태
//
// ── 왜 스토어인가 ────────────────────────────────────────────────────────
// isLog·sidebarOpen처럼 App 로컬 state로 둘 수도 있지만, 리플레이 여부는
// **주문 경로까지 막아야 하는 값**이다(orderSlice). 사이드바 깊숙한 컴포넌트까지
// prop으로 내리면 중간 한 곳만 빠뜨려도 그 경로로 실주문이 나간다.
//
// ── replayOn은 저장하지 않는다 ───────────────────────────────────────────
// 새로고침하면 **항상 실거래 모드로 시작**한다. 리플레이 상태로 복원되면
// 페이퍼 화면을 실거래로 착각하거나(반대도 마찬가지) 하는 사고가 난다.
// 편의를 위해 마지막으로 고른 **시작 날짜만** 저장한다.

import { setReplayGuard } from "../api/client.js";
import { clientLog } from "../api/clientLog.js";
import { swapDrawingStorage } from "./uiSlice.js";
import { swapTradeSettings } from "./settingsSlice.js";
import { lsGet, lsSet } from "../utils/storage.js";

const START_KEY = "replay_start_ms";

// ── 한 세션의 최대 길이 ──────────────────────────────────────────────────
// 시작일만 고르고 끝을 "현재"로 두면, 2024년을 고른 순간 재생 구간이 2년이 된다.
// 구동 TF(1h 리플레이면 5m) 기준 **23만 봉 = 155회 요청**이라 첫 로드가 1분을 넘긴다(실측).
// 게다가 12틱짜리 봉이 1만 9천 개라 실제로 끝까지 재생할 수도 없다.
//
// 그래서 시작일에서 90일까지만 싣는다. 5m 구동으로 26,000봉(18회 요청, 2초)이고
// 1h 봉 2,160개면 연습 세션으로 충분하다.
// ⚠ 더 뒤를 보려면 시작일을 옮긴다. 자동 연장은 넣지 않았다 —
//   구간이 바뀌면 엔진을 다시 만들어야 해서 재생 위치와 연습 계좌가 초기화된다.
export const SESSION_MAX_MS = 90 * 86_400_000;

/** 시작 시각에 맞는 끝 시각 — 현재를 넘지 않는다 */
export const sessionEnd = (startMs) => Math.min(Date.now(), startMs + SESSION_MAX_MS);

/**
 * 그 심볼의 **상장일보다 앞선 시작은 밀어 올린다** (2026-09-03, 순수 함수).
 *
 * ⚠ `replay_start_ms`는 **심볼별이 아니라 하나뿐이다.** BTC에서 2021년을 골라 두고
 *   늦게 상장한 코인으로 옮기면 그 값이 그대로 쓰인다. 그런데 바이낸스는 빈 배열이
 *   아니라 **가장 이른 캔들**을 돌려준다 — 리플레이 시계는 2021년인데 화면에는
 *   2023년 캔들이 재생되어 **조용히 어긋난다**
 *   (실측 2026-09-03: 1000BONK 1040일 · 1000FLOKI 840일 차이).
 *   거래 가능한 526개 중 **470개(89%)**가 이 상황에 걸렸다.
 *
 * ⚠ 상장일을 아직 못 받았으면(`null`) **손대지 않는다** — 모르면서 옮기는 것보다
 *   그대로 두는 쪽이 맞다. 값은 `useSymbolFilters`가 exchangeInfo에서 받아 준다.
 *
 * ※ 날짜 입력칸의 `min` 속성만으로는 못 막는다. 그건 사람이 고를 때만 걸리고,
 *   **저장된 값을 불러오는 경로**에는 적용되지 않는다 (이 버그가 그 경로였다)
 */
export const clampToListing = (startMs, onboardMs) =>
  (onboardMs && startMs && startMs < onboardMs) ? onboardMs : startMs;

function loadStart() {
  const v = Number(lsGet(START_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export const createReplaySlice = (set, get) => ({
  // 리플레이 모드 on/off — 이 값 하나가 실주문 차단의 기준이다
  replayOn: false,

  // 재생 구간
  replayStartMs: loadStart(),
  replayEndMs: null,          // null = 현재 시각까지

  // ※ `replayShowLive`(기존 도형 보기)는 2026-08-15 사용자 요청으로 기능째 제거됐다

  // 엔진이 매 틱 밀어 넣는 값 (지표·알림이 이걸 보고 미래를 자른다)
  replayNowMs: null,
  replayPrice: null,

  // 페이퍼 계좌. 클래스 인스턴스라 값 비교 대상이 아니고, 여기 두는 이유는
  // orderSlice(주문 액션)와 useReplay(틱 진행) 양쪽이 같은 것을 잡아야 하기 때문이다
  paperBroker: null,
  setPaperBroker: (b) => set({ paperBroker: b }),

  // 세션 저장 예약 함수 — useReplay가 등록한다. 주문으로 계좌가 바뀔 때도
  // 저장돼야 하는데, 저장 키(구간)를 아는 건 useReplay 쪽이라 이렇게 연결한다
  scheduleReplaySave: null,
  setScheduleReplaySave: (fn) => set({ scheduleReplaySave: fn }),

  setReplayOn: (v) => {
    const on = typeof v === "function" ? v(get().replayOn) : !!v;
    // 실주문 차단은 **상태보다 먼저** 건다 — 렌더 타이밍에 기대지 않기 위해서다
    setReplayGuard(on);
    // ⚠ 모드 전환을 기록한다 — 나중에 로그를 볼 때 **"그때 연습 중이었나"**가
    //   자주 답이다 (주문이 왜 안 나갔는지, 왜 알림이 안 떴는지)
    if (on !== get().replayOn) clientLog("MODE_CHANGED", { replay: on });
    // 켤 때 balError를 지운다 — 페이퍼 계좌는 백엔드와 무관한데, 서버가 죽어 있으면
    // 그 에러 배너가 잔고 카드 자리를 계속 차지해 연습 잔고가 아예 안 보인다
    // 끌 때 시계를 비운다 — 남아 있으면 실거래로 돌아온 뒤에도 지표가
    // 과거 시각으로 잘린 채 계산된다
    //
    // ⚠ 플랜 박스(drawing)도 여기서 갈아끼운다. 안 하면 리플레이에 들어가는 순간
    //   App의 drawing↔pending 동기화가 페이퍼 position(pending 없음)을 보고
    //   **실거래 플랜 박스를 지운다** (uiSlice.js의 swapDrawingStorage 참고)
    //
    // ⚠ **리스크·레버리지도 여기서 갈아끼운다** (2026-08-19). 예전엔 두 모드가 값
    //   하나를 공유해서, 연습에서 레버리지를 50x로 올리면 실거래 설정이 그대로
    //   50x가 됐다 — 리플레이를 끄고 다음 실주문을 낼 때 그 값이 쓰인다
    //   (store/settingsSlice.js의 swapTradeSettings 참고)
    const drawings = swapDrawingStorage(on, get().drawings, get().symbol);
    const trade   = swapTradeSettings(on);
    set(on
      ? { replayOn: true, balError: null, drawings, ...trade }
      : {
          replayOn: false, replayNowMs: null, replayPrice: null, drawings, ...trade,
          // ⚠ 나갈 때 페이퍼 스냅샷을 **앱 시작 직후 상태로 되돌린다**
          //   (serverSlice의 초기값과 글자 그대로 같은 값 — 이미 모든 화면이 다루는 상태다).
          //
          //   syncPaper가 연습 계좌를 실계좌와 **같은 슬롯**에 써 넣으므로, 안 지우면
          //   실계좌 응답이 도착할 때까지 **연습 계좌의 포지션·잔고가 실계좌인 척**
          //   화면에 남는다. 사이드바 숫자와 차트 진입선이 전부 그 값을 그린다.
          //
          //   ⚠ 반드시 replayOn과 **같은 set 호출**에 둘 것. 나눠 쓰면 그 사이에
          //     "replayOn=false인데 position은 아직 페이퍼"인 렌더가 한 번 생긴다.
          //   ※ 비우기만 하면 된다 — 직후에 usePosition/useBalance/useTpsl의 enabled가
          //     바뀌며 usePoll이 재실행돼 곧바로 실계좌를 다시 읽는다.
          //   ※ 2026-09-04 이전에는 여기에 "안 지우면 포지션 종료 토스트가 오작동한다"는
          //     이유도 적혀 있었다. 그 판정을 하던 `usePositionCloseAlert`은 지워졌고
          //     지금은 백엔드(orderWatcher)가 계정 전체를 보고 알린다 — 화면 상태와
          //     무관하므로 이 오작동은 원인째 사라졌다.
          position: null,
          balance:  null,
          tpsl: { long: { tp: null, sl: null, splitTps: [] }, short: { tp: null, sl: null, splitTps: [] } },
        });
  },

  // 시작일이 바뀌면 끝도 같이 다시 잡는다. 안 그러면 리플레이 도중 날짜를 과거로
  // 옮겼을 때 구간만 계속 길어져 로딩이 감당이 안 된다 (위 SESSION_MAX_MS 참고)
  setReplayRange: ({ startMs, endMs }) => {
    const patch = {};
    if (startMs !== undefined) {
      // ⚠ 상장일보다 앞서면 밀어 올린다 (clampToListing 주석). 리플레이에 닿는
      //   모든 경로가 여기를 지나므로 — 진입(onReplayToggle)·날짜 선택·무작위 —
      //   **한 곳만 막으면 된다**. 심볼 선택기는 리플레이 중에 잠겨서 도중 변경은 없다
      const start = clampToListing(startMs, get().symbolFilters?.onboardMs);
      patch.replayStartMs = start;
      if (start) {
        lsSet(START_KEY, String(start));
        patch.replayEndMs = sessionEnd(start);
      }
    }
    if (endMs !== undefined) patch.replayEndMs = endMs;
    set(patch);
  },

  /**
   * 페이퍼 계좌 → 스토어. **백엔드 응답과 같은 모양**이라 사이드바·차트 오버레이가
   * 리플레이인지 모른 채 그대로 그린다 (paperBroker.js 상단 주석 참고).
   * 주문 직후와 매 틱 뒤에 부른다.
   */
  syncPaper: () => {
    const s = get();
    // ⚠ 리플레이가 꺼져 있으면 **아무것도 쓰지 않는다.** 종료 직후에도 재생 루프의
    //   setTimeout이 한 번 더 남아 applyMove → syncBroker로 여기 도달할 수 있는데,
    //   그때 페이퍼 값이 실계좌 슬롯을 덮으면 setReplayOn이 비워둔 게 무의미해지고
    //   `롱/숏 포지션 종료` 오알림이 그대로 재현된다
    if (!s.replayOn) return;
    const b = s.paperBroker;
    if (!b) return;
    const mark = s.replayPrice ?? b.lastPrice;
    s.setPosition(b.positionSnapshot(mark));
    s.setTpsl(b.tpslSnapshot());
    s.setBalance(b.balanceSnapshot(mark));
  },

  // 틱마다 불린다 — 값이 그대로면 set을 건너뛴다.
  // (구독자가 많은 값이라 같은 값으로 리렌더를 돌리면 틱마다 화면 전체가 흔들린다)
  setReplayClock: (nowMs, price) => {
    const s = get();
    if (s.replayNowMs === nowMs && s.replayPrice === price) return;
    set({ replayNowMs: nowMs, replayPrice: price });
  },
});
