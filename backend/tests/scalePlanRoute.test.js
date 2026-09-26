// POST /api/scale-plan — 스케일 진입 (진입가~손절가를 층으로 나눠 들어간다)
//
// 이 파일이 보는 것:
//   · 층마다 **그 층의 수량으로** 손절을 미리 거는가 — 이게 이 기능의 안전장치다.
//     묶음 전체에 큰 손절 하나를 걸면 "1층만 체결된 상태에서 손절 발동"에서 손절 수량이
//     보유량을 초과한다 (거래소가 초과분을 잘라주는지 확인되지 않았다)
//   · 기록에 `scaleGroup`이 적히는가 — 남은 층을 치우는 판정의 유일한 근거다
//   · 손절선을 넘은 층을 거절하는가 — 그 자리에 층을 놓으면 사자마자 손절된다
//   · 중간에 실패하면 **나간 것을 되돌리지 않고** 몇 개 나갔는지 알리는가

const test   = require("node:test");
const assert = require("node:assert/strict");
const { mountRoute } = require("./helpers/routeHarness");

/** 층 n개를 균등 가격으로 (롱: 100부터 아래로, 손절 90) */
const layers = (n, qty = 0.01) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ price: 100 - i * (10 / n), qty });
  return out;
};
const body = (over = {}) => ({
  side: "BUY", entry: 100, tp: 120, sl: 90, leverage: 10, layers: layers(4), ...over,
});

let orderSeq = 0;
const feed = (opts = {}) => async (method, p) => {
  if (p.includes("positionRisk")) return { data: opts.positions ?? [] };
  if (p === "/fapi/v1/order") {
    if (opts.failAt != null && orderSeq === opts.failAt) {
      orderSeq++;
      const e = new Error("Margin is insufficient.");
      e.response = { data: { msg: "Margin is insufficient." } };
      throw e;
    }
    return { data: { orderId: `L${++orderSeq}`, status: "NEW" } };
  }
  return { data: {} };
};

test("층마다 주문을 내고, 층마다 **그 층의 수량으로** 손절을 미리 건다", async () => {
  orderSeq = 0;
  const h = await mountRoute("routes/scalePlan.js", { binance: feed() });
  try {
    const r = await h.request("POST", "/", body());
    assert.equal(r.status, 200);
    assert.equal(r.body.placed, 4);
    assert.equal(r.body.requested, 4);

    const entries = h.rec.calls.filter(c => c.path === "/fapi/v1/order");
    assert.equal(entries.length, 4, "층마다 진입 주문 하나");
    for (const c of entries) {
      assert.equal(c.params.type, "LIMIT");
      assert.equal(c.params.timeInForce, "GTC");
      assert.equal(c.params.positionSide, "LONG");
      assert.equal(c.params.side, "BUY");
    }

    assert.equal(h.rec.preplaced.length, 4, "층마다 사전 등록 하나");
    for (const pre of h.rec.preplaced) {
      assert.equal(pre.qty, 0.01, "묶음 전체 수량이 아니라 그 층의 수량이어야 한다");
      assert.equal(pre.sl, 90);
      assert.equal(pre.closeSide, "SELL");
    }
  } finally { await h.close(); }
});

test("기록에 같은 `scaleGroup`이 적힌다 (남은 층을 치우는 근거)", async () => {
  orderSeq = 0;
  const h = await mountRoute("routes/scalePlan.js", { binance: feed() });
  try {
    const r = await h.request("POST", "/", body());
    const recs = [...h.store.values()];
    assert.equal(recs.length, 4);
    const groups = new Set(recs.map(x => x.scaleGroup));
    assert.equal(groups.size, 1, "한 계획은 한 묶음이다");
    assert.equal([...groups][0], r.body.scaleGroup);
    for (const x of recs) {
      assert.equal(x.status, "WATCHING");
      assert.equal(x.sl, 90);
      assert.equal(x.scaleCount, 4);
    }
    // 플랜 박스는 첫 층에만 담는다 — 층마다 담으면 같은 박스가 N벌이 된다
    assert.equal(recs.filter(x => x.drawing).length, 0, "이 요청에는 박스가 없다");
    const withBox = recs.filter(x => x.scaleIndex === 0);
    assert.equal(withBox.length, 1);
  } finally { await h.close(); }
});

