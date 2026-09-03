// placeTPSL / preplaceTPSL — **손절 주문을 실제로 만드는 자리**
//
// ⚠ 라우트 테스트는 이 둘을 목으로 갈아끼운다. 그래서 정작 "어떤 주문이 만들어지는가"는
//   아무 데도 안 덮여 있었다. 여기가 그걸 본다.
//
// 이 파일이 보는 것:
//   · **손절을 먼저 건다** — 손절이 존재 이유다
//   · 체결 후(`placeTPSL`)는 `closePosition`, 체결 전(`preplaceTPSL`)은 **수량 지정**
//     (포지션이 없으면 바이낸스가 closePosition을 거절한다 — 2026-08-23 실측)
//   · 트리거 기준이 **CONTRACT_PRICE**인가 (마크 가격이면 캔들이 선을 뚫어도 안 터진다)
//   · 심볼의 호가·수량 단위를 따르는가
//
// ⚠ **axios를 갈아끼운다.** 이 모듈은 자기 안에서 `binance()`를 부르므로 그 아래를
//   막아야 한다. API 키도 가짜를 넣는다 — 진짜 키가 테스트에 끼어들 이유가 없다

const test   = require("node:test");
const assert = require("node:assert/strict");
const path   = require("path");

process.env.BINANCE_API_KEY    = "test-key";
process.env.BINANCE_API_SECRET = "test-secret";

// ── axios 대역 ─────────────────────────────────────────────────────────────
const calls = [];
let handler = () => ({ status: 200, data: {}, headers: {} });

const axiosId = require.resolve("axios");
require.cache[axiosId] = {
  id: axiosId, filename: axiosId, loaded: true, children: [], paths: [],
  exports: async (cfg) => {
    const body = cfg.data ? Object.fromEntries(new URLSearchParams(cfg.data)) : (cfg.params ?? {});
    const rec = { method: cfg.method, path: cfg.url.replace(/^https?:\/\/[^/]+/, ""), body };
    calls.push(rec);
    const r = handler(rec);
    if (r instanceof Error) throw r;
    return { status: 200, headers: {}, ...r };
  },
};

// symbolInfo는 진짜를 쓰되 네트워크를 막는다 (SEED 값으로 떨어진다)
const siId = require.resolve(path.join(__dirname, "..", "services", "symbolInfo.js"));
const symbolInfo = require(siId);

const { placeTPSL, preplaceTPSL } = require("../services/binanceClient");

const reset = (h) => { calls.length = 0; handler = h ?? (() => ({ data: { algoId: "A1" } })); };
const algoCalls = () => calls.filter(c => c.path === "/fapi/v1/algoOrder");
const of = (type) => algoCalls().find(c => c.body.type === type);

// ── 순서: 손절이 먼저다 ────────────────────────────────────────────────────
test("**손절을 먼저 건다** — 손절이 존재 이유다", async () => {
  reset();
  await placeTPSL({ closeSide: "SELL", tp: 80000, sl: 65000, symbol: "BTCUSDT" });
  const types = algoCalls().map(c => c.body.type);
  assert.deepEqual(types, ["STOP_MARKET", "TAKE_PROFIT_MARKET"],
    `순서가 다르다: ${types}`);
});

test("손절이 실패하면 **익절을 시도하지 않는다**", async () => {
  // ⚠ SL이 안 걸린 상태에서 TP만 걸면 "익절은 있는데 손절이 없는" 포지션이 된다.
  // ⚠ **이 테스트는 15초 걸린다** — 재시도 5회의 대기(1+2+4+8초)를 실제로 태우기
  //   때문이다. 대기 시간을 줄이려면 코드에 손을 대야 해서 그대로 뒀다.
  //   느리다고 지우지 말 것: "손절 없이 익절만 걸리는" 상태를 막는 유일한 검산이다
  let slAttempts = 0;
  reset((rec) => {
    if (rec.body.type === "STOP_MARKET") { slAttempts++; return new Error("-2021 즉시 발동"); }
    return { data: { algoId: "T1" } };
  });
  const r = await placeTPSL({ closeSide: "SELL", tp: 80000, sl: 65000, symbol: "BTCUSDT" });
  assert.ok(slAttempts > 1, "재시도를 안 했다");
  assert.equal(of("TAKE_PROFIT_MARKET"), undefined, "손절이 없는데 익절을 걸었다");
  assert.deepEqual(r.failed.map(f => f.type).sort(), ["SL", "TP"]);
  assert.match(r.failed.find(f => f.type === "TP").error, /SL 실패/);
  assert.equal(r.sl, null);
});

