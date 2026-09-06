// POST /api/order — 진입 (+ TP/SL 등록, 일일 손실 가드)
//
// ⚠ **여기가 돈이 나가는 입구다.** 지금까지 `validate` 미들웨어만 검산돼 있었다.
//
// 이 파일이 보는 것 — 문구가 아니라 **거래소로 나간 호출**:
//   · 일일 손실 한도가 **주문보다 먼저** 막는가 (막힌 뒤 주문이 안 나가는가)
//   · 지정가 진입이 TP/SL을 **미리** 거는가 (백엔드가 꺼진 사이 체결돼도 손절이 있게)
//   · 반대쪽 포지션이 있으면 레버리지를 **안 건드리는가** (청산가가 말없이 움직인다)
//   · 심볼이 모든 호출에 실리는가 / 모르는 심볼이 400인가
//   · 주문번호가 문자열로 나가는가 (19자리가 뭉개지면 취소를 못 한다)

const test   = require("node:test");
const assert = require("node:assert/strict");
const { mountRoute } = require("./helpers/routeHarness");

const okOrder = (id = "12345", status = "NEW") =>
  async (method, p) => {
    if (p.includes("positionRisk")) return { data: [] };
    if (p === "/fapi/v1/order")     return { data: { orderId: id, status } };
    return { data: [] };
  };

const body = (over = {}) => ({
  side: "BUY", orderType: "LIMIT", entry: 70000, tp: 80000, sl: 65000,
  quantity: "0.01", leverage: 10, ...over,
});

const orderCalls = (rec) => rec.calls.filter(c => c.path === "/fapi/v1/order");

// ── 일일 손실 한도 ─────────────────────────────────────────────────────────
test("일일 손실 한도에 걸리면 **주문이 나가지 않는다**", async () => {
  // ⚠ 막고 나서 주문이 나가면 한도가 아무 의미가 없다
  const h = await mountRoute("routes/order.js", {
    binance: okOrder(),
    dailyLoss: async () => {
      const e = new Error("오늘 손실 한도(4%)에 도달했습니다"); e.status = 403; throw e;
    },
  });
  const r = await h.request("POST", "/", body());
  assert.equal(r.status, 403);
  assert.match(r.body.error, /한도/);
  assert.equal(orderCalls(h.rec).length, 0, "한도에 걸렸는데 주문이 나갔다");
  await h.close();
});

test("한도 체크가 통과하면 주문이 나간다", async () => {
  const h = await mountRoute("routes/order.js", { binance: okOrder() });
  const r = await h.request("POST", "/", body());
  assert.equal(r.status, 200);
  assert.equal(orderCalls(h.rec).length, 1);
  await h.close();
});

// ── 심볼 ───────────────────────────────────────────────────────────────────
test("모르는 심볼은 400 — 거래소를 부르기 전에 막는다", async () => {
  const h = await mountRoute("routes/order.js", { binance: okOrder() });
  const r = await h.request("POST", "/", body({ symbol: "NOPEUSDT" }));
  assert.equal(r.status, 400);
  assert.equal(h.rec.calls.length, 0, "모르는 심볼로 거래소를 불렀다");
  await h.close();
});

test("모든 거래소 호출에 심볼이 실린다", async () => {
  const h = await mountRoute("routes/order.js", {
    binance: okOrder(), symbols: undefined,
  });
  await h.request("POST", "/", body({ symbol: "DOGEUSDT", entry: 0.08, tp: 0.09, sl: 0.07,
                                      quantity: "100" }));
  assert.ok(h.rec.calls.length > 0);
  for (const c of h.rec.calls) {
    assert.equal(c.params.symbol, "DOGEUSDT", `${c.method} ${c.path}에 심볼이 없거나 틀리다`);
  }
  await h.close();
});

// ── 레버리지: 반대쪽 포지션을 보호한다 ─────────────────────────────────────
test("반대쪽 포지션이 있으면 레버리지를 **건드리지 않는다**", async () => {
  // ⚠ 바꾸면 이미 열린 반대쪽 포지션의 청산가가 말없이 움직인다
  const h = await mountRoute("routes/order.js", {
    binance: async (method, p) => {
      if (p.includes("positionRisk"))
        return { data: [{ positionSide: "SHORT", positionAmt: "-0.5" }] };
      if (p === "/fapi/v1/order") return { data: { orderId: "1", status: "NEW" } };
      return { data: [] };
    },
  });
  await h.request("POST", "/", body({ side: "BUY", leverage: 20 }));
  const levCalls = h.rec.calls.filter(c => c.path.includes("leverage"));
  assert.equal(levCalls.length, 0, "반대쪽 포지션이 있는데 레버리지를 바꿨다");
  assert.ok(h.rec.logs.some(l => l.event === "LEVERAGE_SKIPPED"), "건너뛴 것을 안 남겼다");
  await h.close();
});

