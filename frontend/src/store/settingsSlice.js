// Module-level timer: riskPct/leverage 변경 시 pending 주문 재등록 debounce
import { lsGet, lsSet } from "../utils/storage.js";
import { DEFAULT_SYMBOL, QTY_STEP, MIN_QTY } from "../constants.js";
import { setApiSymbol } from "../api/client.js";
import { swapDrawingStorage } from "./uiSlice.js";

let _replaceTimer = null;
// 이 debounce 창 안에서 값이 바뀐 **사이드**. 리스크는 한쪽만 바꾸므로,
// 롱 리스크를 만졌다고 숏 미체결 주문까지 재등록하면 안 된다.
let _replaceSides = new Set();

// ── ⚠ 리스크·레버리지는 **실거래와 연습이 완전히 따로다** (2026-08-19 사용자 요청) ──
//
// 예전엔 값 하나를 두 모드가 공유했고 localStorage 키도 같았다. 그래서 연습에서
// 레버리지를 50x로 올리거나 리스크를 3%로 올리면 **실거래 설정이 그대로 바뀌어 있었다.**
// 리플레이를 끄고 다음 실주문을 낼 때 그 값이 쓰인다 — 조용히 일어나고, 사이드바를
// 다시 열어보지 않으면 알 수 없다. 연습의 목적이 "실전에서 못 할 짓을 해보는 것"이라
// 이 누출은 방향까지 나쁘다(연습은 과감해지고 실거래가 그 값을 물려받는다).
//
// ── ⚠ 리스크 %는 **롱·숏이 또 따로다** (2026-08-19 사용자 요청) ─────────
// 그래서 값이 네 벌이다: 실거래 롱/숏 · 연습 롱/숏. (레버리지는 두 벌 그대로 —
// 바이낸스가 심볼 단위로만 받는다. `POST /fapi/v1/leverage`에 positionSide가 없어
// LONG·SHORT가 같은 값을 공유하고, 한쪽을 바꾸면 반대쪽 포지션의 청산가가 움직인다.
// 그래서 **레버리지를 사이드별로 나누지 말 것** — 화면에서만 갈라지고 거래소에서는
// 뒤에 보낸 값이 이기므로, 되레 "설정한 대로 안 나간다"가 된다.)
//
// 리스크 %는 반대로 **거래소에 보내지 않는다.** calcPosition이 수량을 뽑는 데만 쓰고
// 주문에는 그 결과인 quantity만 실린다 — 그래서 사이드별로 갈라도 거래소와 어긋날 게 없다.
//
// ── 왜 값을 두 개 들지 않고 키를 갈아끼우나 ─────────────────────────────
// `drawing`(uiSlice.swapDrawingStorage)과 **같은 방식**이다. 모드(실거래/연습)는
// 읽는 쪽에서 보이지 않는 상태라, 필드를 모드별로 늘리면 읽는 곳마다
// `replayOn ? a : b` 분기가 생기고 한 곳만 빠뜨리면 그 경로로 실거래 값이 샌다.
//
// ⚠ **사이드는 반대다 — 필드를 둘로 나눈다.** 리스크를 읽는 네 곳(SidebarPanel·
//   orderSlice 2곳·paperActions)은 전부 `drawing.isLong`을 이미 손에 들고 있어서
//   어느 쪽 값이 필요한지가 코드에 드러난다. 키를 갈아끼우는 방식으로 숨기면
//   "지금 슬라이더가 어느 사이드를 가리키나"가 화면에서도 사라진다 — 사이드바에
//   슬라이더 두 개를 **동시에** 띄워야 하므로 애초에 불가능하다.
const LIVE_KEYS = {
  riskLong: "riskPct_long", riskShort: "riskPct_short", lev: "leverage",
  legacyRisk: "riskPct",
};
const REPLAY_KEYS = {
  riskLong: "replay_riskPct_long", riskShort: "replay_riskPct_short", lev: "replay_leverage",
  legacyRisk: "replay_riskPct",
};

const DEFAULT_RISK = 2;
const DEFAULT_LEV  = 10;

let _keys = LIVE_KEYS;   // 새로고침하면 항상 실거래로 시작한다 (replaySlice와 같은 전제)

const num = (v, fb) => Number(v) || fb;

// ⚠ 사이드별 키가 없으면 **분리 이전의 값 하나**(legacyRisk)로 떨어진다.
//   옛 키를 지우거나 무시하면 업데이트 직후 첫 실행에 리스크가 조용히 기본값(2%)으로
//   되돌아간다 — replay/session.js가 구버전 세션을 계속 읽는 것과 같은 이유다.
const readRiskFrom = (keys, isLong) =>
  num(lsGet(isLong ? keys.riskLong : keys.riskShort)
      ?? lsGet(keys.legacyRisk), DEFAULT_RISK);

const readRisk = (isLong) => readRiskFrom(_keys, isLong);
const readLev  = () => num(lsGet(_keys.lev), DEFAULT_LEV);

