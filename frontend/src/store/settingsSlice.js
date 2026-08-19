// Module-level timer: riskPct/leverage 변경 시 pending 주문 재등록 debounce
let _replaceTimer = null;

// ── ⚠ 리스크·레버리지는 **실거래와 연습이 완전히 따로다** (2026-08-19 사용자 요청) ──
//
// 예전엔 값 하나를 두 모드가 공유했고 localStorage 키도 같았다. 그래서 연습에서
// 레버리지를 50x로 올리거나 리스크를 3%로 올리면 **실거래 설정이 그대로 바뀌어 있었다.**
// 리플레이를 끄고 다음 실주문을 낼 때 그 값이 쓰인다 — 조용히 일어나고, 사이드바를
// 다시 열어보지 않으면 알 수 없다. 연습의 목적이 "실전에서 못 할 짓을 해보는 것"이라
// 이 누출은 방향까지 나쁘다(연습은 과감해지고 실거래가 그 값을 물려받는다).
//
// ── 왜 값을 두 개 들지 않고 키를 갈아끼우나 ─────────────────────────────
// `drawing`(uiSlice.swapDrawingStorage)과 **같은 방식**이다. 스토어 필드는 계속
// `riskPct`/`leverage` 하나라, 이 값을 읽는 곳(SidebarPanel·orderSlice·paperActions·
// PlanCard)을 **한 줄도 고치지 않아도 된다.** 필드를 둘로 늘리면 읽는 쪽마다
// `replayOn ? a : b` 분기가 생기고, 한 곳만 빠뜨리면 그 경로로 실거래 값이 샌다.
const LIVE_KEYS   = { risk: "riskPct",        lev: "leverage" };
const REPLAY_KEYS = { risk: "replay_riskPct", lev: "replay_leverage" };

const DEFAULT_RISK = 2;
const DEFAULT_LEV  = 10;

let _keys = LIVE_KEYS;   // 새로고침하면 항상 실거래로 시작한다 (replaySlice와 같은 전제)

const readRisk = () => Number(localStorage.getItem(_keys.risk)) || DEFAULT_RISK;
const readLev  = () => Number(localStorage.getItem(_keys.lev))  || DEFAULT_LEV;

/**
 * 모드 전환 시 저장 키를 갈아끼우고 새 모드의 값을 돌려준다.
 * `swapDrawingStorage`와 마찬가지로 **`replayOn`과 같은 `set` 호출**에서 써야 한다 —
 * 나누면 "replayOn은 바뀌었는데 레버리지는 아직 저쪽 모드"인 렌더가 한 번 생기고,
 * 그 사이에 주문이 나가면 엉뚱한 레버리지로 체결된다.
 */
export function swapTradeSettings(replayOn) {
  // ⚠ 대기 중인 재등록 타이머를 버린다. 남겨두면 **이전 모드에서 슬라이더를 만진
  //   결과가 새 모드에서 터진다** (실거래 미체결 주문을 연습 설정으로 재등록하는 식).
  clearTimeout(_replaceTimer);

  _keys = replayOn ? REPLAY_KEYS : LIVE_KEYS;

  // 연습 값이 아직 없으면 **실거래 값을 씨앗으로 준다.** 기본값(10x/2%)으로 시작하면
  // 처음 리플레이를 켠 사람에게는 슬라이더가 제멋대로 움직인 것처럼 보인다.
  // 한 번만 심으면 그 뒤로는 각자 간다
  if (replayOn && localStorage.getItem(REPLAY_KEYS.risk) === null) {
    localStorage.setItem(REPLAY_KEYS.risk, localStorage.getItem(LIVE_KEYS.risk) ?? DEFAULT_RISK);
    localStorage.setItem(REPLAY_KEYS.lev,  localStorage.getItem(LIVE_KEYS.lev)  ?? DEFAULT_LEV);
  }

  return { riskPct: readRisk(), leverage: readLev() };
}

export const createSettingsSlice = (set, get) => ({
  // ── 설정 (localStorage 동기화) ────────────────────────────────────────────
  // ⚠ riskPct·leverage의 저장 키는 모드에 따라 바뀐다 (위 swapTradeSettings).
  //   여기서 `"riskPct"`/`"leverage"`를 리터럴로 되돌리지 말 것 — 그 순간 두 모드가
  //   다시 같은 값을 쓰게 되고, 연습에서 올린 레버리지가 실거래로 넘어간다
  riskPct:    readRisk(),
  leverage:   readLev(),
  interval_:  localStorage.getItem("interval") || "1h",
  indicators: (() => {
    try { return JSON.parse(localStorage.getItem("indicators") || "{}"); }
    catch { return {}; }
  })(),

  setRiskPct: (riskPct) => {
    localStorage.setItem(_keys.risk, riskPct);
    set({ riskPct });
    clearTimeout(_replaceTimer);
    _replaceTimer = setTimeout(() => {
      const { drawing, replacePendingOrder } = get();
      if (drawing?.orderId) replacePendingOrder();
    }, 800);
  },

  setLeverage: (leverage) => {
    localStorage.setItem(_keys.lev, leverage);
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
