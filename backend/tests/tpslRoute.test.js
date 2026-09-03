// /api/tpsl — 조회 · 등록 · 취소 (단일 TP/SL · 분할 TP · 분할 SL)
//
// ⚠ **여기가 틀리면 차트 손절선이 엉뚱한 가격에 그려지고, 그 선을 끌면
//   부분 손절이 조용히 지워진다.** 조회의 분류가 곧 화면이다.
//
// 이 파일이 보는 것:
//   · 전량 손절과 **부분 손절을 갈라 담는가** (섞이면 순서에 따라 다른 게 잡힌다)
//   · 사전 등록분(체결 전 진입 주문에 딸린 TP/SL)을 **감추는가**
//   · 바이낸스 앱에서 건 **지정가형**(STOP/TAKE_PROFIT)도 찾는가
//   · 취소가 **종류를 확인하고** 지우는가 (전량 손절을 분할 SL 경로로 못 지운다)
//   · 이미 걸린 주문은 **그 주문의 심볼**로 취소하는가 (화면 심볼이 아니라)

const test   = require("node:test");
const assert = require("node:assert/strict");
const { mountRoute } = require("./helpers/routeHarness");

const feed = ({ open = [], algo = [] } = {}) => async (method, p) => {
  if (p.includes("openOrders"))     return { data: open };
  if (p.includes("openAlgoOrders")) return { data: algo };
  if (p === "/fapi/v1/order")       return { data: { orderId: "NEW_LIMIT", type: "LIMIT" } };
  if (p === "/fapi/v1/algoOrder")   return { data: { algoId: "NEW_ALGO", orderType: "STOP_MARKET" } };
  return { data: [] };
};

/** 전량 손절 (closePosition:true — 수량이 없다) */
const fullSl = (id, posSide, stop) => ({
  orderId: id, type: "STOP_MARKET", status: "NEW",
  side: posSide === "LONG" ? "SELL" : "BUY", positionSide: posSide,
  stopPrice: String(stop), closePosition: true, origQty: "0",
});
/** 부분 손절 (수량 지정) */
const partSl = (id, posSide, stop, qty) => ({
  orderId: id, type: "STOP_MARKET", status: "NEW",
  side: posSide === "LONG" ? "SELL" : "BUY", positionSide: posSide,
  stopPrice: String(stop), closePosition: false, origQty: String(qty),
});
const splitTp = (id, posSide, price, qty) => ({
  orderId: id, type: "LIMIT", status: "NEW",
  side: posSide === "LONG" ? "SELL" : "BUY", positionSide: posSide,
  price: String(price), origQty: String(qty), reduceOnly: true,
});

// ── 조회: 전량과 부분을 가른다 ─────────────────────────────────────────────
test("전량 손절과 부분 손절이 **섞이지 않는다**", async () => {
  // ⚠ 예전엔 종류만 맞으면 먼저 나온 것을 집었다 — 어느 게 잡힐지 바이낸스가
  //   주는 순서에 달렸고, 그 선을 끌면 부분 손절이 조용히 지워졌다
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed({ open: [
      partSl("PART", "LONG", 68000, 0.05),   // 일부러 **먼저** 둔다
      fullSl("FULL", "LONG", 65000),
    ] }),
  });
  const r = await h.request("GET", "/");
  assert.equal(r.status, 200);
  assert.equal(r.body.long.sl.orderId, "FULL", "부분 손절이 전량 손절 자리에 잡혔다");
  assert.equal(r.body.long.sl.price, 65000);
  assert.deepEqual(r.body.long.partialSls.map(o => o.orderId), ["PART"]);
  await h.close();
});

test("부분 손절만 있으면 전량 손절 자리는 비어 있다", async () => {
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed({ open: [partSl("PART", "LONG", 68000, 0.05)] }),
  });
  const r = await h.request("GET", "/");
  assert.equal(r.body.long.sl, null, "부분 손절을 전량으로 읽었다");
  assert.equal(r.body.long.partialSls.length, 1);
  await h.close();
});

