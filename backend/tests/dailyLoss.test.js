// 일일 손실 한도 — 이 시스템의 **유일한 자동 차단 장치**다.
//
// ⚠ 여기가 틀리면 두 방향으로 다 나쁘다:
//   느슨하면 잃어도 계속 주문이 나가고, 빡빡하면 멀쩡한 날에 주문이 막힌다.
//   그런데 `routes/dailyloss.js`에는 지금까지 검산이 하나도 없었다.
//
// 이 파일이 보는 것:
//   · 한도가 **당일 시작 자본**의 4%인가 (지금 잔고가 아니라)
//   · 오늘 벌었으면 그만큼 더 잃을 수 있는가 (시작 자본 기준이라 그게 맞다)
//   · 넘으면 **주문을 막고** `DAILY_LOSS_BLOCKED`를 남기는가
//   · 경계에서 통과하지 않는가
//   · 손익 조회에 **심볼 필터를 걸지 않는가** (걸면 한도가 헐거워진다)
//   · 조회가 실패하면 **막는 쪽으로** 기우는가

const test   = require("node:test");
const assert = require("node:assert/strict");
const { mountRoute, loadService } = require("./helpers/routeHarness");

/** 잔고·손익 응답 대역. income은 [{income}] 배열이다 */
const feed = ({ wallet = 1000, incomes = [] } = {}) => async (method, p, params) => {
  if (p === "/fapi/v2/balance") {
    return { data: [{ asset: "BNB", balance: "5" }, { asset: "USDT", balance: String(wallet) }] };
  }
  if (p === "/fapi/v1/income") return { data: incomes.map(v => ({ income: String(v) })) };
  return { data: [] };
};

// ── 한도 계산 ──────────────────────────────────────────────────────────────

test("한도는 **당일 시작 자본**의 4%다 — 오늘 손익이 0이면 지금 잔고와 같다", async () => {
  const h = await mountRoute("routes/dailyloss.js", { binance: feed({ wallet: 1000 }) });
  const { body } = await h.request("GET", "/");
  assert.equal(body.limit, 40);
  assert.equal(body.remaining, 40);
  await h.close();
});

test("오늘 잃었으면 **잃기 전 자본**으로 한도를 잡는다", async () => {
  // 지금 900인데 오늘 -100 → 시작은 1000이었다. 한도는 900의 4%(36)가 아니라 40이다
  const h = await mountRoute("routes/dailyloss.js",
    { binance: feed({ wallet: 900, incomes: [-100] }) });
  const { body } = await h.request("GET", "/");
  assert.equal(body.limit, 40);
  assert.equal(body.remaining, -60);   // 이미 60 초과 — 주문이 막혀 있어야 한다
  await h.close();
});

test("오늘 벌었으면 그만큼 **더 잃을 수 있다** (기준이 시작 자본이라 그게 맞다)", async () => {
  // 지금 1100, 오늘 +100 → 시작 1000. 한도선은 960이므로 여기서 140을 더 잃을 수 있다
  const h = await mountRoute("routes/dailyloss.js",
    { binance: feed({ wallet: 1100, incomes: [100] }) });
  const { body } = await h.request("GET", "/");
  assert.equal(body.limit, 40);
  assert.equal(body.remaining, 140);
  await h.close();
});

test("여러 건의 실현 손익을 **더해서** 오늘 손익을 낸다", async () => {
  const h = await mountRoute("routes/dailyloss.js",
    { binance: feed({ wallet: 1000, incomes: [50, -30, -20, 10] }) });   // 합 +10
  const { body } = await h.request("GET", "/");
  assert.equal(body.todayPnl, 10);
  assert.equal(body.limit, 39.6);                 // 시작 990의 4%
  await h.close();
});

test("USDT만 본다 — 다른 자산 잔고는 한도에 안 들어간다", async () => {
  const h = await mountRoute("routes/dailyloss.js", {
    binance: async (m, p) => p === "/fapi/v2/balance"
      ? { data: [{ asset: "BNB", balance: "9999" }, { asset: "USDT", balance: "500" }] }
      : { data: [] },
  });
  const { body } = await h.request("GET", "/");
  assert.equal(body.walletBalance, 500);
  assert.equal(body.limit, 20);
  await h.close();
});

// ── 조회 방식 ──────────────────────────────────────────────────────────────

