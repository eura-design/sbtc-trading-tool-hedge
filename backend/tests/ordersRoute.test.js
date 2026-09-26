// DELETE /api/orders — 미체결 진입 주문 취소
//
// ⚠ **이 라우트는 store를 지운다.** 무엇을 지우는지가 틀리면 살아 있는 주문의 기록이
//   없어지고, 그 주문이 체결될 때 TP/SL을 걸 근거가 사라진다 (사전 등록분만 남아
//   보호가 한 겹 얇아진다).
//
// 실측 2026-09-27: 이더리움 층을 취소했더니 **비트코인 층 3개의 기록이 사라졌다.**
//   `openOrders`는 요청한 심볼의 목록인데 `store.entries()`는 계정 전체를 돌기 때문이다.
//   (`routes/tpsl.js`의 분할 TP 정리에 있던 것과 같은 종류의 실수다.)

const test   = require("node:test");
const assert = require("node:assert/strict");
const { mountRoute } = require("./helpers/routeHarness");

// 하네스 기본 표에는 ETHUSDT가 없다 — 두 코인을 같이 봐야 하는 시험이라 넣어 준다
const SYMBOLS = {
  BTCUSDT: { stepSize: "0.001", minQty: "0.001", tickSize: "0.10", minNotional: "50" },
  ETHUSDT: { stepSize: "0.001", minQty: "0.001", tickSize: "0.01", minNotional: "20" },
};

/** 미체결 진입 지정가 (숏) */
const entryOrder = (id, price, symbol = "BTCUSDT") => ({
  orderId: id, symbol, type: "LIMIT", status: "NEW",
  side: "SELL", positionSide: "SHORT", price: String(price), origQty: "0.001",
});
const watching = (symbol, price) => ({ status: "WATCHING", symbol, side: "SELL",
  tp: 50000, sl: 99000, price });

test("⚠ 다른 코인의 WATCHING 기록을 지우지 않는다 (실측 재현)", async () => {
  const h = await mountRoute("routes/orders.js", {
    symbols: SYMBOLS,
    // 이더리움 주문 하나를 취소한다 — 조회도 이더리움 것만 온다
    binance: async (m, p, params) => {
      if (p.includes("openOrders")) {
        return { data: params?.symbol === "ETHUSDT" ? [entryOrder("E1", 3000, "ETHUSDT")] : [] };
      }
      if (p.includes("positionRisk")) return { data: [] };
      return { data: {} };
    },
    store: {
      E1: watching("ETHUSDT", 3000),
      // 비트코인 층 3개 — 거래소에 **살아 있다**. 건드리면 안 된다
      B1: watching("BTCUSDT", 96256.3),
      B2: watching("BTCUSDT", 97000),
      B3: watching("BTCUSDT", 98000),
    },
  });
  try {
    const r = await h.request("DELETE", "/", { orderId: "E1", symbol: "ETHUSDT" });
    assert.equal(r.status, 200);
    assert.equal(r.body.cancelled, 1);
    assert.equal(h.store.has("E1"), false, "취소한 주문의 기록은 지운다");
    for (const id of ["B1", "B2", "B3"]) {
      assert.ok(h.store.has(id),
        `${id}(비트코인 층)의 기록이 사라졌다 — 체결되면 TP/SL을 걸 근거가 없다`);
    }
  } finally { await h.close(); }
});

test("같은 코인의 **거래소에 없는** WATCHING 기록은 예전처럼 정리한다", async () => {
  const h = await mountRoute("routes/orders.js", {
    binance: async (m, p) => {
      if (p.includes("openOrders")) return { data: [entryOrder("B1", 96256.3)] };
      if (p.includes("positionRisk")) return { data: [] };
      return { data: {} };
    },
    store: {
      B1: watching("BTCUSDT", 96256.3),
      // 거래소에 없다 (이미 체결·취소됐다) → 정리 대상
      GHOST: watching("BTCUSDT", 95000),
    },
  });
  try {
    await h.request("DELETE", "/", { orderId: "B1", symbol: "BTCUSDT" });
    assert.equal(h.store.has("B1"), false);
    assert.equal(h.store.has("GHOST"), false, "같은 코인의 유령 기록은 지운다 (회귀)");
  } finally { await h.close(); }
});

test("0건 취소도 성공으로 답한다 — `cancelled`가 0이다 (회귀)", async () => {
  const h = await mountRoute("routes/orders.js", {
    binance: async (m, p) => {
      if (p.includes("openOrders")) return { data: [] };
      if (p.includes("positionRisk")) return { data: [] };
      return { data: {} };
    },
  });
  try {
    const r = await h.request("DELETE", "/", { orderId: "없는주문", symbol: "BTCUSDT" });
    assert.equal(r.status, 200);
    assert.equal(r.body.cancelled, 0);
  } finally { await h.close(); }
});