test("바이낸스 앱에서 건 **지정가형** TP/SL도 찾는다", async () => {
  // ⚠ 못 찾으면 화면에 손절이 없는 것처럼 보이고, reconcile이 무방비로 오인해 경보를 띄운다
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed({ open: [
      { orderId: "S", type: "STOP", status: "NEW", side: "SELL", positionSide: "LONG",
        stopPrice: "65000", price: "64900", closePosition: true, origQty: "0" },
      { orderId: "T", type: "TAKE_PROFIT", status: "NEW", side: "SELL", positionSide: "LONG",
        stopPrice: "90000", price: "90100", closePosition: true, origQty: "0" },
    ] }),
  });
  const r = await h.request("GET", "/");
  assert.equal(r.body.long.sl?.orderId, "S", "지정가형 손절을 못 찾았다");
  assert.equal(r.body.long.tp?.orderId, "T", "지정가형 익절을 못 찾았다");
  await h.close();
});

test("체결 전 진입 주문의 사전 TP/SL은 **감춘다** (플랜 박스가 이미 보여준다)", async () => {
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed({ open: [fullSl("PRESET_SL", "LONG", 65000)] }),
    store: { "999": { status: "WATCHING", symbol: "BTCUSDT",
                      presetTpsl: { sl: { orderId: "PRESET_SL" }, tp: null } } },
  });
  const r = await h.request("GET", "/");
  assert.equal(r.body.long.sl, null, "사전 등록분이 화면에 두 번 뜬다");
  await h.close();
});

test("체결되면(WATCHING을 벗으면) 그때부터 보인다", async () => {
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed({ open: [fullSl("PRESET_SL", "LONG", 65000)] }),
    store: { "999": { status: "FILLED", symbol: "BTCUSDT",
                      presetTpsl: { sl: { orderId: "PRESET_SL" }, tp: null } } },
  });
  const r = await h.request("GET", "/");
  assert.equal(r.body.long.sl?.orderId, "PRESET_SL");
  await h.close();
});

test("분할 TP는 **청산 방향으로** 롱·숏에 나눠 담는다", async () => {
  // SELL = 롱 청산 / BUY = 숏 청산
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed({ open: [
      splitTp("L1", "LONG",  85000, 0.02),
      splitTp("L2", "LONG",  90000, 0.02),
      splitTp("S1", "SHORT", 60000, 0.02),
    ] }),
  });
  const r = await h.request("GET", "/");
  assert.deepEqual(r.body.long.splitTps.map(o => o.orderId).sort(),  ["L1", "L2"]);
  assert.deepEqual(r.body.short.splitTps.map(o => o.orderId), ["S1"]);
  await h.close();
});

test("한쪽 조회가 실패해도 나머지는 돌려준다 (allSettled)", async () => {
  const h = await mountRoute("routes/tpsl.js", {
    binance: async (method, p) => {
      if (p.includes("openAlgoOrders")) throw new Error("ECONNRESET");
      if (p.includes("openOrders")) return { data: [fullSl("FULL", "LONG", 65000)] };
      return { data: [] };
    },
  });
  const r = await h.request("GET", "/");
  assert.equal(r.status, 200, "한쪽 실패로 통째로 죽었다");
  assert.equal(r.body.long.sl?.orderId, "FULL");
  await h.close();
});

// ── 등록 ───────────────────────────────────────────────────────────────────
test("분할 TP 등록 — 필수값이 없으면 400, 거래소를 안 부른다", async () => {
  const h = await mountRoute("routes/tpsl.js", { binance: feed() });
  for (const b of [{}, { side: "LONG" }, { side: "LONG", price: 90000 }]) {
    const r = await h.request("POST", "/split", b);
    assert.equal(r.status, 400, JSON.stringify(b));
  }
  assert.equal(h.rec.calls.length, 0);
  await h.close();
});

test("분할 TP 등록 — 포지션 방향을 **청산 방향**으로 바꿔 보낸다", async () => {
  const h = await mountRoute("routes/tpsl.js", { binance: feed() });
  await h.request("POST", "/split", { side: "LONG", price: 90000, qty: "0.02", pct: 50 });
  const [c] = h.rec.calls.filter(c => c.path === "/fapi/v1/order");
  assert.equal(c.params.side, "SELL", "롱 청산인데 SELL이 아니다");
  assert.equal(c.params.positionSide, "LONG");
  assert.equal(c.params.type, "LIMIT");
  assert.equal(c.params.timeInForce, "GTC", "메이커로 줄 서야 한다");
  await h.close();
});

