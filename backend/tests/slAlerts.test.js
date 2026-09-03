// SL 실패 배너의 문구
//
// ⚠ 2026-09-03 감사: "SL이 안 걸렸다" 배너가 **세 곳**에서 뜨는데
//   **거두는 곳이 하나도 없었다.** reconcile이 나중에 성공해도 화면에는
//   `SL 등록 실패`가 그대로 남아 거짓말을 했다.
//   무방비 경보는 이미 거두고 있었으므로, 실제로 손절이 없으면 배너가 둘 뜨고
//   복구되면 하나만 사라졌다.
//
// ⚠ **띄울 때와 거둘 때의 글자가 정확히 같아야** 프론트가 배너를 지운다.
//   그래서 문구를 한 곳에 모았고, 이 파일이 그 계약을 지킨다.

const test   = require("node:test");
const assert = require("node:assert/strict");
const slAlerts = require("../utils/slAlerts");

test("세 문구가 서로 다르다 (같으면 한 배너가 다른 것을 가린다)", () => {
  const m = slAlerts.allFor("123");
  assert.equal(new Set(m).size, 3, `중복: ${m.join(" | ")}`);
});

test("allFor가 세 문구를 **글자 그대로** 담는다", () => {
  const id = "8389766268995766668";   // 19자리 (실측 ETHUSDT)
  const all = slAlerts.allFor(id);
  assert.ok(all.includes(slAlerts.marketFilled(id)),     "진입 직후 문구 누락");
  assert.ok(all.includes(slAlerts.retryExhausted(id)),   "재시도 소진 문구 누락");
  assert.ok(all.includes(slAlerts.reRegisterFailed(id)), "재등록 실패 문구 누락");
});

test("주문번호가 문구에 그대로 들어간다 (문자열 id도)", () => {
  // 주문번호는 심볼에 따라 문자열이다 (utils/bigIntJson.js)
  const id = "8389766268995766668";
  for (const msg of slAlerts.allFor(id)) {
    assert.ok(msg.includes(id), `문구에 주문번호가 없다: ${msg}`);
    assert.ok(!msg.includes("[object"), `문구가 깨졌다: ${msg}`);
  }
  // 숫자로 넣어도 같은 글자가 나와야 한다 (거두는 쪽과 띄우는 쪽의 타입이 다를 수 있다)
  assert.equal(slAlerts.marketFilled(123), slAlerts.marketFilled("123"));
});

test("문구가 바뀌면 이 테스트가 먼저 깨진다 (배너 회수 계약)", () => {
  // 글자 하나만 달라져도 배너가 안 닫힌다 — 그래서 여기 못 박는다
  assert.equal(slAlerts.marketFilled("1"),     "⚠ 시장가 체결됐으나 SL 등록 실패 (orderId=1)");
  assert.equal(slAlerts.retryExhausted("1"),   "⚠ SL 등록 5회 실패 (orderId=1)");
  assert.equal(slAlerts.reRegisterFailed("1"), "⚠ SL 재등록 실패 (orderId=1)");
});