test("손익 조회에 **심볼 필터를 걸지 않는다** — 걸면 다른 코인 손실이 안 잡혀 한도가 헐거워진다", async () => {
  const seen = [];
  const h = await mountRoute("routes/dailyloss.js", {
    binance: async (m, p, params) => { seen.push({ p, params }); return { data: p === "/fapi/v2/balance" ? [{ asset: "USDT", balance: "1000" }] : [] }; },
  });
  await h.request("GET", "/");
  const income = seen.find(c => c.p === "/fapi/v1/income");
  assert.ok(income, "손익을 조회해야 한다");
  assert.equal(income.params.symbol, undefined, "symbol을 넘기면 안 된다");
  assert.equal(income.params.incomeType, "REALIZED_PNL");
  await h.close();
});

test("오늘 몫만 본다 — startTime이 **UTC 0시**다", async () => {
  const seen = [];
  const h = await mountRoute("routes/dailyloss.js", {
    binance: async (m, p, params) => { seen.push({ p, params }); return { data: p === "/fapi/v2/balance" ? [{ asset: "USDT", balance: "1000" }] : [] }; },
  });
  await h.request("GET", "/");
  const { startTime } = seen.find(c => c.p === "/fapi/v1/income").params;
  const d = new Date(startTime);
  assert.equal(d.getUTCHours(), 0);
  assert.equal(d.getUTCMinutes(), 0);
  assert.equal(d.getUTCSeconds(), 0);
  assert.equal(d.getUTCMilliseconds(), 0);
  // 오늘이어야 한다 (어제 0시면 하루치를 더 봐서 한도가 헐거워진다)
  assert.equal(new Date(startTime).toISOString().slice(0, 10),
               new Date().toISOString().slice(0, 10));
  await h.close();
});

// ── 주문 차단 (checkDailyLoss) ─────────────────────────────────────────────

test("한도 안이면 **통과시킨다** — 던지지 않는다", async () => {
  const h = await loadService("routes/dailyloss.js",
    { binance: feed({ wallet: 990, incomes: [-10] }) });   // 시작 1000, 한도 40, 남은 30
  await h.mod.checkDailyLoss();                            // 던지면 테스트가 깨진다
  assert.equal(h.rec.logs.filter(l => l.event === "DAILY_LOSS_BLOCKED").length, 0);
  await h.close();
});

test("한도를 넘으면 **막고** DAILY_LOSS_BLOCKED를 남긴다", async () => {
  const h = await loadService("routes/dailyloss.js",
    { binance: feed({ wallet: 950, incomes: [-50] }) });   // 시작 1000, 한도 40, 50 잃음
  await assert.rejects(() => h.mod.checkDailyLoss(), (e) => {
    assert.equal(e.status, 403, "403이어야 프론트가 한도 초과로 읽는다");
    assert.match(e.message, /일일 손실 한도 초과/);
    return true;
  });
  const blocked = h.rec.logs.filter(l => l.event === "DAILY_LOSS_BLOCKED");
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].overBy, 10);                     // 40 한도에서 10 초과
  await h.close();
});

test("**경계에서 통과하지 않는다** — 정확히 한도만큼 잃었으면 막는다", async () => {
  const h = await loadService("routes/dailyloss.js",
    { binance: feed({ wallet: 960, incomes: [-40] }) });   // 시작 1000, 한도 40, 딱 40 잃음
  await assert.rejects(() => h.mod.checkDailyLoss());
  await h.close();
});

test("한도 **직전**은 통과한다 — 1 USDT 남으면 아직 주문할 수 있다", async () => {
  const h = await loadService("routes/dailyloss.js",
    { binance: feed({ wallet: 961, incomes: [-39] }) });   // 시작 1000, 한도 40, 39 잃음
  await h.mod.checkDailyLoss();
  await h.close();
});

test("조회가 실패하면 **막는 쪽으로 기운다** — 모르면 불리하게", async () => {
  // 잔고를 못 읽는데 통과시키면, 이미 한도를 넘긴 날에도 주문이 나간다.
  // `routes/order.js`가 `await checkDailyLoss()`를 try 안에서 부르므로
  // 여기서 던지는 것이 곧 주문 차단이다
  const h = await loadService("routes/dailyloss.js", {
    binance: async () => { throw new Error("getaddrinfo ENOTFOUND fapi.binance.com"); },
  });
  await assert.rejects(() => h.mod.checkDailyLoss());
  await h.close();
});

test("잔고가 0이면 한도도 0이라 **아무 주문도 안 나간다**", async () => {
  const h = await loadService("routes/dailyloss.js", { binance: feed({ wallet: 0 }) });
  await assert.rejects(() => h.mod.checkDailyLoss());
  await h.close();
});