test("⚠ 손절선을 넘은 층은 거절한다 — 그 자리는 사자마자 손절되는 자리다", async () => {
  const h = await mountRoute("routes/scalePlan.js", { binance: feed() });
  try {
    const r = await h.request("POST", "/", body({
      layers: [{ price: 100, qty: 0.01 }, { price: 89, qty: 0.01 }],   // 89 < 손절 90
    }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /사이가 아닙니다/);
    assert.equal(h.rec.calls.filter(c => c.path === "/fapi/v1/order").length, 0,
      "거절했으면 주문이 하나도 나가면 안 된다");
  } finally { await h.close(); }
});

test("진입가보다 유리한 쪽의 층도 거절한다 (롱인데 진입가 위)", async () => {
  const h = await mountRoute("routes/scalePlan.js", { binance: feed() });
  try {
    const r = await h.request("POST", "/", body({
      layers: [{ price: 101, qty: 0.01 }],
    }));
    assert.equal(r.status, 400);
  } finally { await h.close(); }
});

test("가격이 겹친 층은 거절한다", async () => {
  const h = await mountRoute("routes/scalePlan.js", { binance: feed() });
  try {
    const r = await h.request("POST", "/", body({
      layers: [{ price: 95, qty: 0.01 }, { price: 95, qty: 0.01 }],
    }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /겹칩니다/);
  } finally { await h.close(); }
});

test("금액 상한은 **층 수량의 합**으로 본다", async () => {
  const h = await mountRoute("routes/scalePlan.js", { binance: feed() });
  try {
    // 층당 20 BTC × 4층 = 80 BTC × $100 = $8,000 — 상한($7.2M) 아래라 통과해야 한다
    assert.equal((await h.request("POST", "/", body({ layers: layers(4, 20) }))).status, 200);
    // 층당 20,000 × 4 = 80,000 × $100 = $8,000,000 — 상한 초과
    const r = await h.request("POST", "/", body({ layers: layers(4, 20_000) }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /금액 상한/);
  } finally { await h.close(); }
});

test("중간에 실패하면 나간 층을 되돌리지 않고 몇 개 나갔는지 알린다", async () => {
  orderSeq = 0;
  const h = await mountRoute("routes/scalePlan.js", { binance: feed({ failAt: 2 }) });
  try {
    const r = await h.request("POST", "/", body());
    assert.equal(r.status, 200, "일부라도 나갔으면 성공으로 답한다");
    assert.equal(r.body.placed, 2);
    assert.equal(r.body.requested, 4);
    assert.match(r.body.warning, /4개 중 2개/);
    assert.equal(h.rec.cancels.length, 0, "이미 나간 층을 취소하지 않는다 (손절이 붙어 있다)");
    assert.equal(h.store.size, 2);
  } finally { await h.close(); }
});

test("첫 층부터 실패하면 에러다 (걸린 것이 없다)", async () => {
  orderSeq = 0;
  const h = await mountRoute("routes/scalePlan.js", { binance: feed({ failAt: 0 }) });
  try {
    const r = await h.request("POST", "/", body());
    assert.equal(r.status, 400);
    assert.equal(h.store.size, 0);
  } finally { await h.close(); }
});

test("손절 사전 등록이 실패한 층이 있으면 경고한다", async () => {
  orderSeq = 0;
  const h = await mountRoute("routes/scalePlan.js", {
    binance: feed(),
    preplaceTPSL: async () => ({ tp: null, sl: null, failed: [{ type: "SL", error: "rejected" }] }),
  });
  try {
    const r = await h.request("POST", "/", body({ layers: layers(2) }));
    assert.equal(r.status, 200);
    assert.match(r.body.warning, /손절 사전 등록 실패/);
    assert.match(r.body.warning, /2개 층/);
  } finally { await h.close(); }
});

test("일일 손실 한도를 넘으면 주문이 하나도 안 나간다", async () => {
  const h = await mountRoute("routes/scalePlan.js", {
    binance: feed(),
    dailyLoss: async () => { const e = new Error("일일 손실 한도 초과"); e.status = 403; throw e; },
  });
  try {
    const r = await h.request("POST", "/", body());
    assert.equal(r.status, 403);
    assert.equal(h.rec.calls.filter(c => c.path === "/fapi/v1/order").length, 0);
  } finally { await h.close(); }
});

test("반대쪽 포지션이 있으면 레버리지를 건드리지 않는다 (단일 진입과 같은 규칙)", async () => {
  orderSeq = 0;
  const h = await mountRoute("routes/scalePlan.js", {
    binance: feed({ positions: [{ positionSide: "SHORT", positionAmt: "-1" }] }),
  });
  try {
    await h.request("POST", "/", body({ layers: layers(2) }));
    assert.equal(h.rec.calls.filter(c => c.path === "/fapi/v1/leverage").length, 0);
  } finally { await h.close(); }
});

test("층은 최대 10개다", async () => {
  const h = await mountRoute("routes/scalePlan.js", { binance: feed() });
  try {
    const r = await h.request("POST", "/", body({ layers: layers(11) }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /최대 10개/);
  } finally { await h.close(); }
});
