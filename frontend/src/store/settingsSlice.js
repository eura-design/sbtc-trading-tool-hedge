// Module-level timer: riskPct/leverage 변경 시 pending 주문 재등록 debounce
let _replaceTimer = null;

export const createSettingsSlice = (set, get) => ({
  // ── 설정 (localStorage 동기화) ────────────────────────────────────────────
  riskPct:    Number(localStorage.getItem("riskPct"))  || 2,
  leverage:   Number(localStorage.getItem("leverage")) || 10,
  interval_:  localStorage.getItem("interval") || "1h",
  indicators: (() => {
    try { return JSON.parse(localStorage.getItem("indicators") || "{}"); }
    catch { return {}; }
  })(),

  setRiskPct: (riskPct) => {
    localStorage.setItem("riskPct", riskPct);
    set({ riskPct });
    clearTimeout(_replaceTimer);
    _replaceTimer = setTimeout(() => {
      const { drawing, replacePendingOrder } = get();
      if (drawing?.orderId) replacePendingOrder();
    }, 800);
  },

  setLeverage: (leverage) => {
    localStorage.setItem("leverage", leverage);
    set({ leverage });
    clearTimeout(_replaceTimer);
    _replaceTimer = setTimeout(() => {
      const { drawing, replacePendingOrder } = get();
      if (drawing?.orderId) replacePendingOrder();
    }, 800);
  },

  setInterval_: (interval_) => {
    localStorage.setItem("interval", interval_);
    set({ interval_ });
  },

  toggleIndicator: (key) => {
    const cur = get().indicators;
    const indicators = { ...cur, [key]: cur[key] !== false ? false : true };
    localStorage.setItem("indicators", JSON.stringify(indicators));
    set({ indicators });
  },
});
