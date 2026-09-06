// 헷지모드 방향 매핑 — 화면과 백엔드가 **같은 답을 내는가** (`utils/side.js`)
//
// ⚠ 이 파일이 지키는 것은 "옳은 값"이 아니라 **두 벌이 갈리지 않는가**다.
//   같은 이름의 함수가 `frontend/src/utils/side.js`와 `backend/utils/side.js`에
//   따로 있다. 갈리면 화면은 롱이라 믿고 거래소에는 숏이 나간다 — 되돌릴 수 없는 종류다.
//
// ⚠ **네 가지를 섞지 말 것.** 이름이 비슷해서 실제로 헷갈리는 자리다:
//     positionToSide("LONG")  = "BUY"   ← 진입할 때
//     positionToClose("LONG") = "SELL"  ← 청산할 때
//   둘을 바꿔 쓰면 청산하려다 **포지션을 두 배로 키운다.**

import test from "node:test";
import assert from "node:assert/strict";
import {
  sideToPosition, positionToSide, closeToPosition, positionToClose,
  isLongToPosition, isLongToSide,
} from "../src/utils/side.js";
import backendSide from "../../backend/utils/side.js";

test("백엔드와 **글자 그대로 같은 답**을 낸다", () => {
  for (const s of ["BUY", "SELL"]) {
    assert.equal(sideToPosition(s),  backendSide.sideToPosition(s),  `sideToPosition(${s})`);
    assert.equal(closeToPosition(s), backendSide.closeToPosition(s), `closeToPosition(${s})`);
  }
  for (const p of ["LONG", "SHORT"]) {
    assert.equal(positionToSide(p),  backendSide.positionToSide(p),  `positionToSide(${p})`);
    assert.equal(positionToClose(p), backendSide.positionToClose(p), `positionToClose(${p})`);
  }
});

test("진입 방향 — BUY는 롱, SELL은 숏", () => {
  assert.equal(sideToPosition("BUY"),  "LONG");
  assert.equal(sideToPosition("SELL"), "SHORT");
  assert.equal(positionToSide("LONG"),  "BUY");
  assert.equal(positionToSide("SHORT"), "SELL");
});

test("청산 방향은 진입과 **반대**다 (여기가 헷갈리는 자리)", () => {
  // 롱을 닫으려면 팔아야 한다. 사면 포지션이 두 배가 된다
  assert.equal(positionToClose("LONG"),  "SELL");
  assert.equal(positionToClose("SHORT"), "BUY");
  assert.equal(closeToPosition("SELL"), "LONG");
  assert.equal(closeToPosition("BUY"),  "SHORT");

  for (const p of ["LONG", "SHORT"]) {
    assert.notEqual(positionToSide(p), positionToClose(p),
      `${p}의 진입 방향과 청산 방향이 같아졌다 — 청산이 추가 진입이 된다`);
  }
});

test("되돌리면 제자리로 온다 (네 함수가 서로 짝이다)", () => {
  for (const p of ["LONG", "SHORT"]) {
    assert.equal(sideToPosition(positionToSide(p)), p,   `진입 왕복이 깨졌다: ${p}`);
    assert.equal(closeToPosition(positionToClose(p)), p, `청산 왕복이 깨졌다: ${p}`);
  }
  for (const s of ["BUY", "SELL"]) {
    assert.equal(positionToSide(sideToPosition(s)), s,   `진입 역왕복이 깨졌다: ${s}`);
    assert.equal(positionToClose(closeToPosition(s)), s, `청산 역왕복이 깨졌다: ${s}`);
  }
});

test("불리언 헬퍼도 같은 규칙을 따른다", () => {
  assert.equal(isLongToPosition(true),  "LONG");
  assert.equal(isLongToPosition(false), "SHORT");
  assert.equal(isLongToSide(true),  "BUY");
  assert.equal(isLongToSide(false), "SELL");
  // 플랜 박스 셋(executeOrder·replacePendingOrder·updatePendingTpsl)이 isLong으로 받는다
  assert.equal(isLongToSide(true), positionToSide(isLongToPosition(true)));
  assert.equal(isLongToSide(false), positionToSide(isLongToPosition(false)));
});

test("⚠ 모르는 값은 **조용히 숏·SELL로 떨어진다** (지금 동작을 적어 둔다)", () => {
  // 검사하지 않고 `=== "BUY"`처럼 한쪽만 보기 때문이다. 던지지도 않는다.
  // → **부르는 쪽이 값을 보장해야 한다.** 거래소·store에서 온 값을 그대로 넣지 말 것.
  //   백엔드도 같은 방식이라 최소한 두 벌이 갈리지는 않는다
  assert.equal(sideToPosition("buy"), "SHORT");     // 소문자도 모르는 값이다
  assert.equal(sideToPosition(undefined), "SHORT");
  assert.equal(positionToSide("long"), "SELL");
  assert.equal(sideToPosition("buy"), backendSide.sideToPosition("buy"));
  assert.equal(positionToSide("long"), backendSide.positionToSide("long"));
});
