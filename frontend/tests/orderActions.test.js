// 주문 액션 — 실제로 어떤 요청이 나가는가
//
// ⚠ **여기가 틀리면 실제 돈이 잘못 나간다.** 액션이 18개인데 각각
//   경로·본문·순서가 다르고, 실패했을 때의 뒷수습도 다르다.
//
// 이 파일이 보는 것 (문구가 아니라 **나간 요청**):
//   · 어느 경로에 어떤 본문이 갔는가
//   · **순서** — 특히 분할 SL 이동은 "새로 걸고 나서 취소"여야 한다
//   · 실패했을 때 **보호가 줄지 않는가** (손절이 사라지지 않는가)
//   · 리플레이 중에는 **실주문이 한 건도 안 나가는가**
//
// ⚠ api()를 목으로 갈지 않는다 — `globalThis.fetch`만 갈아끼워 **진짜 api()**를 태운다.
//   심볼 자동 첨부·리플레이 가드가 함께 검산된다 (목으로 만들면 그게 다 빠진다)

import test from "node:test";
import assert from "node:assert/strict";
import { createOrderSlice } from "../src/store/orderSlice.js";
import { setApiSymbol, setReplayGuard } from "../src/api/client.js";

setApiSymbol("TESTUSDT");

// ── 하네스 ─────────────────────────────────────────────────────────────────
const calls = [];            // 나간 요청 (로그 전송은 뺀다)
let failFor = () => null;    // 테스트마다 갈아끼운다
let cancelledCount = 1;      // DELETE /api/orders가 돌려줄 취소 건수 (0건 경로를 시험하려고 둔다)

globalThis.fetch = async (url, opt = {}) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, "");
  if (path.startsWith("/api/log")) return { ok: true, json: async () => ({}) };
  const body = opt.body ? JSON.parse(opt.body) : null;
  const rec = { method: opt.method, path, body };
  calls.push(rec);
  const fail = failFor(rec);
  if (fail) return { ok: false, status: 400, text: async () => JSON.stringify({ error: fail }) };
  // ⚠ `DELETE /api/orders`는 실제로 **`{ success, cancelled: <건수> }`**를 돌려준다
  //   (`backend/routes/orders.js`). 여기서 `cancelled`를 안 주면 `deleteBox`가 0건으로 보고
  //   조기 반환해서, **성공 경로를 아무 테스트도 밟지 않는다.** 실제 모양을 흉내낼 것
  if (rec.method === "DELETE" && path.startsWith("/api/orders"))
    return { ok: true, status: 200, json: async () => ({ success: true, cancelled: cancelledCount }) };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

/** 최소 스토어 — 액션이 실제로 읽는 것만 담는다 */
function harness(over = {}) {
  calls.length = 0;
  failFor = over.failFor ?? (() => null);
  cancelledCount = over.cancelledCount ?? 1;
  const status = [];
  let state = {
    replayOn: false,
    symbolFilters: { step: 0.001, minQty: 0.001, tick: 0.1, minNotional: 100 },
    position: null, tpsl: { long: {}, short: {} }, balance: null, drawings: {},
    leverage: 10,
    // ⚠ 진짜 스토어처럼 **`orderStatus`에도 담는다** — `placeSplitOrders`가 멈춘 이유를
    //   그 값에서 읽어 최종 문구에 붙인다. 안 담으면 그 경로를 아무 테스트도 못 본다
    setOrderStatus: (s) => { if (s) status.push(s); state.orderStatus = s; },
    setTpsl: () => {}, setPosition: () => {}, setDrawing: () => {},
    _refetchBal: () => {}, _refetchPos: () => {}, _refetchTpsl: () => {},
    ...over,
  };
  const get = () => state;
  const set = (patch) => {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  };
  const slice = createOrderSlice(set, get);
  // ⚠ 액션도 **스토어 안에** 넣는다 — 진짜 스토어가 그렇다. `placeSplitOrders`는
  //   `get()`에서 `scaleIn`·`addSplitTp`·`addPartialSl`을 꺼내 부르는데, 여기 없으면
  //   undefined를 불러 터진다. (그래서 그 경로를 시험하는 테스트가 전에는 하나도 없었다)
  state = { ...state, ...slice };
  return { ...slice, _status: status };
}

const only  = (method, path) => calls.filter(c => c.method === method && c.path.startsWith(path));
const paths = () => calls.map(c => `${c.method} ${c.path}`);
const lastErr = (s) => s._status.filter(x => x.type === "error").at(-1)?.msg ?? "";
const lastOk  = (s) => s._status.filter(x => x.type === "success").at(-1)?.msg ?? "";