function scheduleReplace(get, sides) {
  sides.forEach(s => _replaceSides.add(s));
  clearTimeout(_replaceTimer);
  _replaceTimer = setTimeout(async () => {
    const changed = _replaceSides;
    _replaceSides = new Set();
    const { drawings, replacePendingOrder } = get();
    // 미체결 주문이 걸린 사이드의 값이 실제로 바뀐 경우에만 재등록한다.
    // ⚠ 사이드를 **모아서** 판정하는 이유: 롱 리스크를 만진 직후 800ms 안에 숏 리스크를
    //   만지면 타이머가 교체되는데, 마지막 호출의 사이드만 보면 앞의 롱 변경이 통째로 증발한다.
    // ⚠ 플랜 박스가 둘이라 **양쪽 다 재등록될 수 있다** — 레버리지를 바꾸면 실제로
    //   롱·숏 미체결이 둘 다 새 수량으로 다시 걸려야 맞다
    // ⚠ **순차로 돈다(await).** 동시에 쏘면 둘 다 재등록 전의 `availableBalance`를 읽어,
    //   서로의 증거금이 아직 묶여 있는 줄 알고 수량을 잡는다 (레버리지를 바꾸면
    //   롱·숏이 함께 재등록되므로 실제로 일어나는 상황이다)
    for (const key of ["long", "short"]) {
      if (drawings?.[key]?.orderId && changed.has(key)) await replacePendingOrder(key === "long");
    }
  }, 800);
}

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
  _replaceSides = new Set();

  _keys = replayOn ? REPLAY_KEYS : LIVE_KEYS;

  // 연습 값이 아직 없으면 **실거래 값을 씨앗으로 준다.** 기본값(10x/2%)으로 시작하면
  // 처음 리플레이를 켠 사람에게는 슬라이더가 제멋대로 움직인 것처럼 보인다.
  // 한 번만 심으면 그 뒤로는 각자 간다.
  // ⚠ 사이드별로 따로 심을 것 — setRiskPct는 만진 쪽 키 하나만 쓰므로,
  //   연습에서 롱만 조절하면 숏 키는 계속 비어 있다.
  // ⚠ 씨앗은 **연습의 옛 값(사이드 분리 이전)이 있으면 그쪽이 우선**이다.
  //   실거래 값으로 덮으면 리스크를 롱·숏으로 나눈 그날 연습 설정이 한 번 날아간다.
  if (replayOn) {
    const legacy = lsGet(REPLAY_KEYS.legacyRisk);
    const seed = (key, isLong) => {
      if (lsGet(key) !== null) return;
      lsSet(key, legacy !== null ? num(legacy, DEFAULT_RISK)
                                                : readRiskFrom(LIVE_KEYS, isLong));
    };
    seed(REPLAY_KEYS.riskLong,  true);
    seed(REPLAY_KEYS.riskShort, false);
    if (lsGet(REPLAY_KEYS.lev) === null) {
      lsSet(REPLAY_KEYS.lev, lsGet(LIVE_KEYS.lev) ?? DEFAULT_LEV);
    }
  }

  return { riskPctLong: readRisk(true), riskPctShort: readRisk(false), leverage: readLev() };
}

/**
 * 사이드에 맞는 리스크 %를 고른다. **읽는 곳은 전부 이걸 부를 것** —
 * 각자 `isLong ? … : …`를 쓰면 한 곳만 뒤집혀도 조용히 반대쪽 리스크로 주문이 나간다.
 */
export const riskPctFor = (s, isLong) => (isLong ? s.riskPctLong : s.riskPctShort);

// ⚠ 저장돼 있던 심볼을 **스토어를 만들기 전에** API 클라이언트에 알린다.
//   안 하면 첫 폴링 몇 번이 기본 심볼로 나가서, ETH를 보고 있는데 BTC 포지션이 뜬다
setApiSymbol(lsGet("symbol") || DEFAULT_SYMBOL);

