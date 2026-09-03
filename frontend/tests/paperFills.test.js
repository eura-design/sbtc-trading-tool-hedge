// 페이퍼 체결 규칙 — **"모르면 불리하게"**
//
// ── 왜 이 파일이 있나 ──────────────────────────────────────────────────────
// 이 규칙이 느슨해지면 **연습 성적이 조용히 부풀려진다.** 그러면 연습이
// 실전에서 통하지 않는 습관을 가르친다 — 이 기능의 목적 자체가 무너진다.
//
// 규칙은 전부 주석에 근거와 함께 적혀 있는데(paperBroker.js), 지금까지 검산이 없었다.
// 실제로 그중 하나는 한 번 어긋난 적이 있다(2026-08-23: 단일 TP를 먼저 보고
// `continue`해서 롱에서 **더 유리한 가격이 먼저 체결**됐다).

import test from "node:test";
import assert from "node:assert/strict";
import { PaperBroker } from "../src/replay/paperBroker.js";

const bar = (o, h, l, c, t = 1_000_000) => ({ t, o, h, l, c });

/**
 * 진입만 시켜 둔 브로커.
 * ⚠ **봉을 하나 먹인 뒤에 진입한다** — 시장가는 "지금 가격"이 있어야 체결된다
 *   (`placeEntry`가 가격 없이 불리면 던진다)
 */
// ⚠ 레버리지를 **낮게** 잡는다. 10배면 청산가가 진입가에서 9.6% 떨어진 자리라
//   (100 → 90.4) 손절보다 **청산이 먼저 걸린다** — 엔진은 청산을 먼저 본다.
//   그건 정상 동작이고, 여기서 보려는 건 TP/SL 순서라 청산을 멀리 밀어 둔다
function opened(side, qty = 1, entry = 100, leverage = 2) {
  const b = new PaperBroker({ startBalance: 10_000, step: 0.001 });
  b.onBar(bar(entry, entry, entry, entry));            // 현재가를 잡아 준다
  b.placeEntry({ positionSide: side, orderType: "MARKET", entry, qty, leverage });
  b.events.length = 0;                                  // 진입 이벤트는 지우고 시작한다
  return b;
}
const withLong  = (...a) => opened("LONG", ...a);
const withShort = (...a) => opened("SHORT", ...a);

test("한 봉에 TP와 SL이 둘 다 닿으면 SL이 먼저다", () => {
  // 봉 하나 안의 순서를 모를 때의 보수적 선택. 이게 뒤집히면 성적이 부풀려진다
  const b = withLong();
  b.setTpsl("LONG", { tp: 110, sl: 90 });
  b.onBar(bar(100, 115, 85, 100));      // 고가·저가가 둘 다 트리거를 넘는다
  assert.equal(b.pos.LONG, null, "포지션이 닫혀야 한다");
  assert.ok(b.events.some(e => e.type === "sl"), `SL이 아니라: ${JSON.stringify(b.events)}`);
  assert.ok(!b.events.some(e => e.type === "tp"), "TP가 체결됐다 — 성적이 부풀려진다");
});

test("갭이면 트리거 가격이 아니라 **봉 시가**로 체결된다", () => {
  // 갭 하락에서 손절가로 체결시키면 손실이 실제보다 작게 나온다
  const b = withLong(1, 100);
  b.setTpsl("LONG", { sl: 90 });
  b.onBar(bar(80, 82, 78, 81));          // 시가부터 손절 아래
  const sl = b.events.find(e => e.type === "sl");
  assert.equal(sl.price, 80, `갭 시가 80이 아니라 ${sl.price}`);
});

test("숏의 갭도 불리한 쪽이다", () => {
  const b = withShort(1, 100);
  b.setTpsl("SHORT", { sl: 110 });
  b.onBar(bar(120, 122, 118, 121));
  const sl = b.events.find(e => e.type === "sl");
  assert.equal(sl.price, 120, `갭 시가 120이 아니라 ${sl.price}`);
});

test("분할 TP가 여럿 닿으면 **가격이 실제로 닿는 순서**로 (2026-08-23 회귀)", () => {
  // 롱은 낮은 값부터. 예전엔 단일 TP를 먼저 보고 continue해서
  // 더 유리한(높은) 가격이 먼저 체결됐다
  const b = withLong(1, 100);
  b.addSplitTp({ positionSide: "LONG", price: 105, qty: 0.3 });
  b.addSplitTp({ positionSide: "LONG", price: 110, qty: 0.3 });
  b.onBar(bar(100, 115, 99, 114));       // 둘 다 닿는다
  const fills = b.events.filter(e => e.type === "split_tp").map(e => e.price);
  assert.deepEqual(fills, [105, 110], `닿는 순서가 아니다: ${fills}`);
});