// ── 경로와 본문 ────────────────────────────────────────────────────────────
test("추가 진입 — 포지션 방향(LONG)을 주문 방향(BUY)으로 바꿔 보낸다", async () => {
  const s = harness();
  assert.equal(await s.scaleIn("LONG", "LIMIT", 100, 1), true);
  const [c] = only("POST", "/api/scale-in");
  assert.equal(c.body.side, "BUY", "LONG인데 BUY가 안 나갔다");
  assert.equal(c.body.orderType, "LIMIT");
  assert.equal(c.body.price, 100);

  const t = harness();
  await t.scaleIn("SHORT", "MARKET", null, 1);
  assert.equal(only("POST", "/api/scale-in")[0].body.side, "SELL");
});

test("분할 TP·분할 SL은 **포지션 방향 그대로** 보낸다 (바꾸지 않는다)", async () => {
  const s = harness();
  await s.addSplitTp("LONG", 110, 1, 50);
  assert.equal(only("POST", "/api/tpsl/split")[0].body.side, "LONG");
  const t = harness();
  await t.addPartialSl("SHORT", 110, 1);
  assert.equal(only("POST", "/api/tpsl/partial-sl")[0].body.side, "SHORT");
});

test("청산 수량은 **문자열**로 보낸다 — 지수표기(1e-7)로 나가면 거래소가 거절한다", async () => {
  const s = harness();
  await s.closePosition("LONG", 0.001, true);
  const [c] = only("POST", "/api/close");
  assert.equal(typeof c.body.quantity, "string");
  assert.equal(c.body.partial, true);
});

// ── 순서: 손절은 **새로 걸고 나서** 옛것을 지운다 ──────────────────────────
test("분할 SL 이동 — 새로 걸고 나서 취소한다 (순서를 뒤집으면 손절이 사라진다)", async () => {
  const s = harness({
    tpsl: { long: { partialSls: [{ orderId: "A", qty: 1, positionSide: "LONG" }] }, short: {} },
  });
  await s.movePartialSl("A", 95);
  assert.deepEqual(paths(), ["POST /api/tpsl/partial-sl", "DELETE /api/tpsl/partial-sl"],
    "취소가 먼저 나갔다 — 거절당하면 손절이 사라진다");
});

test("분할 SL 이동이 거절당하면 **옛 손절이 그대로 남는다**", async () => {
  const s = harness({
    tpsl: { long: { partialSls: [{ orderId: "A", qty: 1, positionSide: "LONG" }] }, short: {} },
    failFor: (c) => c.method === "POST" ? "-2021 주문이 즉시 체결됩니다" : null,
  });
  await s.movePartialSl("A", 95);
  assert.equal(only("DELETE", "/api/tpsl/partial-sl").length, 0,
    "새 손절이 실패했는데 옛것을 지웠다");
  assert.match(lastErr(s), /기존 손절은 그대로/);
});

test("분할 TP 이동은 반대다 — 취소가 먼저다 (익절이라 사라져도 위험하지 않다)", async () => {
  const s = harness({
    tpsl: { long: { splitTps: [{ orderId: "A", side: "SELL", qty: 1, pct: 50 }] }, short: {} },
  });
  await s.moveSplitTp("A", 110);
  assert.deepEqual(paths(), ["DELETE /api/tpsl/split", "POST /api/tpsl/split"]);
  // 청산 방향(SELL)을 포지션 방향(LONG)으로 되돌려 보낸다
  assert.equal(only("POST", "/api/tpsl/split")[0].body.side, "LONG");
});

// ── 없는 주문은 건드리지 않는다 ────────────────────────────────────────────
test("목록에 없는 주문번호면 요청을 아예 안 보낸다", async () => {
  for (const [name, run] of [
    ["movePartialSl", (s) => s.movePartialSl("없음", 95)],
    ["moveSplitTp",   (s) => s.moveSplitTp("없음", 110)],
    ["moveScaleIn",   (s) => s.moveScaleIn("없음", 95)],
  ]) {
    const s = harness({ position: { scaleInOrders: [] } });
    await run(s);
    assert.equal(calls.length, 0, `${name}이 엉뚱한 요청을 보냈다`);
  }
});

test("단일 TP/SL 제거 — 주문번호가 없으면 안 보낸다", async () => {
  const s = harness({ tpsl: { long: {}, short: {} } });
  await s.cancelTpsl("LONG", "sl");
  assert.equal(calls.length, 0);

  const t = harness({ tpsl: { long: { sl: { orderId: "S1", isAlgo: true } }, short: {} } });
  await t.cancelTpsl("LONG", "sl");
  assert.deepEqual(only("DELETE", "/api/tpsl")[0].body,
    { orderId: "S1", isAlgo: true, symbol: "TESTUSDT" });
  assert.match(lastOk(t), /LONG SL/, "어느 쪽 손절이 지워졌는지 안 밝힌다");
});

