// POST /api/close — 청산 (전량 / 부분)
//
// ⚠ **여기가 틀리면 손절이 사라지거나 수량 0인 주문이 나간다.**
//   지금까지 이 라우트는 순수 함수(`splitTp`)만 검산돼 있었고, 라우트 자체는
//   한 줄도 안 덮여 있었다.
//
// 이 파일이 보는 것 — 문구가 아니라 **거래소로 나간 호출**:
//   · 전량 청산이 **그 사이드의** TP/SL·추가진입만 취소하는가 (반대쪽을 지우면 안 된다)
//   · 부분 청산이 분할 TP를 **잔여 비율로** 다시 거는가
//   · 포지션 크기를 못 읽었을 때 **손대지 않는가** (예전에 분할 TP가 통째로 사라졌다)
//   · 심볼의 수량 단위를 지키는가 (DOGE에서 수량 0 주문이 나가면 안 된다)

const test   = require("node:test");
const assert = require("node:assert/strict");
const { mountRoute } = require("./helpers/routeHarness");

// ── 거래소 대역 ────────────────────────────────────────────────────────────
/** openOrders / positionRisk / openAlgoOrders / 주문 을 한 벌로 준다 */
const exchange = ({ open = [], pos = [], algo = [], orderFails = false } = {}) =>
  async (method, p) => {
    if (p.includes("openOrders"))     return { data: open };
    if (p.includes("positionRisk"))   return { data: pos };
    if (p.includes("openAlgoOrders")) return { data: algo };
    if (p === "/fapi/v1/order") {
      if (orderFails) { const e = new Error("-2019 잔고 부족"); throw e; }
      return { data: { orderId: String(Date.now() % 1e9), status: "FILLED" } };
    }
    return { data: [] };
  };

const limit = (id, side, posSide, price, qty) => ({
  orderId: id, type: "LIMIT", status: "NEW", side, positionSide: posSide,
  price: String(price), origQty: String(qty), reduceOnly: true,
});
const position = (posSide, amt) => ({
  positionSide: posSide, positionAmt: String(posSide === "SHORT" ? -amt : amt),
});
const stopMarket = (id, posSide, stop, qty) => ({
  orderId: id, type: "STOP_MARKET", status: "NEW",
  side: posSide === "LONG" ? "SELL" : "BUY", positionSide: posSide,
  stopPrice: String(stop), origQty: String(qty ?? 0), closePosition: !qty,
});

const ids = (rec) => rec.cancels.map(c => String(c.orderId ?? c.algoId));

// ── 입력 검증 ──────────────────────────────────────────────────────────────
test("side·quantity가 없으면 400", async () => {
  const h = await mountRoute("routes/close.js", { binance: exchange() });
  assert.equal((await h.request("POST", "/", {})).status, 400);
  assert.equal((await h.request("POST", "/", { side: "LONG" })).status, 400);
  assert.equal((await h.request("POST", "/", { quantity: "1" })).status, 400);
  assert.equal(h.rec.calls.length, 0, "검증 전에 거래소를 불렀다");
  await h.close();
});

test("모르는 심볼은 400 — 기본 심볼로 떨어지지 않는다", async () => {
  // ⚠ 통과시키면 가격·수량이 이미 BTC 단위로 만들어진 뒤에 거절된다
  const h = await mountRoute("routes/close.js", { binance: exchange() });
  const r = await h.request("POST", "/", { side: "LONG", quantity: "1", symbol: "NOPEUSDT" });
  assert.equal(r.status, 400);
  assert.equal(h.rec.calls.length, 0);
  await h.close();
});

// ── 전량 청산 ──────────────────────────────────────────────────────────────
test("전량 청산 — **그 사이드의** TP/SL·추가진입만 취소한다", async () => {
  const h = await mountRoute("routes/close.js", {
    binance: exchange({
      open: [
        stopMarket("SL_LONG",  "LONG",  60000),
        stopMarket("SL_SHORT", "SHORT", 90000),          // ← 반대쪽, 남아야 한다
        limit("SCALE_LONG",  "BUY",  "LONG",  69000, 0.01),   // 진입 방향 = 추가 진입
        limit("SCALE_SHORT", "SELL", "SHORT", 80000, 0.01),   // ← 반대쪽
        limit("SPLIT_LONG",  "SELL", "LONG",  85000, 0.01),   // 청산 방향 = 분할 TP
      ],
    }),
  });
  const r = await h.request("POST", "/", { side: "LONG", quantity: "0.05" });
  assert.equal(r.status, 200);
  const canceled = ids(h.rec);
  assert.ok(canceled.includes("SL_LONG"),    "롱 손절을 안 지웠다");
  assert.ok(canceled.includes("SCALE_LONG"), "롱 추가진입을 안 지웠다 — 청산 뒤 새 포지션이 열린다");
  assert.ok(!canceled.includes("SL_SHORT"),    "숏 손절까지 지웠다");
  assert.ok(!canceled.includes("SCALE_SHORT"), "숏 추가진입까지 지웠다");
  await h.close();
});

