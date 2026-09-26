// GET /api/positions — 계정 전체 포지션 (사이드바의 **하늘색 카드**)
//
// 이 파일이 보는 것:
//   · **거래소를 부르지 않는가** — 재료는 3초마다 도는 계정 감시의 마지막 관측이다.
//     여기서 심볼별로 직접 조회하게 바뀌면 폴링 × 코인 수만큼 호출이 늘어난다
//   · TP/SL 분류가 `GET /api/tpsl`과 **같은 함수**를 지나는가 (utils/tpslView.js)
//   · 그 코인의 호가·수량 단위를 실어 주는가 — 없으면 DOGE 청산가가 `$0`으로 보인다
//   · 관측을 아직 못 뜬 구간(서버를 켠 직후)에 빈 목록으로 답하는가

const test   = require("node:test");
const assert = require("node:assert/strict");
const path   = require("path");
const { mountRoute } = require("./helpers/routeHarness");

const SNAP_ID = require.resolve(path.join(__dirname, "..", "services", "accountSnapshot.js"));

/** 스냅샷 모듈을 새로 읽어 빈 상태에서 시작한다 (모듈 안에 관측이 남아 있다) */
function freshSnapshot() {
  delete require.cache[SNAP_ID];
  return require(SNAP_ID);
}

const pos = (symbol, positionSide, amt, extra = {}) => ({
  symbol, positionSide, positionAmt: String(amt),
  entryPrice: "100", markPrice: "110", liquidationPrice: "50",
  unRealizedProfit: "7", ...extra,
});
const fullSl = (id, positionSide, stop) => ({
  orderId: id, type: "STOP_MARKET", status: "NEW",
  side: positionSide === "LONG" ? "SELL" : "BUY", positionSide,
  stopPrice: String(stop), closePosition: true, origQty: "0",
});

test("관측을 아직 못 뜨면 빈 목록이다 — 거래소를 대신 부르지 않는다", async () => {
  freshSnapshot();
  const h = await mountRoute("routes/positions.js");
  try {
    const r = await h.request("GET", "/");
    assert.equal(r.status, 200);
    assert.equal(r.body.at, null);
    assert.deepEqual(r.body.items, []);
    assert.equal(h.rec.calls.length, 0, "거래소를 부르면 안 된다");
  } finally { await h.close(); }
});

test("심볼별 롱·숏이 각각 카드가 되고, 거래소 호출은 0이다", async () => {
  const snap = freshSnapshot();
  snap.set([
    { symbol: "BTCUSDT",  positions: [pos("BTCUSDT", "LONG", 0.5)],
      orders: [fullSl("11", "LONG", 90)], algos: [] },
    { symbol: "DOGEUSDT", positions: [pos("DOGEUSDT", "SHORT", -300)],
      orders: [], algos: [] },
  ]);
  const h = await mountRoute("routes/positions.js");
  try {
    const r = await h.request("GET", "/");
    assert.equal(h.rec.calls.length, 0, "거래소를 부르면 안 된다");
    assert.equal(r.body.items.length, 2);

    const [btc, doge] = r.body.items;   // 심볼 이름 순
    assert.equal(btc.symbol, "BTCUSDT");
    assert.equal(btc.side, "LONG");
    assert.equal(btc.posData.size, 0.5);
    assert.equal(btc.posData.entryPrice, 100);
    assert.equal(btc.posData.liquidationPrice, 50);
    // 분류는 `utils/tpslView.js` — 손절이 붙어 나온다 (카드의 `예상 손실`이 이걸 쓴다)
    assert.equal(btc.tpsl.sl.orderId, "11");
    assert.equal(btc.tpsl.sl.price, 90);
    assert.equal(btc.tpsl.tp, null);

    assert.equal(doge.symbol, "DOGEUSDT");
    assert.equal(doge.side, "SHORT");
    assert.equal(doge.posData.size, 300, "숏 수량은 절댓값이다");
    assert.equal(doge.tpsl.sl, null);
    assert.ok(typeof r.body.at === "number");
  } finally { await h.close(); }
});

