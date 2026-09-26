export const createServerSlice = (set, get) => ({
  // ── 서버 상태 ─────────────────────────────────────────────────────────────
  balance:   null,
  balError:  null,
  position:  null,
  tpsl:      { long:  { tp: null, sl: null, splitTps: [], partialSls: [] },
               short: { tp: null, sl: null, splitTps: [], partialSls: [] } },
  liveClose: null,
  // ⚠ `liveClose`가 **어느 코인의 값인지**. 코인을 바꾸면 가격은 캔들을 다시 받은 뒤에야
  //   새 코인 것이 되므로, 그동안 이 값이 "아직 옛 코인이다"라고 알려 준다
  //   (없으면 새 코인 포지션에 옛 코인 가격이 곱해져 총자산이 튄다 — utils/acctPositions.js)
  liveCloseSymbol: null,
  // 계정 전체 포지션 (사이드바의 하늘색 카드). `at`은 백엔드가 그 관측을 뜬 시각이다
  acctPositions: { at: null, items: [] },

  // Refetch 콜백 (폴링 훅이 마운트 시 등록)
  _refetchBal:  () => {},
  _refetchPos:  () => {},
  _refetchTpsl: () => {},
  _refetchAcctPos: () => {},

  setBalance:   (balance)   => set({ balance }),
  setBalError:  (balError)  => set({ balError }),
  // ⚠ **부르는 쪽이 심볼을 같이 준다.** 빠뜨리면 그 값은 "어느 코인인지 모른다"가 되어
  //   미실현 계산에서 쓰이지 않는다 (틱마다 움직이던 총자산이 봉마다 움직이게 된다)
  setLiveClose: (liveClose, liveCloseSymbol = null) => set({ liveClose, liveCloseSymbol }),
  setAcctPositions: (acctPositions) => set({ acctPositions }),

  // ⚠ 심볼을 바꾼 직후 첫 응답에서 **그 심볼의 거래소 레버리지로 슬라이더를 맞춘다**
  //   (settingsSlice.setSymbol의 주석 참고). 매번 맞추지 않는 이유: 사용자가 슬라이더를
  //   움직이면 800ms debounce 뒤 미체결 주문이 재등록되는데, 그 사이 폴링 응답이
  //   옛 값을 되돌려 놓으면 **끌어도 제자리로 튀는** 슬라이더가 된다
  setPosition: (v) => {
    const s = get();
    const position = typeof v === "function" ? v(s.position) : v;
    set({ position });
    // 심볼을 바꾼 직후 첫 응답에서만 — settingsSlice가 저장까지 맡는다
    if (s.leverageSyncPending && position?.symbolLeverage > 0) {
      get().syncLeverageFromExchange(position.symbolLeverage);
    }
  },

  setTpsl: (v) => set(typeof v === "function"
    ? s => ({ tpsl: v(s.tpsl) })
    : { tpsl: v }),
});