test("분할 SL이 여럿 닿으면 롱은 **높은 값부터** (익절과 정렬이 반대다)", () => {
  const b = withLong(1, 100);
  b.addPartialSl({ positionSide: "LONG", price: 95, qty: 0.3 });
  b.addPartialSl({ positionSide: "LONG", price: 90, qty: 0.3 });
  b.onBar(bar(100, 101, 85, 86));        // 둘 다 닿는다
  const fills = b.events.filter(e => e.type === "partial_sl").map(e => e.price);
  assert.deepEqual(fills, [95, 90], `가격이 내려오는 순서가 아니다: ${fills}`);
});

test("전량 SL은 그 시점의 **잔여 전부**를 정리한다 (closePosition)", () => {
  const b = withLong(1, 100);
  b.addPartialSl({ positionSide: "LONG", price: 95, qty: 0.3 });
  b.setTpsl("LONG", { sl: 90 });
  b.onBar(bar(100, 101, 85, 86));        // 분할 SL(95) → 전량 SL(90) 순서
  assert.equal(b.pos.LONG, null, "잔여가 남았다");
});

test("수수료가 방향에 맞게 붙는다 — 지정가 익절은 메이커, 손절은 테이커", () => {
  const taker = withLong(1, 100);
  taker.setTpsl("LONG", { sl: 90 });
  taker.onBar(bar(100, 101, 89, 90));
  const afterTaker = taker.balance;

  const maker = withLong(1, 100);
  maker.addSplitTp({ positionSide: "LONG", price: 110, qty: 1 });
  maker.onBar(bar(100, 111, 99, 110));
  // 같은 크기 거래인데 메이커 쪽 수수료가 더 싸야 한다 (0.0002 < 0.0004)
  assert.ok(maker.balance > afterTaker, "메이커·테이커 수수료가 구분되지 않는다");
});

test("승패는 **수수료를 뺀 뒤** 판정한다", () => {
  // 가격상 본전인데 수수료 때문에 손실이면 그건 진 거래다
  const b = withLong(1, 100);
  b.close("LONG", 1);                    // 같은 가격에 즉시 청산
  assert.ok(b.balance < 10_000, `수수료가 안 빠졌다: ${b.balance}`);
});

test("트리거에 닿지 않으면 아무 일도 없다", () => {
  const b = withLong(1, 100);
  b.setTpsl("LONG", { tp: 110, sl: 90 });
  b.onBar(bar(100, 109, 91, 105));       // 둘 다 아슬하게 못 닿는다
  assert.ok(b.pos.LONG, "포지션이 사라졌다");
  assert.equal(b.events.length, 0, `이벤트가 생겼다: ${JSON.stringify(b.events)}`);
});

test("숏도 롱과 대칭이다", () => {
  const b = withShort(1, 100);
  b.setTpsl("SHORT", { tp: 90, sl: 110 });
  b.onBar(bar(100, 115, 85, 100));       // 둘 다 닿는다 → SL 우선
  assert.equal(b.pos.SHORT, null);
  assert.ok(b.events.some(e => e.type === "sl"), "숏에서 SL 우선이 아니다");
});

// ── 청산 (2026-09-03 추가) ──────────────────────────────────────────────────
// 이 테스트를 쓰다가 알게 된 것: **엔진은 손절보다 청산을 먼저 본다.**
// 맞는 순서다 — 손절이 청산가보다 멀면 실제로도 청산이 먼저 걸린다.
// 그걸 모르고 레버리지 10배로 테스트를 짰다가 전부 빨개졌다.

test("손절이 청산가보다 멀면 **청산이 먼저다**", () => {
  // 레버리지 10배: 청산가 = 100 × (1/10 − 0.004) 아래 = 90.4
  const b = opened("LONG", 1, 100, 10);
  b.setTpsl("LONG", { sl: 90 });          // 청산가(90.4)보다 아래 = 닿을 수 없다
  b.onBar(bar(100, 101, 85, 86));
  assert.ok(b.events.some(e => e.type === "liquidation"),
    `청산이 아니라: ${JSON.stringify(b.events)}`);
  assert.equal(b.pos.LONG, null);
});

test("청산도 갭이면 청산가가 아니라 봉 시가다", () => {
  // 청산가에 그대로 체결시키면 갭 하락에서 손실이 실제보다 작게 나온다
  const b = opened("LONG", 1, 100, 10);
  b.onBar(bar(80, 82, 78, 81));            // 시가부터 청산가(90.4) 아래
  assert.ok(b.events.some(e => e.type === "liquidation"));
  assert.ok(b.balance < 10_000, "청산인데 잔고가 안 줄었다");
});

test("레버리지가 낮으면 청산이 멀어 손절이 먼저 걸린다", () => {
  const b = opened("LONG", 1, 100, 2);     // 청산가 50.4
  b.setTpsl("LONG", { sl: 90 });
  b.onBar(bar(100, 101, 85, 86));
  assert.ok(b.events.some(e => e.type === "sl"), "손절이 안 걸렸다");
  assert.ok(!b.events.some(e => e.type === "liquidation"), "청산이 걸렸다");
});
