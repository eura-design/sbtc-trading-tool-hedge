// 미실현 손익 / 총자산
//
// ⚠ 포지션 카드의 `미실현`과 잔고 카드의 `총자산`은 **같은 값에서 나와야 한다**
//   (utils/equity.js 머리 주석 — 예전에 식이 둘이었다). 한 화면에 나란히 뜨는
//   숫자라 조금만 어긋나도 바로 보인다.

import test from "node:test";
import assert from "node:assert/strict";
import { unrealizedFor, totalUnrealized, totalEquity } from "../src/utils/equity.js";
import { sideToPosition, positionToSide,
         closeToPosition, positionToClose,
         isLongToPosition, isLongToSide } from "../src/utils/side.js";

const long  = { size: 0.5, entryPrice: 50000, unrealizedPnl: 999 };
const short = { size: 0.2, entryPrice: 52000, unrealizedPnl: 888 };

test("롱은 오르면 이익, 숏은 내리면 이익", () => {
  assert.equal(unrealizedFor(long,  51000, true),   500);   // (51000-50000) × 0.5
  assert.equal(unrealizedFor(long,  49000, true),  -500);
  assert.equal(unrealizedFor(short, 51000, false),  200);   // (52000-51000) × 0.2
  assert.equal(unrealizedFor(short, 53000, false), -200);
});

test("가격을 아직 모르면 서버가 준 값을 쓴다", () => {
  // 첫 렌더에 0을 보여주면 손익이 사라진 것처럼 보인다
  assert.equal(unrealizedFor(long, 0, true),         999);
  assert.equal(unrealizedFor(long, null, true),      999);
  assert.equal(unrealizedFor(long, undefined, true), 999);
});

test("포지션이 없으면 0", () => {
  assert.equal(unrealizedFor(null, 51000, true),      0);
  assert.equal(unrealizedFor(undefined, 51000, true), 0);
  assert.equal(totalUnrealized(null, 51000),          0);
  assert.equal(totalUnrealized({}, 51000),            0);
});

test("헷지모드 — 롱·숏을 동시에 들고 있으면 합친다", () => {
  assert.equal(totalUnrealized({ long, short }, 51000), 500 + 200);
  assert.equal(totalUnrealized({ long },        51000), 500);
  assert.equal(totalUnrealized({ short },       51000), 200);
});

test("총자산 = 지갑 잔고 + 미실현 — 두 숫자가 같은 곳에서 나온다", () => {
  const price = 51000;
  const u = totalUnrealized({ long, short }, price);
  assert.equal(totalEquity(10000, { long, short }, price), 10000 + u);
});

test("잔고가 숫자가 아니면 0으로 본다", () => {
  assert.equal(totalEquity(undefined, null, 51000), 0);
  assert.equal(totalEquity(NaN,       null, 51000), 0);
  assert.equal(totalEquity(null,      null, 51000), 0);
});

test("포지션이 없으면 총자산은 가격이 움직여도 그대로다", () => {
  assert.equal(totalEquity(10000, null, 50000), 10000);
  assert.equal(totalEquity(10000, null, 99999), 10000);
});

// ── side 매핑 (프론트 — 백엔드 utils/side.js와 같은 규칙 + boolean 헬퍼 둘) ──
test("진입 side와 청산 side는 서로 반대다", () => {
  assert.equal(sideToPosition("BUY"),   "LONG");
  assert.equal(sideToPosition("SELL"),  "SHORT");
  assert.equal(positionToSide("LONG"),  "BUY");
  assert.equal(closeToPosition("SELL"), "LONG");
  assert.equal(positionToClose("LONG"), "SELL");
  for (const p of ["LONG", "SHORT"]) {
    assert.notEqual(positionToSide(p), positionToClose(p), p);
    assert.equal(sideToPosition(positionToSide(p)), p);
  }
});

test("isLong 헬퍼는 나머지와 같은 답을 준다", () => {
  assert.equal(isLongToPosition(true),  "LONG");
  assert.equal(isLongToPosition(false), "SHORT");
  assert.equal(isLongToSide(true),      "BUY");
  assert.equal(isLongToSide(false),     "SELL");
  for (const b of [true, false]) {
    assert.equal(isLongToSide(b), positionToSide(isLongToPosition(b)), String(b));
  }
});
