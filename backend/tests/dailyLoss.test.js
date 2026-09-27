// 일일 손실 한도 — **표시 전용**이다 (2026-09-27 사용자 요청으로 주문 차단을 없앴다).
//   사이드바의 일일 손실 탭이 이 값을 보여준다.
//
// 이 파일이 보는 것:
//   · 한도가 **당일 시작 자본**의 4%인가 (지금 잔고가 아니라)
//   · 오늘 벌었으면 그만큼 더 잃을 수 있는가 (시작 자본 기준이라 그게 맞다)
//   · 손익 조회에 **심볼 필터를 걸지 않는가** (걸면 한도가 헐거워진다)

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