test("그 코인의 호가·수량 단위를 실어 준다 — 모르는 심볼은 null", async () => {
  const snap = freshSnapshot();
  snap.set([
    { symbol: "DOGEUSDT", positions: [pos("DOGEUSDT", "LONG", 300)], orders: [], algos: [] },
    { symbol: "XXXUSDT",  positions: [pos("XXXUSDT",  "LONG", 1)],   orders: [], algos: [] },
  ]);
  const h = await mountRoute("routes/positions.js");
  try {
    const r = await h.request("GET", "/");
    const doge = r.body.items.find(i => i.symbol === "DOGEUSDT");
    assert.equal(doge.rules.tick, 0.00001);
    assert.equal(doge.rules.step, 1);
    // ※ `base`(코인 이름)는 하네스 심볼 표에 없어서 여기서는 비어 있다 —
    //    실제로는 exchangeInfo의 `baseAsset`이 들어온다 (카드 제목의 `(BTC)`)
    // 하네스의 심볼 표에 없는 코인 — 규칙을 모른다고 답할 뿐, 카드를 없애지 않는다
    const xxx = r.body.items.find(i => i.symbol === "XXXUSDT");
    assert.equal(xxx.rules, null);
  } finally { await h.close(); }
});

test("수량 0인 행은 카드가 아니다", async () => {
  const snap = freshSnapshot();
  snap.set([{ symbol: "BTCUSDT",
    positions: [pos("BTCUSDT", "LONG", 0), pos("BTCUSDT", "SHORT", -1)],
    orders: [], algos: [] }]);
  const h = await mountRoute("routes/positions.js");
  try {
    const r = await h.request("GET", "/");
    assert.equal(r.body.items.length, 1);
    assert.equal(r.body.items[0].side, "SHORT");
  } finally { await h.close(); }
});

test("미실현은 거래소 값을 쓰고, 그 값이 없으면 마크 가격으로 만든다", async () => {
  const snap = freshSnapshot();
  snap.set([{ symbol: "BTCUSDT", positions: [
    pos("BTCUSDT", "LONG",  2, { unRealizedProfit: "12.5" }),
    // 필드가 없는 경우 — 롱 2개, 평단 100, 마크 110 → +20
    { symbol: "BTCUSDT", positionSide: "SHORT", positionAmt: "-2",
      entryPrice: "100", markPrice: "110", liquidationPrice: "0" },
  ], orders: [], algos: [] }]);
  const h = await mountRoute("routes/positions.js");
  try {
    const r = await h.request("GET", "/");
    const long  = r.body.items.find(i => i.side === "LONG");
    const short = r.body.items.find(i => i.side === "SHORT");
    assert.equal(long.posData.unrealizedPnl, 12.5);
    // 숏은 가격이 오르면 손실이다 — (110 − 100) × 2 × (−1)
    assert.equal(short.posData.unrealizedPnl, -20);
    assert.equal(short.posData.liquidationPrice, null, "0은 청산가가 없다는 뜻이다");
  } finally { await h.close(); }
});

test("미체결 진입에 미리 걸어 둔 TP/SL은 여기서도 감춘다", async () => {
  const snap = freshSnapshot();
  snap.set([{ symbol: "BTCUSDT", positions: [pos("BTCUSDT", "LONG", 1)],
    orders: [fullSl("99", "LONG", 90)], algos: [] }]);
  // store에 "아직 감시 중인 진입 주문 + 그에 딸린 손절 99"가 있다
  const h = await mountRoute("routes/positions.js", {
    store: { 500: { status: "WATCHING", presetTpsl: { sl: { orderId: "99" } } } },
  });
  try {
    const r = await h.request("GET", "/");
    assert.equal(r.body.items[0].tpsl.sl, null,
      "플랜 박스가 이미 보여주는 가격이라 카드에서는 감춘다");
  } finally { await h.close(); }
});