export const createSettingsSlice = (set, get) => ({
  // ── 설정 (localStorage 동기화) ────────────────────────────────────────────
  // ⚠ 리스크·레버리지의 저장 키는 모드에 따라 바뀐다 (위 swapTradeSettings).
  //   여기서 `"riskPct_long"`/`"leverage"` 같은 리터럴로 되돌리지 말 것 — 그 순간 두 모드가
  //   다시 같은 값을 쓰게 되고, 연습에서 올린 레버리지·리스크가 실거래로 넘어간다
  riskPctLong:  readRisk(true),
  riskPctShort: readRisk(false),
  leverage:   readLev(),
  interval_:  lsGet("interval") || "1h",
  // -- 심볼 (2026-09-02) ---------------------------------------------------
  // 주의: **실거래와 연습이 값을 나누지 않는다.** 리스크/레버리지와 다른 이유는,
  //   저건 "얼마를 걸까"라 연습에서 과감해진 값이 실거래로 새면 위험하지만
  //   심볼은 "무엇을 보는가"이기 때문이다. 연습에서 ETH를 보다 실거래로 돌아왔을 때
  //   화면이 BTC로 튀면 그게 더 놀랍다.
  // 주의: 심볼을 바꾸면 캔들/도형/포지션이 전부 따라 바뀐다. 값 하나가 화면 전체를
  //   갈아끼우므로 **여기 말고 다른 곳에 심볼 상태를 또 두지 말 것**
  symbol:     lsGet("symbol") || DEFAULT_SYMBOL,
  // 이 심볼의 거래 규칙 — `useSymbolFilters`가 서버에서 받아 App이 밀어 넣는다.
  // ⚠ **스토어에 두는 이유**: 수량 계산(calcPosition)을 부르는 곳이 스토어 안(orderSlice·
  //   paperActions)에도 있어서, 훅 반환값을 props로 흘리면 그 두 곳에 닿지 않는다.
  // ⚠ 처음 값은 BTCUSDT 것이다 — 못 받았을 때 화면이 멈추는 것보다 낫지만,
  //   다른 코인에서 이 값이 그대로면 수량이 틀린다. 그래서 선택기가 목록을 못 받으면 죽는다
  symbolFilters: { step: QTY_STEP, minQty: MIN_QTY, tick: 0.1, base: "BTC", onboardMs: null, maintRate: 0.004, minNotional: 0 },
  // 심볼을 막 바꿨고 아직 그 심볼의 레버리지를 못 읽었다 (serverSlice가 지운다)
  leverageSyncPending: false,
  indicators: (() => {
    try { return JSON.parse(lsGet("indicators") || "{}"); }
    catch { return {}; }
  })(),

  setRiskPct: (isLong, riskPct) => {
    lsSet(isLong ? _keys.riskLong : _keys.riskShort, riskPct);
    set(isLong ? { riskPctLong: riskPct } : { riskPctShort: riskPct });
    scheduleReplace(get, [isLong ? "long" : "short"]);
  },

  setLeverage: (leverage) => {
    lsSet(_keys.lev, leverage);
    set({ leverage });
    // 레버리지는 심볼 단위라 양쪽 다 영향을 받는다 (바이낸스가 사이드별로 안 받는다)
    scheduleReplace(get, ["long", "short"]);
  },

  /**
   * 거래소가 들고 있는 그 심볼의 레버리지로 **표시만** 맞춘다 (serverSlice가 부른다).
   *
   * ⚠ `setLeverage`를 쓰지 말 것 — 그건 `scheduleReplace`로 800ms 뒤 미체결 주문을
   *   재등록한다. 여기는 "거래소가 이미 이 값이다"를 화면에 반영하는 것이라
   *   거래소로 되돌려 보낼 것이 없고, 재등록은 사용자가 시키지 않은 주문 조작이 된다.
   * ⚠ localStorage에도 쓴다 — 안 쓰면 새로고침했을 때 옛 값이 되살아난다
   */
  syncLeverageFromExchange: (leverage) => {
    if (!(leverage > 0) || leverage === get().leverage) {
      set({ leverageSyncPending: false });
      return;
    }
    lsSet(_keys.lev, leverage);
    set({ leverage, leverageSyncPending: false });
  },

  setSymbol: (symbol) => {
    if (!symbol || symbol === get().symbol) return;
    lsSet("symbol", symbol);
    // ⚠ API 클라이언트에도 즉시 알린다. 여기서 안 하면 심볼을 바꾼 직후의 주문이
    //   **옛 심볼로 나간다** (client.js는 store를 import할 수 없어 밀어 넣는 방식이다)
    setApiSymbol(symbol);
    // ⚠ **플랜 박스도 여기서 갈아끼운다** — 리플레이 전환(replaySlice)과 같은 이유다.
    //   안 하면 BTC 박스가 ETH 화면에 남아 있다가, App의 drawing↔pending 동기화가
    //   "ETH에는 그런 미체결이 없다"고 보고 **그 박스를 지운다**.
    //   다른 도형은 키에 심볼이 들어가 useDrawableStore가 알아서 다시 읽는다
    const drawings = swapDrawingStorage(get().replayOn, get().drawings, symbol);
    // ⚠ **레버리지는 바이낸스가 심볼 단위로 들고 있다.** 화면은 값 하나뿐이라,
    //   BTC에서 5x로 두고 ETH로 옮기면 화면은 5x인데 거래소의 ETH는 예전 값이다
    //   (실측 2026-09-02: BTC 5x / ETH 1x / DOGE 1x).
    //   → 여기서 **거래소에 밀어 넣지 않는다.** 심볼을 고른 것만으로 거래소 설정이
    //     바뀌면, 그 심볼에 포지션이 있을 때 청산가가 말없이 움직인다.
    //     대신 표시를 거래소에 맞춘다: 다음 position 응답이 알려 준다 (serverSlice)
    set({ symbol, drawings, leverageSyncPending: true });
  },

  setSymbolFilters: (f) => set({ symbolFilters: f }),

  setInterval_: (interval_) => {
    lsSet("interval", interval_);
    set({ interval_ });
  },

  toggleIndicator: (key) => {
    const cur = get().indicators;
    const indicators = { ...cur, [key]: cur[key] !== false ? false : true };
    lsSet("indicators", JSON.stringify(indicators));
    set({ indicators });
  },
});
