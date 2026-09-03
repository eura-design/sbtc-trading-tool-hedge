// recoveryService — 서버를 다시 켤 때 도는 안전망
//
// ⚠ **서버가 꺼져 있던 사이에 벌어진 일을 수습하는 자리다.** 지정가가 체결됐는데
//   손절을 못 걸었을 수 있고, 포지션이 무방비로 남아 있을 수 있다.
//   어느 기록을 고를지(`recoverMatch`)는 14개로 덮여 있었지만,
//   **그 기록으로 실제로 손절을 거는 부분**은 한 줄도 안 덮여 있었다.
//
// 이 파일이 보는 것:
//   · 무방비 포지션에 손절을 **대신 걸어 주는가**
//   · **사용자가 일부러 지운 손절**은 되돌리지 않는가 (2026-09-04)
//   · **모든 코인**을 보는가, 그리고 코인끼리 **섞이지 않는가** (2026-09-04)
//   · 이미 TP/SL이 있으면 **손대지 않는가**

const test   = require("node:test");
const assert = require("node:assert/strict");
const { loadService } = require("./helpers/routeHarness");

// ── 거래소 대역 ────────────────────────────────────────────────────────────
/** @param positions `/fapi/v3/positionRisk` (심볼 없이 = 열린 것만) */
const exchange = ({ open = [], positions = [], orders = {} } = {}) =>
  async (method, p, params) => {
    if (p === "/fapi/v3/positionRisk") return { data: positions };
    if (p === "/fapi/v2/positionRisk")
      return { data: positions.filter(x => x.symbol === params?.symbol) };
    if (p.includes("openOrders"))     return { data: open };
    if (p.includes("openAlgoOrders")) return { data: [] };
    if (p === "/fapi/v1/order")       return { data: orders[String(params?.orderId)] ?? { status: "NEW" } };
    return { data: [] };
  };

const pos = (symbol, posSide, amt, entry) => ({
  symbol, positionSide: posSide,
  positionAmt: String(posSide === "SHORT" ? -amt : amt),
  entryPrice: String(entry),
});

/** 체결까지 끝난 진입 기록 (복구가 고를 수 있는 모양) */
const filledRec = (over = {}) => ({
  status: "TPSL_PLACED", side: "BUY", closeSide: "SELL",
  tp: 80000, sl: 65000, qty: "0.01", symbol: "BTCUSDT",
  fillPrice: 70000, filledAt: Date.now(), createdAt: Date.now(), ...over,
});

const run = async (opts) => {
  const h = await loadService("services/recoveryService.js", opts);
  await h.mod.recoverPendingOrders();
  const evt = (name) => h.rec.logs.filter(l => l.event === name);
  await h.close();
  return { rec: h.rec, evt, store: h.store };
};

// ── 무방비 포지션에 손절을 대신 걸어 준다 ─────────────────────────────────
test("손절이 없는 포지션에 기록을 보고 **대신 걸어 준다**", async () => {
  const r = await run({
    binance: exchange({ positions: [pos("BTCUSDT", "LONG", 0.01, 70000)] }),
    store: { "E1": filledRec() },
  });
  assert.equal(r.rec.placed.length, 1, "무방비인데 손절을 안 걸었다");
  assert.equal(r.rec.placed[0].info.sl, 65000);
  assert.ok(r.evt("NAKED_POSITION").length, "무방비를 안 남겼다");
  assert.ok(r.evt("NAKED_RECOVERED").length, "복구를 안 남겼다");
});

test("TP·SL이 **둘 다** 있으면 손대지 않는다", async () => {
  const r = await run({
    binance: exchange({ positions: [pos("BTCUSDT", "LONG", 0.01, 70000)] }),
    checkExistingTPSL: async () => ({ hasTP: true, hasSL: true, ok: true }),
    store: { "E1": filledRec() },
  });
  assert.equal(r.rec.placed.length, 0, "멀쩡한 포지션을 건드렸다");
  assert.equal(r.evt("NAKED_POSITION").length, 0);
});

test("한쪽만 있어도 복구 대상이다 (익절만 있고 손절이 없는 상태)", async () => {
  const r = await run({
    binance: exchange({ positions: [pos("BTCUSDT", "LONG", 0.01, 70000)] }),
    checkExistingTPSL: async () => ({ hasTP: true, hasSL: false, ok: true }),
    store: { "E1": filledRec() },
  });
  assert.equal(r.rec.placed.length, 1, "손절이 없는데 넘어갔다");
});

test("포지션이 없으면 아무것도 걸지 않는다", async () => {
  const r = await run({
    binance: exchange({ positions: [] }),
    store: { "E1": filledRec() },
  });
  assert.equal(r.rec.placed.length, 0);
});

// ── 사용자가 일부러 지운 손절은 되돌리지 않는다 (2026-09-04) ───────────────
test("**일부러 지운 손절은 되돌리지 않는다**", async () => {
  // ⚠ 진입은 손절이 필수라, 손절 없이 들고 가려면 걸린 뒤 지우는 것이 유일한 길이다.
  //   기록에는 `sl`이 남아 있어서, 이걸 안 막으면 재시작이 말없이 되돌린다
  const r = await run({
    binance: exchange({ positions: [pos("BTCUSDT", "LONG", 0.01, 70000)] }),
    store: { "E1": filledRec({ slRemovedAt: Date.now() }) },
  });
  assert.equal(r.rec.placed.length, 0, "사용자가 지운 손절을 되돌렸다");
  assert.ok(r.evt("NAKED_NO_CANDIDATE").length, "후보 없음을 안 남겼다");
});