test("반대쪽 포지션이 없으면 레버리지를 설정한다", async () => {
  const h = await mountRoute("routes/order.js", { binance: okOrder() });
  await h.request("POST", "/", body({ leverage: 20 }));
  const levCalls = h.rec.calls.filter(c => c.path.includes("leverage"));
  assert.equal(levCalls.length, 1, "레버리지를 안 걸었다");
  assert.equal(levCalls[0].params.leverage, 20);
  await h.close();
});

// ── 지정가 진입: TP/SL을 미리 건다 ─────────────────────────────────────────
test("지정가 진입 — 진입 주문과 함께 TP/SL을 **미리** 건다", async () => {
  // ⚠ 백엔드가 꺼진 사이 체결돼도 손절이 있게 하기 위해서다.
  //   store에만 적어 두던 옛 방식으로 되돌리지 말 것
  const h = await mountRoute("routes/order.js", { binance: okOrder("777") });
  const r = await h.request("POST", "/", body({ orderType: "LIMIT" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.type, "LIMIT");
  const saved = h.store.get("777");
  assert.ok(saved, "store에 기록이 없다");
  assert.ok("presetTpsl" in saved, "TP/SL 사전 등록을 안 했다");
  assert.equal(saved.status, "WATCHING");
  assert.equal(saved.tp, 80000);
  assert.equal(saved.sl, 65000);
  await h.close();
});

test("지정가 진입 — 즉시 체결됐는지 한 번 더 확인한다", async () => {
  // ⚠ 바이낸스는 즉시 체결돼도 보통 "NEW"를 돌려준다 — 응답만 믿으면
  //   UDS FILLED가 store.set보다 먼저 도착해 버려진다
  const h = await mountRoute("routes/order.js", { binance: okOrder("777") });
  await h.request("POST", "/", body({ orderType: "LIMIT" }));
  assert.equal(h.rec.verifies.length, 1, "즉시 체결 확인을 안 걸었다");
  assert.equal(String(h.rec.verifies[0][0]), "777");
  await h.close();
});

// ── 시장가 진입 ────────────────────────────────────────────────────────────
test("시장가 진입 — 체결 후 TP/SL을 건다", async () => {
  const h = await mountRoute("routes/order.js", {
    binance: async (method, p) => {
      if (p.includes("positionRisk")) return { data: [] };
      if (p === "/fapi/v1/order")
        return { data: { orderId: "888", status: "FILLED", avgPrice: "70010", executedQty: "0.01" } };
      return { data: [] };
    },
  });
  const r = await h.request("POST", "/", body({ orderType: "MARKET" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.type, "MARKET");
  assert.equal(r.body.entry.orderId, "888");
  await h.close();
});

// ── 주문번호는 문자열 ──────────────────────────────────────────────────────
test("응답의 orderId는 **문자열**이다 (19자리가 뭉개지면 취소를 못 한다)", async () => {
  const big = "8389766268995766668";
  const h = await mountRoute("routes/order.js", { binance: okOrder(big) });
  const r = await h.request("POST", "/", body());
  assert.equal(typeof r.body.entry.orderId, "string");
  assert.equal(r.body.entry.orderId, big, "주문번호가 뭉개졌다");
  assert.ok(h.store.has(big), "store 키도 같은 문자열이어야 한다");
  await h.close();
});

// ── 입력 검증 (validate 미들웨어를 실제로 지나는가) ────────────────────────
test("검증에 걸리는 입력은 거래소를 부르지 않는다", async () => {
  for (const bad of [
    { side: "SIDEWAYS" },
    { quantity: "0" },
    { quantity: "-1" },
    { entry: -5 },
    { orderType: "ICEBERG" },
  ]) {
    const h = await mountRoute("routes/order.js", { binance: okOrder() });
    const r = await h.request("POST", "/", body(bad));
    assert.ok(r.status >= 400, `${JSON.stringify(bad)}가 통과했다`);
    assert.equal(h.rec.calls.length, 0, `${JSON.stringify(bad)}인데 거래소를 불렀다`);
    await h.close();
  }
});

// ── PATCH: 미체결 주문의 TP/SL 수정 ────────────────────────────────────────
test("PATCH — orderId가 없으면 400, 모르는 주문이면 404", async () => {
  const h = await mountRoute("routes/order.js", { binance: okOrder() });
  assert.equal((await h.request("PATCH", "/", {})).status, 400);
  assert.equal((await h.request("PATCH", "/", { orderId: "없음", tp: 1, sl: 2 })).status, 404);
  await h.close();
});

test("PATCH — 있는 주문이면 사전 TP/SL을 다시 건다", async () => {
  const h = await mountRoute("routes/order.js", {
    binance: okOrder(),
    store: { "555": { status: "WATCHING", side: "BUY", tp: 80000, sl: 65000,
                      qty: "0.01", symbol: "BTCUSDT",
                      presetTpsl: { tp: { orderId: "t1" }, sl: { orderId: "s1" }, failed: [] } } },
  });
  const r = await h.request("PATCH", "/", { orderId: "555", tp: 82000, sl: 64000 });
  assert.equal(r.status, 200);
  assert.equal(h.store.get("555").tp, 82000);
  assert.equal(h.store.get("555").sl, 64000);
  await h.close();
});

// ── 시장가 진입에서 SL 등록이 실패했을 때 (2026-09-06) ─────────────────────
//
// ⚠ 이 배너는 **거둘 사람이 있어야** 한다. 예전엔 띄우기만 하고 아무도 안 거둬서,
//   사용자가 그 포지션을 손으로 닫아도 화면에는 `SL 등록 실패`가 남았다.
//   그래서 라우트는 직접 띄우지 않고 `orderWatcher.raiseSlMissing`을 부른다 —
//   배너의 래치를 `orderWatcher`가 들고 있어야 `resolveNaked`가 거둘 수 있다.
const slAlerts = require("../utils/slAlerts");

test("시장가 SL 실패는 **빨간 배너**를 띄우되, orderWatcher를 거친다", async () => {
  const h = await mountRoute("routes/order.js", {
    binance: okOrder(),
    placeTPSL: async () => ({ tp: { orderId: "TP1" }, sl: null,
                              failed: [{ type: "SL", error: "-2021" }] }),
  });
  const r = await h.request("POST", "/", body({ orderType: "MARKET" }));
  assert.equal(r.status, 200);

  const red = h.rec.alerts.filter(a => a.level === "critical");
  assert.equal(red.length, 1, "손절이 안 걸렸는데 빨간 배너가 없다");
  assert.equal(red[0].msg, slAlerts.naked("BTCUSDT", "LONG"));

  assert.equal(h.rec.slRaises.length, 1, "orderWatcher를 안 거쳤다 — 아무도 못 거둔다");
  assert.equal(h.rec.slRaises[0].symbol,  "BTCUSDT");
  assert.equal(h.rec.slRaises[0].posSide, "LONG");
  await h.close();
});

test("숏 시장가면 **SHORT**로 적어 둔다 (롱 배너를 거두면 안 된다)", async () => {
  const h = await mountRoute("routes/order.js", {
    binance: okOrder(),
    placeTPSL: async () => ({ tp: null, sl: null,
                              failed: [{ type: "SL", error: "-2021" }] }),
  });
  await h.request("POST", "/", body({ orderType: "MARKET", side: "SELL", tp: 60000, sl: 75000 }));
  assert.equal(h.rec.slRaises[0].posSide, "SHORT");
  await h.close();
});

test("TP만 실패하면 빨간 배너도, 적어 두는 것도 없다 (손절은 걸렸다)", async () => {
  const h = await mountRoute("routes/order.js", {
    binance: okOrder(),
    placeTPSL: async () => ({ tp: null, sl: { orderId: "SL1" },
                              failed: [{ type: "TP", error: "-2021" }] }),
  });
  await h.request("POST", "/", body({ orderType: "MARKET" }));
  assert.equal(h.rec.alerts.filter(a => a.level === "critical").length, 0);
  assert.equal(h.rec.slRaises.length, 0);
  await h.close();
});