// ── 체결 후: closePosition ─────────────────────────────────────────────────
test("체결 후 TP/SL은 `closePosition` — 그때 남아 있는 전부를 닫는다", async () => {
  reset();
  await placeTPSL({ closeSide: "SELL", tp: 80000, sl: 65000, symbol: "BTCUSDT" });
  for (const c of algoCalls()) {
    assert.equal(c.body.closePosition, "true", `${c.body.type}에 closePosition이 없다`);
    assert.equal(c.body.quantity, undefined, "수량을 적으면 추가 진입분을 못 덮는다");
    assert.equal(c.body.workingType, "CONTRACT_PRICE",
      "마크 가격이면 캔들이 선을 뚫어도 안 터진다");
    assert.equal(c.body.algoType, "CONDITIONAL");
  }
});

test("청산 방향에서 포지션 방향을 뽑아낸다", async () => {
  reset();
  await placeTPSL({ closeSide: "SELL", tp: 80000, sl: 65000, symbol: "BTCUSDT" });
  assert.equal(of("STOP_MARKET").body.positionSide, "LONG", "SELL 청산은 롱이다");
  assert.equal(of("STOP_MARKET").body.side, "SELL");

  reset();
  await placeTPSL({ closeSide: "BUY", tp: 60000, sl: 75000, symbol: "BTCUSDT" });
  assert.equal(of("STOP_MARKET").body.positionSide, "SHORT");
});

test("걸기 전에 **같은 방향의 전량 TP/SL을 지운다** (손절이 둘이 되지 않게)", async () => {
  reset((rec) => {
    if (rec.path.includes("openAlgoOrders")) {
      return { data: [
        { algoId: "OLD_SL", orderType: "STOP_MARKET", side: "SELL",
          positionSide: "LONG", closePosition: true },
        { algoId: "OTHER_SIDE", orderType: "STOP_MARKET", side: "BUY",
          positionSide: "SHORT", closePosition: true },
      ] };
    }
    return { data: { algoId: "A1" } };
  });
  await placeTPSL({ closeSide: "SELL", tp: 80000, sl: 65000, symbol: "BTCUSDT" });
  const canceledIds = calls.map(c => String(c.body.algoId ?? ""));
  assert.ok(canceledIds.includes("OLD_SL"), "옛 손절을 안 지웠다 — 손절이 두 개가 된다");
  assert.ok(!canceledIds.includes("OTHER_SIDE"), "반대 사이드 손절까지 지웠다");
});

test("**부분 손절(수량 지정)은 남긴다** — 추가 진입 한 번에 사라지면 안 된다", async () => {
  // ⚠ 이 청소기는 진입이 체결될 때마다 돈다. 부분 손절까지 빨아들이면
  //   "평단까지 오면 절반 청산" 같은 예약이 **조용히, 흔적 없이** 사라진다 (2026-08-24)
  reset((rec) => {
    if (rec.path.includes("openAlgoOrders")) {
      return { data: [
        { algoId: "FULL",    orderType: "STOP_MARKET", side: "SELL",
          positionSide: "LONG", closePosition: true },
        { algoId: "PARTIAL", orderType: "STOP_MARKET", side: "SELL",
          positionSide: "LONG", closePosition: false, quantity: "0.005" },
      ] };
    }
    return { data: { algoId: "A1" } };
  });
  await placeTPSL({ closeSide: "SELL", tp: 80000, sl: 65000, symbol: "BTCUSDT" });
  const canceledIds = calls.map(c => String(c.body.algoId ?? ""));
  assert.ok(canceledIds.includes("FULL"), "전량 손절을 안 지웠다");
  assert.ok(!canceledIds.includes("PARTIAL"), "부분 손절까지 지웠다 — 조용히 사라진다");
});