// ── 전체 취소: 중간에 실패해도 멈추지 않는다 ───────────────────────────────
test("전체 취소 — 한 건이 실패해도 나머지를 계속 지우고, 몇 개인지 밝힌다", async () => {
  const s = harness({
    tpsl: { long: { splitTps: [{ orderId: "1" }, { orderId: "2" }, { orderId: "3" }] }, short: {} },
    failFor: (c) => c.body?.orderId === "2" ? "-2011 주문을 찾을 수 없습니다" : null,
  });
  await s.cancelSplitOrders("split_tp", "LONG");
  assert.equal(only("DELETE", "/api/tpsl/split").length, 3,
    "실패한 뒤 멈췄다 — 주문이 남는다");
  assert.match(lastErr(s), /3개 중 2개 취소 — 1개 실패/);
});

test("전체 취소 — 다 지워지면 개수를 말한다", async () => {
  const s = harness({
    tpsl: { long: { partialSls: [{ orderId: "1" }, { orderId: "2" }] }, short: {} },
  });
  await s.cancelSplitOrders("partial_sl", "LONG");
  assert.match(lastOk(s), /분할 SL 2개 취소 완료/);
});

test("전체 취소 — 추가 진입만 **주문 방향**으로 걸러낸다", async () => {
  const s = harness({ position: { scaleInOrders: [
    { orderId: "L1", side: "BUY" }, { orderId: "S1", side: "SELL" }, { orderId: "L2", side: "BUY" },
  ] } });
  await s.cancelSplitOrders("scale_in", "LONG");
  assert.deepEqual(only("DELETE", "/api/scale-in").map(c => c.body.orderId), ["L1", "L2"],
    "숏 추가진입까지 지웠다");
});

test("지울 게 없으면 아무 요청도 안 나간다", async () => {
  const s = harness({ position: { scaleInOrders: [] }, tpsl: { long: {}, short: {} } });
  for (const k of ["scale_in", "split_tp", "partial_sl"]) await s.cancelSplitOrders(k, "LONG");
  assert.equal(calls.length, 0);
});

// ── 박스 삭제 ──────────────────────────────────────────────────────────────
test("박스 삭제 — 미체결이 있으면 **그 주문번호로만** 취소한다", async () => {
  // ⚠ 사이드로만 지우면 밖에서 낸 같은 사이드 주문까지 날아간다
  const s = harness({
    drawings: { long: { isLong: true } },
    position: { pending: { long: { orderId: "P1" }, short: { orderId: "P2" } } },
  });
  await s.deleteBox("LONG");
  const [c] = only("DELETE", "/api/orders");
  assert.equal(c.body.orderId, "P1");
  assert.equal(c.body.side, "LONG");
});

test("박스 삭제 — 반대쪽 미체결은 건드리지 않는다", async () => {
  // 숏 주문이 걸려 있어도 롱 박스 삭제는 취소 요청을 내지 않는다
  const s = harness({
    drawings: { long: { isLong: true } },
    position: { pending: { long: null, short: { orderId: "P2" } } },
  });
  await s.deleteBox("LONG");
  assert.equal(calls.length, 0, "숏 주문 때문에 롱 박스 삭제가 취소를 불렀다");
});

test("박스 삭제 — 취소가 실패하면 박스를 안 지운다", async () => {
  let cleared = false;
  const s = harness({
    drawings: { long: { isLong: true } },
    position: { pending: { long: { orderId: "P1" } } },
    setDrawing: () => { cleared = true; },
    failFor: () => "-2011",
  });
  await s.deleteBox("LONG");
  assert.equal(cleared, false,
    "주문이 살아 있는데 박스만 사라졌다 — 취소할 길이 없어진다");
});

test("박스 삭제 — 취소가 되면 박스를 지우고 알린다", async () => {
  let cleared = false;
  const s = harness({
    drawings: { long: { isLong: true } },
    position: { pending: { long: { orderId: "P1" } } },
    setDrawing: () => { cleared = true; },
  });
  await s.deleteBox("LONG");
  assert.equal(cleared, true, "취소됐는데 박스가 남았다");
  assert.equal(lastOk(s), "미체결 주문 취소 완료");
});