test("표시가 거둬지면(손절을 다시 걸었으면) 복구가 다시 동작한다", async () => {
  const r = await run({
    binance: exchange({ positions: [pos("BTCUSDT", "LONG", 0.01, 70000)] }),
    store: { "E1": filledRec({ slRemovedAt: undefined, sl: 68000 }) },
  });
  assert.equal(r.rec.placed.length, 1);
  assert.equal(r.rec.placed[0].info.sl, 68000, "옛 가격을 걸었다 — 기록 갱신이 안 따라왔다");
});

// ── 모든 코인 (2026-09-04) ─────────────────────────────────────────────────
test("**기본 심볼이 아닌 코인**도 복구한다", async () => {
  // ⚠ 예전엔 BTCUSDT만 봤다. 다른 코인은 경보만 뜨고 손절은 안 걸렸다
  const r = await run({
    binance: exchange({ positions: [pos("DOGEUSDT", "LONG", 100, 0.08)] }),
    store: { "D1": filledRec({ symbol: "DOGEUSDT", fillPrice: 0.08, tp: 0.09, sl: 0.07 }) },
  });
  assert.equal(r.rec.placed.length, 1, "다른 코인을 그냥 지나쳤다");
  assert.equal(r.rec.placed[0].info.symbol, "DOGEUSDT");
  assert.equal(r.rec.placed[0].info.sl, 0.07);
});

test("여러 코인이 무방비면 **각각** 자기 기록으로 복구한다", async () => {
  const r = await run({
    binance: exchange({ positions: [
      pos("BTCUSDT",  "LONG", 0.01, 70000),
      pos("DOGEUSDT", "LONG", 100,  0.08),
    ] }),
    store: {
      "B1": filledRec(),
      "D1": filledRec({ symbol: "DOGEUSDT", fillPrice: 0.08, tp: 0.09, sl: 0.07 }),
    },
  });
  assert.equal(r.rec.placed.length, 2, "하나만 복구했다");
  const bySymbol = Object.fromEntries(r.rec.placed.map(p => [p.info.symbol, p.info.sl]));
  assert.equal(bySymbol.BTCUSDT,  65000);
  assert.equal(bySymbol.DOGEUSDT, 0.07);
});

test("코인끼리 **섞이지 않는다** — 다른 코인의 기록을 갖다 쓰지 않는다", async () => {
  // ⚠ 섞이면 DOGE 포지션에 65,000짜리 손절이 걸린다
  const r = await run({
    binance: exchange({ positions: [pos("DOGEUSDT", "LONG", 100, 0.08)] }),
    store: { "B1": filledRec() },          // BTC 기록만 있다
  });
  assert.equal(r.rec.placed.length, 0, "BTC 기록을 DOGE에 갖다 썼다");
  assert.ok(r.evt("NAKED_NO_CANDIDATE").length);
});

test("사이드가 다르면 갖다 쓰지 않는다", async () => {
  const r = await run({
    binance: exchange({ positions: [pos("BTCUSDT", "SHORT", 0.01, 70000)] }),
    store: { "E1": filledRec() },          // 롱 진입(BUY) 기록
  });
  assert.equal(r.rec.placed.length, 0, "롱 기록을 숏에 갖다 썼다");
});

test("진입가가 한참 다르면 갖다 쓰지 않는다 (±2%)", async () => {
  const r = await run({
    // 기록의 체결가는 70,000인데 지금 포지션은 90,000에 잡혀 있다 → 다른 포지션이다
    binance: exchange({ positions: [pos("BTCUSDT", "LONG", 0.01, 90000)] }),
    store: { "E1": filledRec() },
  });
  assert.equal(r.rec.placed.length, 0, "엉뚱한 기록으로 손절을 걸었다");
});

// ── 기록 하나로 두 포지션을 복구하지 않는다 ────────────────────────────────
test("한 기록을 두 번 쓰지 않는다", async () => {
  const r = await run({
    binance: exchange({ positions: [
      pos("BTCUSDT", "LONG",  0.01, 70000),
      pos("BTCUSDT", "SHORT", 0.01, 70000),
    ] }),
    store: {
      "L1": filledRec(),
      "S1": filledRec({ side: "SELL", closeSide: "BUY", tp: 60000, sl: 75000 }),
    },
  });
  assert.equal(r.rec.placed.length, 2);
  const ids = r.rec.placed.map(p => p.info.sl).sort();
  assert.deepEqual(ids, [65000, 75000], "같은 기록을 두 번 썼다");
});

// ── 실시간 연결 ────────────────────────────────────────────────────────────
test("복구가 끝나면 실시간 연결을 연다", async () => {
  const r = await run({ binance: exchange({}) });
  assert.equal(r.rec.udsStarts, 1, "체결 감지 연결을 안 열었다");
});

test("거래소 조회가 통째로 실패해도 터지지 않는다", async () => {
  const r = await run({ binance: async () => { throw new Error("ENOTFOUND"); } });
  assert.ok(r.evt("RECOVERY_FAILED").length, "실패를 안 남겼다");
  assert.equal(r.rec.placed.length, 0);
});