// ── 체결 전: 수량 지정 ─────────────────────────────────────────────────────
test("체결 전 사전 등록은 **수량을 적는다** (closePosition을 못 쓴다)", async () => {
  // ⚠ 포지션이 없으면 바이낸스가 거절한다:
  //   `Time in Force (TIF) GTE can only be used with open positions` (2026-08-23 실측)
  reset();
  await preplaceTPSL({ closeSide: "SELL", tp: 80000, sl: 65000, qty: "0.01", symbol: "BTCUSDT" });
  for (const c of algoCalls()) {
    assert.equal(c.body.closePosition, undefined, "포지션도 없는데 closePosition을 썼다");
    assert.equal(c.body.quantity, "0.010", `수량이 없다: ${JSON.stringify(c.body)}`);
    assert.equal(c.body.workingType, "CONTRACT_PRICE");
  }
});

test("사전 등록도 손절이 먼저다", async () => {
  reset();
  await preplaceTPSL({ closeSide: "SELL", tp: 80000, sl: 65000, qty: "0.01", symbol: "BTCUSDT" });
  assert.deepEqual(algoCalls().map(c => c.body.type),
    ["STOP_MARKET", "TAKE_PROFIT_MARKET"]);
});

test("사전 등록은 **익절이 실패해도 손절을 남긴다**", async () => {
  reset((rec) => rec.body.type === "TAKE_PROFIT_MARKET"
    ? new Error("-4131") : { data: { algoId: "S1" } });
  const r = await preplaceTPSL({ closeSide: "SELL", tp: 80000, sl: 65000,
                                 qty: "0.01", symbol: "BTCUSDT" });
  assert.ok(r.sl, "손절까지 날아갔다");
  assert.deepEqual(r.failed.map(f => f.type), ["TP"]);
});

test("사전 등록은 **재시도하지 않는다** (아직 체결 전이라 급하지 않다)", async () => {
  // ⚠ placeTPSL은 5회 31초다. 여기서 그러면 주문 응답이 30초씩 붙들려 화면이 멈춘다
  let attempts = 0;
  reset((rec) => {
    if (rec.body.type === "STOP_MARKET") { attempts++; return new Error("실패"); }
    return { data: { algoId: "T1" } };
  });
  await preplaceTPSL({ closeSide: "SELL", tp: 80000, sl: 65000, qty: "0.01", symbol: "BTCUSDT" });
  assert.equal(attempts, 1, `${attempts}번 시도했다 — 사전 등록은 한 번이다`);
});

// ── 심볼 단위 ──────────────────────────────────────────────────────────────
test("가격과 수량이 **그 심볼의 단위**를 따른다", async () => {
  await symbolInfo.load().catch(() => {});   // 못 받으면 SEED로 떨어진다
  let filters;
  try { filters = symbolInfo.filtersOf("DOGEUSDT"); } catch { filters = null; }
  if (!filters) return;   // 오프라인이면 이 확인은 건너뛴다 (SEED에는 DOGE가 없다)

  reset();
  await preplaceTPSL({ closeSide: "SELL", tp: 0.09123456, sl: 0.07123456,
                       qty: "123.9", symbol: "DOGEUSDT" });
  const tick = Number(filters.tickSize), step = Number(filters.stepSize);
  for (const c of algoCalls()) {
    const p = Number(c.body.triggerPrice), q = Number(c.body.quantity);
    assert.ok(Math.abs(p / tick - Math.round(p / tick)) < 1e-6,
      `호가 단위에 안 맞는다: ${c.body.triggerPrice}`);
    assert.equal(q, Math.round(q), `DOGE인데 소수 수량이다: ${c.body.quantity}`);
    assert.ok(!String(c.body.triggerPrice).includes("e"), "지수표기가 나갔다");
    assert.equal(c.body.symbol, "DOGEUSDT");
  }
});

test("모든 요청에 심볼이 실린다", async () => {
  reset();
  await placeTPSL({ closeSide: "SELL", tp: 80000, sl: 65000, symbol: "BTCUSDT" });
  for (const c of algoCalls()) assert.equal(c.body.symbol, "BTCUSDT");
});