test("분할 SL 등록 — 알고 주문 + 수량 지정 + CONTRACT_PRICE", async () => {
  // ⚠ `closePosition`을 쓰지 않는다 — 수량이 전량 손절과 갈리는 유일한 표시다
  const h = await mountRoute("routes/tpsl.js", { binance: feed() });
  const r = await h.request("POST", "/partial-sl", { side: "LONG", price: 68000, qty: "0.05" });
  assert.equal(r.status, 200);
  const [c] = h.rec.calls.filter(c => c.path === "/fapi/v1/algoOrder");
  assert.equal(c.params.algoType, "CONDITIONAL");
  assert.equal(c.params.type, "STOP_MARKET");
  assert.equal(c.params.side, "SELL");
  assert.equal(c.params.workingType, "CONTRACT_PRICE", "트리거 기준이 실제 체결가가 아니다");
  assert.ok(c.params.quantity, "수량이 없으면 전량 손절과 구별되지 않는다");
  assert.equal(c.params.closePosition, undefined);
  await h.close();
});

test("분할 SL 응답의 가격은 **그 심볼의 호가 단위**로 나온다", async () => {
  // ⚠ 2026-09-03까지 여기만 `roundPrice(price)`로 심볼이 빠져 있었다 (14곳 중 1곳).
  //   응답 가격이 BTC 호가(0.1)로 반올림돼 DOGE 0.0832가 `0.1`, 1000PEPE는 `0`이 됐다.
  //   실제 주문(triggerPrice)은 맞았고 프론트가 이 값을 안 읽어 화면엔 안 드러났지만,
  //   응답이 거짓말을 하고 있었다
  const h = await mountRoute("routes/tpsl.js", { binance: feed() });
  const r = await h.request("POST", "/partial-sl", {
    side: "LONG", price: 0.0832, qty: "100", symbol: "DOGEUSDT",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.price, 0.0832, "응답 가격이 기본 심볼 단위로 뭉개졌다");
  // 실제로 나간 주문도 같은 값이어야 한다 (응답과 주문이 갈리면 안 된다)
  const [c] = h.rec.calls.filter(c => c.path === "/fapi/v1/algoOrder");
  assert.equal(Number(c.params.triggerPrice), r.body.price, "응답과 실제 주문이 다르다");
  await h.close();
});

test("분할 SL — 즉시 발동할 자리(-2021)는 방향을 알려준다", async () => {
  const h = await mountRoute("routes/tpsl.js", {
    binance: async (method, p) => {
      if (p === "/fapi/v1/algoOrder") {
        const e = new Error("boom");
        e.response = { data: { code: -2021, msg: "Order would immediately trigger." } };
        throw e;
      }
      return { data: [] };
    },
  });
  const r = await h.request("POST", "/partial-sl", { side: "LONG", price: 99000, qty: "0.05" });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /LONG은 현재가보다 아래/);
  await h.close();
});

// ── 취소: 종류를 확인한다 ──────────────────────────────────────────────────
test("취소 — orderId가 없으면 400", async () => {
  const h = await mountRoute("routes/tpsl.js", { binance: feed() });
  assert.equal((await h.request("DELETE", "/split", {})).status, 400);
  assert.equal((await h.request("DELETE", "/partial-sl", {})).status, 400);
  assert.equal(h.rec.calls.length, 0);
  await h.close();
});

test("이미 걸린 주문은 **그 주문의 심볼**로 취소한다 (화면 심볼이 아니라)", async () => {
  // ⚠ 화면이 다른 코인으로 옮겨간 뒤에도 원래 심볼로 취소해야 한다
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed(),
    store: { "D1": { status: "SPLIT_TP", symbol: "DOGEUSDT", side: "SELL" } },
  });
  await h.request("DELETE", "/split", { orderId: "D1", symbol: "BTCUSDT" });
  const cancel = h.rec.cancels.at(-1);
  assert.equal(cancel?.symbol, "DOGEUSDT",
    "요청에 실린 심볼로 취소했다 — 다른 코인 화면에서 취소가 안 된다");
  await h.close();
});

// ── 손절을 일부러 지웠다는 표시 (2026-09-04) ───────────────────────────────
//
// ⚠ 진입은 손절이 **필수**다. 그래서 손절 없이 들고 가려면 주문한 뒤 차트에서
//   `×`로 지우는 것이 유일한 길이다. 그런데 기록에는 `sl`이 그대로 남아 있어서,
//   표시가 없으면 **재시작 복구와 60초 정합이 말없이 다시 걸어 버린다**
// ⚠ 알고 주문은 `algoId`다 (`orderId`가 아니다) — 바이낸스가 그렇게 준다
const slOrder = { algoId: "SL9", orderType: "STOP_MARKET", side: "SELL",
                  positionSide: "LONG", closePosition: true };