test("전량 청산 — 지정가형 트리거(STOP/TAKE_PROFIT)도 지운다", async () => {
  // ⚠ 조건부 주문은 포지션이 0이 돼도 **자동 취소되지 않는다** (2026-08-23 실측)
  const h = await mountRoute("routes/close.js", {
    binance: exchange({
      open: [
        { orderId: "STOP_LIMIT", type: "STOP", status: "NEW", side: "SELL",
          positionSide: "LONG", stopPrice: "60000", price: "59900", origQty: "0.05" },
        { orderId: "TP_LIMIT", type: "TAKE_PROFIT", status: "NEW", side: "SELL",
          positionSide: "LONG", stopPrice: "90000", price: "90100", origQty: "0.05" },
      ],
    }),
  });
  await h.request("POST", "/", { side: "LONG", quantity: "0.05" });
  const canceled = ids(h.rec);
  assert.ok(canceled.includes("STOP_LIMIT"), "지정가형 손절이 남았다");
  assert.ok(canceled.includes("TP_LIMIT"),   "지정가형 익절이 남았다");
  await h.close();
});

test("전량 청산 — 알고 주문은 algoId로 취소한다", async () => {
  const h = await mountRoute("routes/close.js", {
    binance: exchange({
      algo: [{ algoId: "A1", orderType: "STOP_MARKET", side: "SELL", positionSide: "LONG" }],
    }),
  });
  await h.request("POST", "/", { side: "LONG", quantity: "0.05" });
  const algoCancel = h.rec.cancels.find(c => c.isAlgo);
  assert.ok(algoCancel, "알고 주문을 안 지웠다");
  assert.equal(String(algoCancel.algoId), "A1");
  await h.close();
});

// ── 부분 청산 ──────────────────────────────────────────────────────────────
test("부분 청산 — 분할 TP를 잔여 비율로 다시 건다", async () => {
  const h = await mountRoute("routes/close.js", {
    binance: exchange({
      open: [limit("T1", "SELL", "LONG", 85000, 0.06),
             limit("T2", "SELL", "LONG", 90000, 0.04)],
      pos:  [position("LONG", 0.10)],
    }),
  });
  const r = await h.request("POST", "/", { side: "LONG", quantity: "0.05", partial: true });
  assert.equal(r.status, 200);
  assert.deepEqual(ids(h.rec).sort(), ["T1", "T2"], "옛 분할 TP를 안 지웠다");

  // 절반 청산 → 남은 0.05를 6:4로 → 0.03 / 0.02
  const placed = h.rec.calls.filter(c => c.path === "/fapi/v1/order" && c.params.type === "LIMIT");
  assert.equal(placed.length, 2, "분할 TP 재등록 개수가 다르다");
  const byPrice = Object.fromEntries(placed.map(c => [String(c.params.price), Number(c.params.quantity)]));
  assert.equal(byPrice["85000"], 0.03);
  assert.equal(byPrice["90000"], 0.02);
  assert.ok(placed.every(c => c.params.positionSide === "LONG"));
  await h.close();
});

test("부분 청산 — 포지션 크기를 못 읽으면 **분할 TP를 손대지 않는다**", async () => {
  // ⚠ 예전엔 취소부터 하고 재등록은 `originalSize > 0` 가드에 막혀 건너뛰었다
  //   → **분할 TP가 통째로 사라졌다.** 되돌릴 근거가 없으면 손대지 않는 쪽이 안전하다
  const h = await mountRoute("routes/close.js", {
    binance: exchange({
      open: [limit("T1", "SELL", "LONG", 85000, 0.06)],
      pos:  [],                                    // 포지션을 못 읽었다
    }),
  });
  const r = await h.request("POST", "/", { side: "LONG", quantity: "0.05", partial: true });
  assert.equal(r.status, 200);
  assert.deepEqual(ids(h.rec), [], "근거도 없이 분할 TP를 지웠다");
  assert.ok(h.rec.alerts.some(a => a.level === "notice" && /분할 TP/.test(a.msg)),
    "조용히 넘어갔다 — 화면에서 알 방법이 없다");
  await h.close();
});

test("부분 청산 — 반대쪽 분할 TP는 건드리지 않는다", async () => {
  const h = await mountRoute("routes/close.js", {
    binance: exchange({
      open: [limit("LONG_TP",  "SELL", "LONG",  85000, 0.06),
             limit("SHORT_TP", "BUY",  "SHORT", 60000, 0.06)],
      pos:  [position("LONG", 0.10), position("SHORT", 0.10)],
    }),
  });
  await h.request("POST", "/", { side: "LONG", quantity: "0.05", partial: true });
  assert.deepEqual(ids(h.rec), ["LONG_TP"], "숏 분할 TP까지 지웠다");
  await h.close();
});

