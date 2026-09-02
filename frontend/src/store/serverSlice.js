export const createServerSlice = (set, get) => ({
  // ── 서버 상태 ─────────────────────────────────────────────────────────────
  balance:   null,
  balError:  null,
  position:  null,
  tpsl:      { long:  { tp: null, sl: null, splitTps: [], partialSls: [] },
               short: { tp: null, sl: null, splitTps: [], partialSls: [] } },
  liveClose: null,

  // Refetch 콜백 (폴링 훅이 마운트 시 등록)
  _refetchBal:  () => {},
  _refetchPos:  () => {},
  _refetchTpsl: () => {},

  setBalance:   (balance)   => set({ balance }),
  setBalError:  (balError)  => set({ balError }),
  setLiveClose: (liveClose) => set({ liveClose }),

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
