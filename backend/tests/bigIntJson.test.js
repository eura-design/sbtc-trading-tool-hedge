// 큰 정수를 잃지 않는 JSON 파싱
//
// ⚠ 2026-09-02 실주문 테스트에서 나온 실제 값으로 고정한다.
//   ETHUSDT 주문번호 8389766268995766668이 8389766268995766000으로 뭉개져
//   `Order does not exist.`가 났다. 그 번호로는 취소도 조회도 안 된다.

const test   = require("node:test");
const assert = require("node:assert/strict");
const { quoteBigInts, parseBigInt } = require("../utils/bigIntJson");

// 실측값 (2026-09-02)
const REAL    = "8389766268995766668";   // ETHUSDT 주문번호 19자리
const MANGLED = 8389766268995766000;     // JSON.parse가 만든 값

test("JSON.parse는 실제로 뭉갠다 (이 파일이 있는 이유)", () => {
  const raw = `{"orderId":${REAL}}`;
  assert.equal(JSON.parse(raw).orderId, MANGLED);
  assert.notEqual(String(JSON.parse(raw).orderId), REAL);
});

test("안전 범위를 넘는 정수는 문자열로 살아남는다", () => {
  const o = parseBigInt(`{"orderId":${REAL},"symbol":"ETHUSDT"}`);
  assert.equal(o.orderId, REAL);
  assert.equal(typeof o.orderId, "string");
  assert.equal(o.symbol, "ETHUSDT");
});

test("안전 범위 안의 수는 **건드리지 않는다** — 숫자 그대로", () => {
  // BTCUSDT 주문번호(13자리)·타임스탬프·알고 주문 id(16자리)는 지금까지 숫자였다.
  // 문자열로 바뀌면 기존 동작이 조용히 달라진다
  const o = parseBigInt('{"orderId":1121692450577,"algoId":3000002170853198,"time":1788344180842,"qty":0.009}');
  assert.equal(typeof o.orderId, "number");
  assert.equal(o.orderId, 1121692450577);
  assert.equal(typeof o.algoId, "number");
  assert.equal(o.algoId, 3000002170853198);
  assert.equal(typeof o.time, "number");
  assert.equal(o.qty, 0.009);
});

test("경계값", () => {
  const max = String(Number.MAX_SAFE_INTEGER);          // 9007199254740991
  const over = "9007199254740993";                      // 그 위
  const o = parseBigInt(`{"a":${max},"b":${over}}`);
  assert.equal(typeof o.a, "number", "안전 한계값까지는 숫자여야 한다");
  assert.equal(o.b, over);
  assert.equal(typeof o.b, "string");
});

test("문자열 안의 숫자는 건드리지 않는다", () => {
  // 오류 메시지에 주문번호가 섞여 오는 일이 있다
  const raw = `{"code":-2011,"msg":"Unknown order 8389766268995766668 for symbol"}`;
  const o = parseBigInt(raw);
  assert.equal(o.msg, "Unknown order 8389766268995766668 for symbol");
  assert.equal(o.code, -2011);
});

test("배열 안에서도 산다", () => {
  const o = parseBigInt(`[{"orderId":${REAL}},{"orderId":1121692450577}]`);
  assert.equal(o[0].orderId, REAL);
  assert.equal(o[1].orderId, 1121692450577);
  // 캔들처럼 숫자만 든 배열 (타임스탬프는 13자리라 안전 범위 안)
  const k = parseBigInt('[[1788344180842,"2393.00","2394.00"]]');
  assert.equal(k[0][0], 1788344180842);
  assert.equal(typeof k[0][0], "number");
});

test("공백이 섞여도 (거래소가 pretty print를 보내는 경우)", () => {
  const o = parseBigInt(`{ "orderId" : ${REAL} , "x" : 1 }`);
  assert.equal(o.orderId, REAL);
});

test("깨진 JSON은 그대로 던진다 — 조용히 삼키지 않는다", () => {
  assert.throws(() => parseBigInt("{not json"), SyntaxError);
});

test("텍스트가 아니면 그대로 돌려준다", () => {
  assert.equal(quoteBigInts(null), null);
  assert.equal(quoteBigInts(undefined), undefined);
  const buf = Buffer.from("x");
  assert.equal(quoteBigInts(buf), buf);
});

test("실제 응답 모양 (allOrders 한 건)", () => {
  const raw = `[{"orderId":${REAL},"symbol":"ETHUSDT","status":"FILLED","type":"MARKET","side":"BUY","origQty":"0.009","avgPrice":"2393.00","updateTime":1788344181234}]`;
  const o = parseBigInt(raw)[0];
  assert.equal(o.orderId, REAL);
  assert.equal(o.origQty, "0.009");
  assert.equal(o.updateTime, 1788344181234);
  assert.equal(typeof o.updateTime, "number");
});
