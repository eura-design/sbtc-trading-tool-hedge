// 라우트 테스트 하네스 — 거래소에 닿지 않고 라우터만 올린다
//
// ⚠ **`server.js`를 절대 require하지 않는다.** entry point를 부르면 진짜 서버가
//   뜨면서 실계좌 감시(UDS·watchAccount)까지 돈다. 여기서는 라우터 파일 하나만 올린다.
//
// 목은 `require.cache`에 미리 심는다 (CommonJS라 가능하다). 라우트가 모듈 최상단에서
// 구조분해로 가져가므로(`const { binance } = require(...)`) **require 전에** 심어야 한다.

const path = require("path");
const express = require("express");

const RESOLVE = (rel) => require.resolve(path.join(__dirname, "..", "..", rel));

// ⚠ **incomeLogger 목만 프로세스 내내 남긴다.** `close.js`가 청산 2.5초 뒤
//   `setTimeout`에서 지연 require를 하는데, 그때는 테스트가 이미 끝나 목을 걷어낸
//   뒤다 → 진짜 모듈이 올라와 **실제 서명을 시도한다**. 걷어내지 않는 것이 정답이다.
const INERT_INCOME = {
  logTradesFor: async () => {}, settleTrade: async () => {},
  start: () => {}, stop: () => {}, pollOnce: async () => {},
};

/** 거래소 호출 기록 한 벌 — 테스트가 이걸 보고 판정한다 */
function makeRecorder() {
  return {
    calls: [],            // { method, path, params } — binance() 호출
    cancels: [],          // cancelOrder() 인자
    alerts: [],           // pushAlert(level, msg)
    logs: [],             // log(event, fields)
    updates: [],          // pushUpdate(what)
    settles: [],          // incomeLogger.logTradesFor()
    verifies: [],         // orderWatcher.verifyImmediateFill()
    presetCancels: [],    // cancelPresetTPSL()
    kindChecks: [],       // assertCancelKind()
    placed: [],           // placeTPSL()
    storeWrites: [],      // store.set() 이력 (덮어쓰기 전 값도)
  };
}

/**
 * 라우터를 목과 함께 올리고, 요청을 보낼 수 있는 함수를 돌려준다.
 *
 * @param routeRel   `"routes/close.js"` 처럼 repo 기준 상대 경로
 * @param opts.symbols   심볼 규칙 표 `{ BTCUSDT: { stepSize, minQty, tickSize } }`
 * @param opts.binance   `(method, path, params) => ({ data })` — 던지면 그 에러가 그대로 간다
 * @param opts.store     pendingOrders 대역 (없으면 빈 Map 기반)
 */
