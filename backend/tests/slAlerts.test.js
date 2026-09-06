// 손절이 모자랄 때 뜨는 빨간 배너의 문구
//
// ⚠ 2026-09-03 감사: "SL이 안 걸렸다" 배너가 **세 곳**에서 뜨는데
//   **거두는 곳이 하나도 없었다.** reconcile이 나중에 성공해도 화면에는
//   `SL 등록 실패`가 그대로 남아 거짓말을 했다.
//
// ⚠ 2026-09-06 통합: 그 세 문구에 `TP/SL 가격 없음`과 무방비 경보까지, 같은 사실을
//   말하는 문구가 다섯 벌이었다. 손절이 정말 없으면 **빨간 줄이 두 개** 떴다.
//   이제 코인·방향마다 한 줄이고, 이 파일이 그 계약을 지킨다.
//
// ⚠ **띄울 때와 거둘 때의 글자가 정확히 같아야** 프론트가 배너를 지운다
//   (services/pushService.js의 `pushAlertClear` 주석).

const test   = require("node:test");
const assert = require("node:assert/strict");
const slAlerts = require("../utils/slAlerts");

test("문구는 **두 가지뿐**이다 — 없다 / 일부만 덮는다", () => {
  const none    = slAlerts.naked("BTCUSDT", "LONG");
  const partial = slAlerts.naked("BTCUSDT", "LONG", "0.003", "0.004");
  assert.notEqual(none, partial, "두 상태가 같은 글자면 어느 쪽인지 화면에서 못 읽는다");
  assert.match(none,    /손절\(SL\)이 없습니다/);
  assert.match(partial, /일부만 덮습니다 \(0\.003 \/ 0\.004\)/);
});

test("코인과 방향이 문구에 들어간다 (한쪽을 거둘 때 다른 쪽까지 사라지면 안 된다)", () => {
  const a = slAlerts.naked("BTCUSDT", "LONG");
  assert.notEqual(a, slAlerts.naked("ETHUSDT", "LONG"), "코인이 달라도 같은 글자다");
  assert.notEqual(a, slAlerts.naked("BTCUSDT", "SHORT"), "방향이 달라도 같은 글자다");
  assert.ok(a.includes("BTCUSDT") && a.includes("LONG"));
});

test("주문번호는 문구에 **넣지 않는다** (2026-09-04 사용자 요청)", () => {
  // 19자리라 화면에서 읽을 수 없다. 어느 주문이었는지는 로그가 답한다
  for (const msg of [slAlerts.naked("BTCUSDT", "LONG"),
                     slAlerts.naked("BTCUSDT", "LONG", "1", "2")]) {
    assert.ok(!/orderId/.test(msg), `문구에 주문번호가 들어갔다: ${msg}`);
  }
});

test("수량은 **받은 글자 그대로** 쓴다 (자릿수는 심볼마다 다르다)", () => {
  // DOGE의 최소 단위는 1 — 여기서 toFixed(3)을 하면 `123.000`이 된다.
  // 반올림은 부르는 쪽(orderWatcher의 fmtQty)이 심볼 규칙으로 한다
  const msg = slAlerts.naked("DOGEUSDT", "SHORT", "123", "456");
  assert.match(msg, /\(123 \/ 456\)/);
});

test("한쪽 수량만 있으면 **'없다'**로 떨어진다 (반쪽 문구를 만들지 않는다)", () => {
  const none = slAlerts.naked("BTCUSDT", "LONG");
  assert.equal(slAlerts.naked("BTCUSDT", "LONG", "0.003", null), none);
  assert.equal(slAlerts.naked("BTCUSDT", "LONG", null, "0.004"), none);
});

test("문구가 바뀌면 이 테스트가 먼저 깨진다 (배너 회수 계약)", () => {
  // 글자 하나만 달라져도 배너가 안 닫힌다 — 그래서 여기 못 박는다
  assert.equal(slAlerts.naked("BTCUSDT", "LONG"),
    "⚠ BTCUSDT LONG 포지션에 손절(SL)이 없습니다 — 직접 걸어 주세요");
  assert.equal(slAlerts.naked("BTCUSDT", "LONG", "0.003", "0.004"),
    "⚠ BTCUSDT LONG 손절(SL)이 포지션의 일부만 덮습니다 (0.003 / 0.004) — 부족한 만큼 더 걸어 주세요");
});