test("⚠ 박스 삭제 — **0건 취소**면 아무 말도 하지 않고 박스도 남긴다", async () => {
  // 클릭 직전에 그 주문이 체결되거나 바이낸스에서 취소된 경우다. 백엔드는
  // `{ success: true, cancelled: 0 }`으로 **성공**한다 — 그때 "취소 완료"라고 알리면
  // 화면이 거짓말을 하고, 다음 폴링(30초)에 주문이 되돌아온다
  let cleared = false;
  const s = harness({
    drawings: { long: { isLong: true } },
    position: { pending: { long: { orderId: "P1" } } },
    setDrawing: () => { cleared = true; },
    cancelledCount: 0,
  });
  await s.deleteBox("LONG");
  assert.equal(only("DELETE", "/api/orders").length, 1, "요청은 나갔어야 한다");
  assert.equal(lastOk(s), "", "0건인데 '취소 완료'라고 알렸다");
  assert.equal(cleared, false, "0건인데 박스를 지웠다 — 주문이 살아 있는데 취소할 길이 없어진다");
});

// ── 심볼 ───────────────────────────────────────────────────────────────────
test("모든 요청에 지금 심볼이 실린다 — 하나라도 빠지면 BTC로 나간다", async () => {
  const s = harness({
    position: { scaleInOrders: [] },
    tpsl: { long: { partialSls: [{ orderId: "A", qty: 1, positionSide: "LONG" }] }, short: {} },
  });
  await s.scaleIn("LONG", "MARKET", null, 1);
  await s.addSplitTp("LONG", 110, 1, 50);
  await s.addPartialSl("LONG", 90, 1);
  await s.cancelSplitTp("X");
  await s.cancelPartialSl("Y");
  await s.cancelScaleIn("Z");
  await s.closePosition("LONG", 1);
  await s.movePartialSl("A", 95);
  assert.ok(calls.length >= 8);
  for (const c of calls)
    assert.equal(c.body?.symbol, "TESTUSDT", `${c.method} ${c.path}에 심볼이 없다`);
});

// ── 리플레이: 실주문이 한 건도 안 나간다 ───────────────────────────────────
test("리플레이 중에는 실주문이 **한 건도** 안 나간다", async () => {
  setReplayGuard(true);
  const s = harness({
    replayOn: true,
    position: { scaleInOrders: [{ orderId: "A", side: "BUY", qty: 1 }],
                pending: { long: { orderId: "P1" } } },
    drawings: { long: { isLong: true, orderId: "P1", tp: 110, sl: 90 } },
    tpsl: { long: { splitTps:   [{ orderId: "T", side: "SELL", qty: 1, pct: 50 }],
                    partialSls: [{ orderId: "S", qty: 1, positionSide: "LONG" }],
                    sl: { orderId: "SL1" } }, short: {} },
  });
  const run = [
    () => s.scaleIn("LONG", "MARKET", null, 1), () => s.cancelScaleIn("A"),
    () => s.moveScaleIn("A", 95),               () => s.addSplitTp("LONG", 110, 1, 50),
    () => s.cancelSplitTp("T"),                 () => s.moveSplitTp("T", 111),
    () => s.addPartialSl("LONG", 90, 1),        () => s.cancelPartialSl("S"),
    () => s.movePartialSl("S", 91),             () => s.closePosition("LONG", 1),
    () => s.cancelTpsl("LONG", "sl"),           () => s.deleteBox("LONG"),
    () => s.cancelSplitOrders("split_tp", "LONG"), () => s.updatePendingTpsl(true),
    () => s.saveTpsl(110, 90, "LONG"),
  ];
  for (const f of run) { try { await f(); } catch { /* 페이퍼가 거절해도 된다 */ } }
  assert.deepEqual(calls, [], `리플레이 중에 실주문이 나갔다: ${JSON.stringify(paths())}`);
  setReplayGuard(false);
});

test("가드가 켜져 있으면 api()가 막는다 (위임을 빠뜨려도 나가지 않는다)", async () => {
  // ⚠ 2겹 방어의 바깥쪽 — 새 액션에 페이퍼 위임을 안 넣어도 실주문은 막힌다
  setReplayGuard(true);
  const s = harness({ replayOn: false });   // 위임을 빠뜨린 상태를 흉내낸다
  await s.closePosition("LONG", 1);
  assert.deepEqual(calls, [], "가드를 뚫고 나갔다");
  assert.match(lastErr(s), /리플레이/);
  setReplayGuard(false);
});

// ── 추가 진입 분할 — 거래소 최소 주문 금액 (2026-09-27) ─────────────────────
//
// 실측: 조각이 최소 금액에 모자라 **5개 중 0개**가 나갔다. 이제 모자란 조각은 **최소로
// 올려서** 보낸다 (사용자 결정 — 막지 않는다). 분할 TP·SL은 reduceOnly라 올리지 않는다