async function mountRoute(routeRel, opts = {}) {
  const rec = makeRecorder();
  const symbols = opts.symbols ?? {
    BTCUSDT:  { stepSize: "0.001", minQty: "0.001", tickSize: "0.10",     minNotional: "50" },
    DOGEUSDT: { stepSize: "1",     minQty: "1",     tickSize: "0.000010", minNotional: "5"  },
  };
  const DEFAULT_SYMBOL = "BTCUSDT";

  // ── 목들 ────────────────────────────────────────────────────────────────
  const roundQty = (q, sym = DEFAULT_SYMBOL) => {
    const step = Number(symbols[sym]?.stepSize ?? 0.001);
    const units = Math.floor(Number(q) / step + 1e-9);
    const dec = (String(step).split(".")[1] || "").length;
    return (units * step).toFixed(dec);
  };
  const roundPrice = (p, sym = DEFAULT_SYMBOL) => {
    const tick = Number(symbols[sym]?.tickSize ?? 0.1);
    const dec = (String(tick).split(".")[1] || "").replace(/0+$/, "").length;
    return (Math.round(Number(p) / tick) * tick).toFixed(dec);
  };

  const mockBinance = async (method, p, params) => {
    rec.calls.push({ method, path: p, params });
    if (opts.binance) return opts.binance(method, p, params);
    return { data: [] };
  };

  const mocks = {
    "services/binanceClient.js": {
      binance: mockBinance,
      cancelOrder: async (args) => { rec.cancels.push(args); return { data: {} }; },
      roundQty, roundPrice,
      placeTPSL: async (info, sym) => {
        rec.placed.push({ info, symbol: sym });
        return opts.placeTPSL
          ? await opts.placeTPSL(info, sym)
          : { tp: { orderId: "TP1", orderType: "TAKE_PROFIT_MARKET" },
              sl: { orderId: "SL1", orderType: "STOP_MARKET" }, failed: [] };
      },
      preplaceTPSL: async () => ({ tp: null, sl: null, failed: [] }),
      cancelPresetTPSL: async (preset, sym) => { rec.presetCancels.push({ preset, symbol: sym }); },
      // 취소 대상이 기대한 종류인지 확인하고 못 찾으면 조용히 넘어간다(진짜와 같다).
      // `opts.assertCancelKind`로 "엉뚱한 종류라 거절"을 흉내낼 수 있다
      assertCancelKind: async (orderId, kind, sym) => {
        rec.kindChecks.push({ orderId: String(orderId), kind, symbol: sym });
        return opts.assertCancelKind ? opts.assertCancelKind(orderId, kind, sym) : undefined;
      },
      checkExistingTPSL: async () => ({ ok: true, hasTp: false, hasSl: false }),
      syncServerTime: async () => {},
      loadMaintRates: async () => {},
    },
    "services/symbolInfo.js": {
      DEFAULT_SYMBOL,
      filtersOf: (s) => {
        const f = symbols[s];
        if (!f) { const e = new Error(`알 수 없는 심볼: ${s}`); e.status = 400; throw e; }
        return f;
      },
      fromRequest: (req) => {
        const s = req.body?.symbol ?? req.query?.symbol ?? DEFAULT_SYMBOL;
        if (!symbols[s]) { const e = new Error(`알 수 없는 심볼: ${s}`); e.status = 400; throw e; }
        return s;
      },
      roundQty, roundPrice,
      listTradable: () => Object.keys(symbols),
      load: async () => {}, start: () => {}, isStale: () => false,
      maintRateOf: () => 0.004, setMaintRates: () => {},
    },
    "services/pushService.js": {
      pushAlert: (level, msg) => rec.alerts.push({ level, msg }),
      pushAlertClear: (msg) => rec.alerts.push({ level: "clear", msg }),
      pushUpdate: (what) => rec.updates.push(what),
      broadcast: () => {},
    },
    // ⚠ close.js가 청산 직후 지연 require로 부른다 (`require("../services/incomeLogger")`).
    //   안 막으면 진짜 서명을 시도해 `TRADE_SETTLE_FAILED` 경고가 뜬다 — 실패해도
    //   테스트는 통과하지만, **거래소에 닿으려 한 흔적**이라 막는 게 맞다
    "services/incomeLogger.js": {
      ...INERT_INCOME,
      logTradesFor: async (...a) => { rec.settles.push(a); },
    },
    // 일일 손실 가드 — 기본은 통과. `opts.dailyLoss`가 던지면 그 에러가 그대로 간다
    // (실제 checkDailyLoss는 한도 초과 시 status 403을 실어 던진다)
    "routes/dailyloss.js": Object.assign(
      require("express").Router(),
      { checkDailyLoss: async () => { if (opts.dailyLoss) await opts.dailyLoss(); } },
    ),
    "services/orderWatcher.js": {
      verifyImmediateFill: (...a) => { rec.verifies.push(a); },
      start: () => {}, stop: () => {}, watchAccount: async () => {},
      reconcileWithBinance: async () => {}, accountStatus: () => ({}),
      udsStatus: () => ({}),
    },
    "store/logStore.js": {
      log: (event, fields) => rec.logs.push({ event, ...fields }),
      errOf: (e) => ({ msg: String(e?.message ?? e) }),
      close: async () => {},
    },
  };

  // store는 진짜 구현 대신 Map 하나 — 파일에 쓰지 않는다
  const map = new Map(Object.entries(opts.store ?? {}));
  mocks["store/pendingOrders.js"] = {
    get: (id) => map.get(String(id)),
    set: (id, info) => {
      const entry = { symbol: DEFAULT_SYMBOL, ...info };
      // 덮어쓰기 전 이력도 남긴다 — 한 요청 안에서 여러 번 쓰는 경로가 있어서
      // **중간에 무엇을 적었는지**를 봐야 할 때가 있다 (onFilled가 그렇다)
      rec.storeWrites.push({ id: String(id), info: entry });
      map.set(String(id), entry);
    },
    delete: (id) => map.delete(String(id)),
    entries: () => [...map.entries()],
    all: () => Object.fromEntries(map),
    symbolOf: (id) => map.get(String(id))?.symbol ?? DEFAULT_SYMBOL,
    flush: async () => {},
    size: () => map.size,
  };

  // ── require.cache에 심는다 ───────────────────────────────────────────────
  const injected = [];
  let incomeId = null;
  try { incomeId = RESOLVE("services/incomeLogger.js"); } catch { /* 없으면 그만 */ }
  for (const [rel, exportsObj] of Object.entries(mocks)) {
    let id;
    try { id = RESOLVE(rel); } catch { continue; }
    require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj, children: [], paths: [] };
    injected.push(id);
  }

  // 라우트는 캐시를 지우고 새로 읽는다 (앞선 테스트가 남긴 것을 쓰지 않게)
  let routeId = null, router = express.Router();
  if (routeRel !== "__none__") {
    routeId = RESOLVE(routeRel);
    delete require.cache[routeId];
    router = require(routeId);
  }

  const app = express();
  app.use(express.json());
  app.use("/", router);
  // 라우트가 `err.status`를 실어 던지면 그대로 내보낸다 (실서버와 같은 규칙)
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;

  const request = async (method, p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* 본문 없음 */ }
    return { status: res.status, body: json };
  };

  const close = () => new Promise((r) => {
    // ⚠ `fetch`가 keep-alive를 쓴다 — 연결을 끊지 않으면 `server.close()`가
    //   영영 안 끝나서 테스트가 통째로 멈춘다
    server.closeAllConnections?.();
    server.close(r);
    for (const id of injected) {
      // incomeLogger만 남긴다 (위 INERT_INCOME 주석) — 다음 mount가 덮어쓴다
      if (id === incomeId) { require.cache[id].exports = INERT_INCOME; continue; }
      delete require.cache[id];
    }
    if (routeId) delete require.cache[routeId];
  });

  return { request, rec, close, store: map, mocks };
}

/**
 * 라우터가 아니라 **서비스 모듈**을 목과 함께 올린다 (`orderWatcher` 등).
 * `mountRoute`와 같은 목을 쓰되 express를 끼지 않는다.
 *
 * ⚠ 여기서도 `server.js`는 부르지 않는다. WebSocket은 `startUserDataStream`을
 *   부르지 않는 한 안 열린다 — 테스트는 그걸 부르지 않는다
 */
async function loadService(rel, opts = {}) {
  const h = await mountRoute("__none__", opts);   // 목만 심는다 (라우터는 없음)
  const id = RESOLVE(rel);
  delete require.cache[id];
  const mod = require(id);
  const close = async () => { delete require.cache[id]; await h.close(); };
  return { mod, rec: h.rec, store: h.store, close };
}

module.exports = { mountRoute, loadService };
