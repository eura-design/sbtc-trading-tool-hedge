// 심볼별 거래 규칙 — 바이낸스 `exchangeInfo`가 원본 (2026-09-02)
//
// ── 왜 생겼나 ──────────────────────────────────────────────────────────────
// 그전에는 호가 단위가 **0.1 고정**, 수량이 **toFixed(3) 고정**이었다. 그건 BTCUSDT의
// 값이고, 다른 코인은 전부 다르다 (utils/round.js 머리 주석의 표 참고).
// 값을 코드에 적어 두면 코인을 추가할 때마다 표를 손봐야 하고, 바이낸스가 규칙을
// 바꾸면 우리만 모른다. 그래서 **받아 쓴다.**
//
// ── 왜 binanceClient가 아니라 여기인가 ─────────────────────────────────────
// binanceClient가 주문을 낼 때 이 값을 쓴다 → 반대로 여기서 binanceClient를 부르면
// 순환 참조다. exchangeInfo는 서명이 필요 없는 공개 API라 axios를 직접 쓴다.
//
// ── 캐시가 비어 있을 때 무엇을 하는가 (중요) ───────────────────────────────
// **BTCUSDT만 코드에 심어 둔다** (SEED). 바이낸스가 잠깐 안 될 때도 지금까지 하던
// 거래는 그대로 되게 하려는 것이다 — 값이 지금 코드에 박혀 있던 것과 똑같으므로
// 이 파일이 생기기 전보다 나빠지는 경우가 없다.
// **다른 심볼은 심어 두지 않는다.** 모르는 심볼에 BTC 단위를 적용하는 것이 최악이다
// (조용히 엉뚱한 가격에 주문이 걸린다). 모르면 던진다 — 주문이 실패하는 편이 낫다.

const axios = require("axios");
const { roundToTick, floorToStep } = require("../utils/round");
const { log, errOf } = require("../store/logStore");

const BASE = "https://fapi.binance.com";

// 지금 이 시스템이 다루는 기본 심볼. 심볼을 안 넘긴 호출이 이걸로 떨어진다.
// ⚠ 화면에서 심볼을 고르게 되면 **부르는 쪽이 넘겨야 한다** — 기본값에 기대면
//   ETH 주문에 BTC 단위가 적용되고, 그 사실이 아무 데도 안 드러난다
const DEFAULT_SYMBOL = "BTCUSDT";

// 2026-09-02 시점 BTCUSDT의 실제 필터값 = 이 파일이 생기기 전 코드에 박혀 있던 값.
// 바꾸지 말 것 — 바꾸면 "캐시가 비었을 때"의 동작이 조용히 달라진다
const SEED = {
  BTCUSDT: { symbol: "BTCUSDT", tickSize: "0.10", stepSize: "0.001",
             minQty: "0.001", minNotional: "100",
             onboardDate: 1567965300000, seeded: true },   // 2019-09-08
};

// exchangeInfo는 자주 바뀌지 않는다 (상장·상장폐지·필터 변경 정도).
// 12시간이면 충분하고, 서버가 하루 넘게 떠 있어도 낡은 값을 안 쓴다
const REFRESH_MS = 12 * 60 * 60 * 1000;

let _map      = new Map(Object.entries(SEED));
let _loadedAt = 0;
let _timer    = null;

const filterOf = (list, type) => list.find(f => f.filterType === type);

