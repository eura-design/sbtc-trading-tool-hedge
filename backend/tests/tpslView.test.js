// TP/SL 분류 — `GET /api/tpsl`(심볼 하나)과 `GET /api/positions`(계정 전체)가 **같이 쓴다**
//
// 이 판정이 틀리면 화면의 손절선이 엉뚱한 주문을 가리키고, 그 선을 끌었을 때
// `saveTpsl`이 **부분 손절을 취소 대상으로 실어 보낸다** (손절이 조용히 지워진다).
// 두 라우트가 같은 함수를 쓰는지를 지키는 것이 이 파일의 목적이다 —
// 복사해서 두 벌이 되면 일반 카드와 하늘색 카드가 다른 손절 가격을 보여준다.

const test   = require("node:test");
const assert = require("node:assert/strict");
const { presetTpslIds, buildTpslView } = require("../utils/tpslView");

// 전량 손절 (closePosition:true — 수량을 안 적는다)
const fullSl  = (id, price, positionSide = "LONG") =>
  ({ orderId: id, type: "STOP_MARKET", positionSide, stopPrice: String(price), closePosition: true });
// 부분 손절 (수량 지정)
const partSl  = (id, price, qty, positionSide = "LONG") =>
  ({ orderId: id, type: "STOP_MARKET", positionSide, stopPrice: String(price), origQty: String(qty) });
const fullTp  = (id, price, positionSide = "LONG") =>
  ({ orderId: id, type: "TAKE_PROFIT_MARKET", positionSide, stopPrice: String(price), closePosition: true });
// 분할 TP — 청산 방향 LIMIT (SELL/LONG = 롱 청산)
const splitTp = (id, price, qty, side = "SELL", positionSide = "LONG") =>
  ({ orderId: id, type: "LIMIT", side, positionSide, price: String(price), origQty: String(qty),
     status: "NEW", reduceOnly: true });

test("전량 손절과 부분 손절을 가른다 — 순서에 휘둘리지 않는다", () => {
  // ⚠ 부분 손절을 **먼저** 준다. 종류만 보고 첫 번째를 집으면 여기서 틀린다
  const v = buildTpslView([partSl("11", 64000, 0.5), fullSl("22", 63000)], []);
  assert.equal(v.long.sl.orderId, "22");
  assert.equal(v.long.sl.price, 63000);
  assert.equal(v.long.partialSls.length, 1);
  assert.equal(v.long.partialSls[0].orderId, "11");
  assert.equal(v.long.partialSls[0].qty, 0.5);
});

test("바이낸스 앱에서 건 지정가형 TP/SL도 찾는다", () => {
  // 우리가 거는 건 늘 `_MARKET`이지만 앱에서 붙인 것은 `STOP`/`TAKE_PROFIT`일 수 있다
  const v = buildTpslView([
    { orderId: "31", type: "STOP",        positionSide: "LONG", stopPrice: "62000", closePosition: true },
    { orderId: "32", type: "TAKE_PROFIT", positionSide: "LONG", stopPrice: "70000", closePosition: true },
  ], []);
  assert.equal(v.long.sl.orderId, "31");
  assert.equal(v.long.tp.orderId, "32");
});

test("미체결 진입에 미리 걸어 둔 TP/SL은 감춘다", () => {
  // 그 가격은 플랜 박스가 이미 보여준다 — 같이 그리면 같은 값이 두 번 뜬다
  const entries = [["100", { status: "WATCHING", presetTpsl: { tp: { orderId: "41" }, sl: { orderId: "42" } } }]];
  const presetIds = presetTpslIds(entries);
  assert.deepEqual([...presetIds].sort(), ["41", "42"]);
  const v = buildTpslView([fullSl("42", 61000), fullTp("41", 71000)], [], { presetIds });
  assert.equal(v.long.sl, null);
  assert.equal(v.long.tp, null);
});

test("체결된 뒤(WATCHING이 아니면) 그 기록은 감추지 않는다", () => {
  const entries = [["100", { status: "TPSL_PLACED", presetTpsl: { sl: { orderId: "42" } } }]];
  assert.equal(presetTpslIds(entries).size, 0);
});

test("분할 TP는 주문 방향으로 롱·숏을 가른다", () => {
  const v = buildTpslView([
    splitTp("51", 70000, 0.1, "SELL", "LONG"),
    splitTp("52", 60000, 0.2, "BUY",  "SHORT"),
  ], []);
  assert.equal(v.long.splitTps.length, 1);
  assert.equal(v.long.splitTps[0].orderId, "51");
  assert.equal(v.short.splitTps.length, 1);
  assert.equal(v.short.splitTps[0].orderId, "52");
});

test("등록 당시 비율은 부르는 쪽이 준다 — 외부 주문은 null", () => {
  const v = buildTpslView([splitTp("61", 70000, 0.1)], [],
    { pctOf: (id) => (id === "61" ? 50 : null) });
  assert.equal(v.long.splitTps[0].pct, 50);
  const v2 = buildTpslView([splitTp("61", 70000, 0.1)], []);
  assert.equal(v2.long.splitTps[0].pct, null);
});

test("algo 주문은 positionSide가 없으면 청산 방향으로 가른다", () => {
  const v = buildTpslView([], [
    { algoId: "71", orderType: "STOP_MARKET", side: "SELL", triggerPrice: "62000", closePosition: true },
  ]);
  assert.equal(v.long.sl.orderId, "71");   // SELL = 롱 청산
  assert.equal(v.long.sl.isAlgo, true);
  assert.equal(v.short.sl, null);
});

test("주문이 없으면 네 칸이 다 비어 있다", () => {
  const v = buildTpslView([], []);
  for (const key of ["long", "short"]) {
    assert.equal(v[key].tp, null);
    assert.equal(v[key].sl, null);
    assert.deepEqual(v[key].splitTps, []);
    assert.deepEqual(v[key].partialSls, []);
  }
});

test("주문번호는 언제나 문자열이다 — ETH의 19자리를 숫자로 다루면 뭉개진다", () => {
  const v = buildTpslView([fullSl(8389766268995766668n.toString(), 3000)], []);
  assert.equal(typeof v.long.sl.orderId, "string");
  assert.equal(v.long.sl.orderId, "8389766268995766668");
});