test("추가 진입 조각이 최소에 모자라면 **최소로 올려서** 요청한 개수대로 보낸다", async () => {
  // 실측 재현(SOL): 포지션 0.05의 50% = 0.02를 5분할 → 조각 0.004라 거래소가 전부 거절했다.
  // 최소 금액 $5, 단위 0.01, 층 가격 ~120 → 조각 최소 0.05
  const s = harness({
    liveClose: 121.4,
    symbolFilters: { step: 0.01, minQty: 0.01, tick: 0.01, minNotional: 5 },
    position: { short: { size: 0.05, entryPrice: 121.53 } },
  });
  // 숏 추가 진입은 현재가 **위** — 122 ~ 130 사이 5개
  await s.placeSplitOrders("scale_in", "SHORT", 122, 130, 5, 0.02);
  const sent = only("POST", "/api/scale-in");
  assert.equal(sent.length, 5, "개수가 줄면 안 된다 — splitPlan은 단위가 모자라면 조각을 조용히 뺀다");
  for (const c of sent) {
    assert.ok(c.body.quantity * c.body.price >= 5,
      `${c.body.quantity} × ${c.body.price} = $${(c.body.quantity * c.body.price).toFixed(2)} — 최소 금액 미달`);
  }
  assert.match(lastOk(s), /5개 등록 완료/);
});

test("⚠ 롱은 **가장 싼 층**으로 최소를 잰다 — 아래 층일수록 금액이 작아서다", async () => {
  // 현재가 100, 층 99 ~ 60 (롱은 아래). 최소 금액 $50 → 60에서는 0.84가 필요하다
  const s = harness({
    liveClose: 100,
    symbolFilters: { step: 0.01, minQty: 0.01, tick: 0.01, minNotional: 50 },
    position: { long: { size: 0.1, entryPrice: 100 } },
  });
  await s.placeSplitOrders("scale_in", "LONG", 99, 60, 3, 0.03);
  const sent = only("POST", "/api/scale-in");
  assert.equal(sent.length, 3);
  for (const c of sent) assert.ok(c.body.quantity * c.body.price >= 50,
    `${c.body.price}에서 $${(c.body.quantity * c.body.price).toFixed(2)} — 가장 싼 층이 미달이면 거절된다`);
});

test("최소 이상이면 **건드리지 않는다** (슬라이더가 정한 그대로)", async () => {
  const s = harness({
    liveClose: 100,
    symbolFilters: { step: 0.01, minQty: 0.01, tick: 0.01, minNotional: 5 },
    position: { long: { size: 10, entryPrice: 100 } },
  });
  await s.placeSplitOrders("scale_in", "LONG", 99, 90, 2, 2);
  const total = only("POST", "/api/scale-in").reduce((a, c) => a + c.body.quantity, 0);
  assert.equal(Number(total.toFixed(2)), 2, "최소를 이미 넘으면 총량이 그대로여야 한다");
});

test("⚠ 분할 TP는 최소 금액으로 막지 않는다 (reduceOnly — 거래소가 묻지 않는다)", async () => {
  // 같은 크기의 조각이라도 청산 주문이면 나가야 한다
  const s = harness({
    liveClose: 100,
    position: { long: { size: 1, entryPrice: 100 } },
  });
  await s.placeSplitOrders("split_tp", "LONG", 110, 120, 5, 1);
  assert.ok(only("POST", "/api/tpsl/split").length > 0,
    "분할 TP가 최소 금액 검사에 걸리면 멀쩡한 분할 익절을 못 건다");
  assert.doesNotMatch(lastErr(s), /최소 주문 금액/);
});

test("중간에 멈추면 **거래소가 말한 이유**를 개수 문구에 붙인다", async () => {
  // 두 번째 조각에서 거래소가 거절한다
  let n = 0;
  const s = harness({
    liveClose: 100,
    symbolFilters: { step: 0.001, minQty: 0.001, tick: 0.1, minNotional: 0 },
    position: { long: { size: 10, entryPrice: 100 } },
    failFor: (rec) => (rec.path.startsWith("/api/scale-in") && ++n === 2
      ? "Margin is insufficient." : null),
  });
  await s.placeSplitOrders("scale_in", "LONG", 99, 90, 3, 3);
  assert.match(lastErr(s), /3개 중 1개만 등록됐습니다/);
  assert.match(lastErr(s), /Margin is insufficient/,
    "이유가 빠지면 사용자는 왜 멈췄는지 알 수 없다");
});