const tpOrder = { algoId: "TP9", orderType: "TAKE_PROFIT_MARKET", side: "SELL",
                  positionSide: "LONG", closePosition: true };
const entryRec = (over = {}) => ({
  status: "TPSL_PLACED", side: "BUY", closeSide: "SELL",
  tp: 80000, sl: 65000, qty: "0.01", symbol: "BTCUSDT",
  fillPrice: 70000, filledAt: Date.now(), ...over,
});

test("손절을 지우면 기록에 **지운 시각**이 남는다", async () => {
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed({ algo: [slOrder] }),
    store: { "E1": entryRec() },
  });
  const r = await h.request("DELETE", "/", { orderId: "SL9", isAlgo: true });
  assert.equal(r.status, 200);
  assert.ok(h.store.get("E1").slRemovedAt, "표시가 안 남았다 — 복구가 되돌려 버린다");
  await h.close();
});

test("**익절**을 지우면 표시하지 않는다 (복구를 막으면 안 된다)", async () => {
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed({ algo: [tpOrder] }),
    store: { "E1": entryRec() },
  });
  await h.request("DELETE", "/", { orderId: "TP9", isAlgo: true });
  assert.equal(h.store.get("E1").slRemovedAt, undefined,
    "익절을 지웠는데 손절 표시가 붙었다 — 그 포지션이 영영 복구에서 빠진다");
  await h.close();
});

test("종류를 확인 못 했으면 표시하지 않는다", async () => {
  // ⚠ 손절인지 익절인지 모르면 표시하지 않는다 — 잘못 붙이면 복구가 막힌다
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed(),                       // 목록에 없다 → assertCancelKind가 undefined
    store: { "E1": entryRec() },
  });
  await h.request("DELETE", "/", { orderId: "모름", isAlgo: true });
  assert.equal(h.store.get("E1").slRemovedAt, undefined);
  assert.ok(h.rec.logs.some(l => l.event === "SL_REMOVE_UNVERIFIED"), "조용히 넘어갔다");
  await h.close();
});

test("표시는 **그 사이드·그 심볼**에만 붙는다", async () => {
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed({ algo: [slOrder] }),          // LONG 손절
    store: {
      "LONG_BTC":  entryRec(),                                        // ← 붙어야 한다
      "SHORT_BTC": entryRec({ side: "SELL", closeSide: "BUY" }),      // 반대 사이드
      "LONG_DOGE": entryRec({ symbol: "DOGEUSDT" }),                  // 다른 심볼
    },
  });
  await h.request("DELETE", "/", { orderId: "SL9", isAlgo: true });
  assert.ok(h.store.get("LONG_BTC").slRemovedAt,  "그 사이드에 안 붙었다");
  assert.equal(h.store.get("SHORT_BTC").slRemovedAt, undefined, "반대 사이드에 붙었다");
  assert.equal(h.store.get("LONG_DOGE").slRemovedAt, undefined, "다른 심볼에 붙었다");
  await h.close();
});

test("손절을 다시 걸면 표시를 **거둔다** (안 거두면 영영 복구에서 빠진다)", async () => {
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed(),
    store: { "E1": entryRec({ slRemovedAt: Date.now() }) },
  });
  const r = await h.request("PUT", "/", { side: "BUY", sl: 64000 });
  assert.equal(r.status, 200);
  assert.equal(h.store.get("E1").slRemovedAt, undefined, "표시가 남았다");
  assert.ok(h.rec.logs.some(l => l.event === "SL_REMOVED_FLAG_CLEARED"));
  await h.close();
});

test("익절만 다시 걸면 표시는 **그대로 남는다**", async () => {
  const h = await mountRoute("routes/tpsl.js", {
    binance: feed(),
    store: { "E1": entryRec({ slRemovedAt: Date.now() }) },
  });
  await h.request("PUT", "/", { side: "BUY", tp: 85000 });
  assert.ok(h.store.get("E1").slRemovedAt, "익절만 걸었는데 손절 표시가 거둬졌다");
  await h.close();
});

test("분할 SL 취소는 알고 주문으로 지운다", async () => {
  const h = await mountRoute("routes/tpsl.js", { binance: feed() });
  await h.request("DELETE", "/partial-sl", { orderId: "A9" });
  const cancel = h.rec.cancels.at(-1);
  assert.equal(cancel?.isAlgo, true, "알고가 아닌 경로로 지웠다");
  assert.equal(String(cancel?.algoId), "A9");
  await h.close();
});