test("부분 청산 — 큰 조각부터 처리한다 (가격 내림차순)", async () => {
  // ⚠ 바이낸스 openOrders는 순서를 보장하지 않는데, 재계산이 반올림 초과분을
  //   뒤에서부터 깎으므로 순서가 결과를 좌우한다 (페이퍼·화면과 맞춰야 한다)
  const h = await mountRoute("routes/close.js", {
    binance: exchange({
      open: [limit("LOW", "SELL", "LONG", 80000, 0.03),
             limit("HIGH", "SELL", "LONG", 95000, 0.03),
             limit("MID",  "SELL", "LONG", 88000, 0.04)],
      pos:  [position("LONG", 0.10)],
    }),
  });
  await h.request("POST", "/", { side: "LONG", quantity: "0.05", partial: true });
  const prices = h.rec.calls
    .filter(c => c.path === "/fapi/v1/order" && c.params.type === "LIMIT")
    .map(c => Number(c.params.price));
  assert.deepEqual(prices, [...prices].sort((a, b) => b - a), `내림차순이 아니다: ${prices}`);
  await h.close();
});

// ── 심볼 단위 (수량 0 주문을 막는다) ───────────────────────────────────────
test("DOGE(수량 단위 1) — 재등록 수량이 정수이고 0이 아니다", async () => {
  // ⚠ step을 0.001로 계산하면 0.5짜리가 최소 수량 필터를 통과한 뒤 roundQty에서
  //   0으로 내려가 **수량 0 주문**이 나간다
  const h = await mountRoute("routes/close.js", {
    binance: exchange({
      open: [limit("D1", "SELL", "LONG", 0.09, 60),
             limit("D2", "SELL", "LONG", 0.10, 41)],
      pos:  [position("LONG", 101)],
    }),
  });
  const r = await h.request("POST", "/", {
    side: "LONG", quantity: "50", partial: true, symbol: "DOGEUSDT",
  });
  assert.equal(r.status, 200);
  const placed = h.rec.calls.filter(c => c.path === "/fapi/v1/order" && c.params.type === "LIMIT");
  assert.ok(placed.length > 0, "재등록이 아예 없다");
  for (const c of placed) {
    const q = Number(c.params.quantity);
    assert.ok(q > 0, `수량 0 주문이 나갔다: ${JSON.stringify(c.params)}`);
    assert.equal(q, Math.round(q), `DOGE인데 소수 수량이다: ${q}`);
    assert.equal(c.params.symbol, "DOGEUSDT");
  }
  await h.close();
});

// ── 실패했을 때 ────────────────────────────────────────────────────────────
test("시장가 청산이 실패하면 500과 사유를 돌려준다", async () => {
  const h = await mountRoute("routes/close.js", {
    binance: exchange({ pos: [position("LONG", 0.1)], orderFails: true }),
  });
  const r = await h.request("POST", "/", { side: "LONG", quantity: "0.05" });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /2019/);
  assert.ok(h.rec.logs.some(l => l.event === "POSITION_CLOSE_FAILED"), "실패를 안 남겼다");
  await h.close();
});

test("같은 사이드 청산이 겹치면 409 — 잔여 수량 계산이 꼬인다", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const h = await mountRoute("routes/close.js", {
    // ⚠ 게이트는 **롱에만** 건다 — 숏까지 막으면 아래 "반대 사이드" 확인이 영영 안 끝난다
    binance: async (method, p, params) => {
      if (p === "/fapi/v1/order") {
        if (params.positionSide === "LONG") await gate;
        return { data: { orderId: "1" } };
      }
      return { data: [] };
    },
  });
  const first = h.request("POST", "/", { side: "LONG", quantity: "0.05" });
  await new Promise(r => setTimeout(r, 30));
  const second = await h.request("POST", "/", { side: "LONG", quantity: "0.05" });
  assert.equal(second.status, 409, "겹친 청산이 통과했다");
  // 반대 사이드는 막히지 않는다
  const other = await h.request("POST", "/", { side: "SHORT", quantity: "0.05" });
  assert.notEqual(other.status, 409, "반대 사이드까지 막았다");
  release();
  await first;
  await h.close();
});

test("응답의 orderId는 **문자열**이다 (19자리가 뭉개지면 안 된다)", async () => {
  const h = await mountRoute("routes/close.js", {
    binance: async (method, p) => p === "/fapi/v1/order"
      ? { data: { orderId: "8389766268995766668", status: "FILLED" } }
      : { data: [] },
  });
  const r = await h.request("POST", "/", { side: "LONG", quantity: "0.05" });
  assert.equal(typeof r.body.orderId, "string");
  assert.equal(r.body.orderId, "8389766268995766668", "주문번호가 뭉개졌다");
  await h.close();
});