/** exchangeInfo를 받아 캐시를 갈아 끼운다. 실패하면 **기존 캐시를 유지한다** */
async function load() {
  try {
    const { data } = await axios.get(`${BASE}/fapi/v1/exchangeInfo`, { timeout: 15000 });
    const next = new Map();
    for (const s of data.symbols ?? []) {
      const price = filterOf(s.filters ?? [], "PRICE_FILTER");
      const lot   = filterOf(s.filters ?? [], "LOT_SIZE");
      if (!price?.tickSize || !lot?.stepSize) continue;   // 규칙을 모르면 담지 않는다
      next.set(s.symbol, {
        symbol:       s.symbol,
        tickSize:     price.tickSize,
        stepSize:     lot.stepSize,
        minQty:       lot.minQty ?? "0",
        minNotional:  filterOf(s.filters, "MIN_NOTIONAL")?.notional ?? null,
        status:       s.status,          // TRADING / BREAK / …
        contractType: s.contractType,    // PERPETUAL / CURRENT_QUARTER / …
        quoteAsset:   s.quoteAsset,
        baseAsset:    s.baseAsset,
        // 상장일 — 리플레이가 그 이전 구간을 고르지 못하게 막는다.
        // ⚠ 코인마다 다르다: BTC 2019-09-08 / ETH 2019-11-27 / DOGE 2020-07-10 (실측).
        //   하나로 박아 두면 늦게 상장된 코인에서 **빈 캔들이 재생된다**
        onboardDate:  s.onboardDate ?? null,
      });
    }
    if (!next.size) throw new Error("exchangeInfo에 심볼이 없다");

    // ⚠ SEED는 **덮어쓴다** — 받아온 값이 원본이다. 다만 응답에 BTCUSDT가 없는
    //   이상한 경우를 대비해 없을 때만 되살린다
    if (!next.has(DEFAULT_SYMBOL)) next.set(DEFAULT_SYMBOL, SEED[DEFAULT_SYMBOL]);

    const before = _map.get(DEFAULT_SYMBOL);
    _map = next;
    _loadedAt = Date.now();

    const after = _map.get(DEFAULT_SYMBOL);
    log("SYMBOL_INFO_LOADED", { count: _map.size,
      tickSize: after?.tickSize, stepSize: after?.stepSize });
    // 기본 심볼의 규칙이 바뀌면 주문 가격·수량이 통째로 달라진다 — 반드시 눈에 띄어야 한다
    if (before && !before.seeded &&
        (before.tickSize !== after?.tickSize || before.stepSize !== after?.stepSize)) {
      log("SYMBOL_FILTER_CHANGED", { level: "warn", symbol: DEFAULT_SYMBOL,
        from: { tickSize: before.tickSize, stepSize: before.stepSize },
        to:   { tickSize: after?.tickSize, stepSize: after?.stepSize } });
    }
    return true;
  } catch (e) {
    // 캐시는 그대로 둔다 — 낡은 규칙이라도 없는 것보다 낫다 (규칙은 거의 안 바뀐다)
    log("SYMBOL_INFO_LOAD_FAILED", { level: "warn", have: _map.size,
      seeded: _loadedAt === 0, err: errOf(e) });
    return false;
  }
}

function start() {
  if (_timer) return;
  if (isStale()) load();   // 서버 시작 때 이미 받았으면 두 번 부르지 않는다
  _timer = setInterval(load, REFRESH_MS);
  _timer.unref?.();   // 종료를 막지 않는다
}

function stop() { clearInterval(_timer); _timer = null; }

/**
 * 심볼의 거래 규칙. **모르면 던진다** — 기본값으로 떨어지지 않는다 (머리 주석 참고).
 */
function filtersOf(symbol = DEFAULT_SYMBOL) {
  const f = _map.get(symbol);
  if (!f) throw new Error(`심볼 규칙을 모릅니다 (${symbol}) — exchangeInfo를 아직 못 받았거나 없는 심볼입니다`);
  return f;
}

const has = (symbol) => _map.has(symbol);

/** 가격을 그 심볼의 호가 단위에 맞춘다 (문자열) */
const roundPrice = (price, symbol = DEFAULT_SYMBOL) =>
  roundToTick(price, filtersOf(symbol).tickSize);

/** 수량을 그 심볼의 최소 단위에 맞춘다 — **내림** (문자열) */
const roundQty = (qty, symbol = DEFAULT_SYMBOL) =>
  floorToStep(qty, filtersOf(symbol).stepSize);

/**
 * 화면 심볼 선택기가 쓸 목록 — **USDT 무기한 + 거래 중**인 것만.
 * 분기물(CURRENT_QUARTER)이나 거래 정지된 심볼을 고르게 두면 주문이 거절될 뿐이다.
 */
function listTradable() {
  return [..._map.values()]
    .filter(s => s.quoteAsset === "USDT" && s.contractType === "PERPETUAL" && s.status === "TRADING")
    .map(({ symbol, baseAsset, tickSize, stepSize, minQty, minNotional, onboardDate }) =>
      ({ symbol, baseAsset, tickSize, stepSize, minQty, minNotional, onboardDate }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

const isStale = () => _loadedAt === 0 || Date.now() - _loadedAt > REFRESH_MS * 2;

/**
 * 요청에서 심볼을 뽑는다 — body/query의 `symbol`, 없으면 기본 심볼.
 *
 * ⚠ **모르는 심볼이면 던진다.** 그냥 통과시키면 바이낸스가 `-1121 Invalid symbol`로
 *   거절하는데, 그 전에 이미 `roundPrice`가 기본 심볼 단위로 가격을 만들어 둔 뒤라
 *   "왜 거절됐는지"가 화면에 안 드러난다. 여기서 막고 이름을 말해 주는 편이 낫다.
 * ⚠ 대소문자를 맞춘다 — 바이낸스는 `btcusdt`를 안 받는다
 */
function fromRequest(req) {
  const raw = req?.body?.symbol ?? req?.query?.symbol;
  if (raw == null || raw === "") return DEFAULT_SYMBOL;
  const sym = String(raw).toUpperCase();
  if (!has(sym)) {
    const e = new Error(`알 수 없는 심볼입니다 (${sym})`);
    e.status = 400;
    throw e;
  }
  return sym;
}

module.exports = { DEFAULT_SYMBOL, load, start, stop, filtersOf, has, fromRequest,
  roundPrice, roundQty, listTradable, isStale };
