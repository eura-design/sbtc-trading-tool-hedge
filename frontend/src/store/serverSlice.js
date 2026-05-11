export const createServerSlice = (set) => ({
  // ── 서버 상태 ─────────────────────────────────────────────────────────────
  balance:   null,
  balError:  null,
  position:  null,
  tpsl:      { long: { tp: null, sl: null, splitTps: [] }, short: { tp: null, sl: null, splitTps: [] } },
  liveClose: null,

  // Refetch 콜백 (폴링 훅이 마운트 시 등록)
  _refetchBal:  () => {},
  _refetchPos:  () => {},
  _refetchTpsl: () => {},

  setBalance:   (balance)   => set({ balance }),
  setBalError:  (balError)  => set({ balError }),
  setLiveClose: (liveClose) => set({ liveClose }),

  setPosition: (v) => set(typeof v === "function"
    ? s => ({ position: v(s.position) })
    : { position: v }),

  setTpsl: (v) => set(typeof v === "function"
    ? s => ({ tpsl: v(s.tpsl) })
    : { tpsl: v }),
});
