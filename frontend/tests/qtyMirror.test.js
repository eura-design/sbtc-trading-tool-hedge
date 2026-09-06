// 화면이 보여주는 수량과 **거래소로 나가는 수량**이 같은 규칙인가 (`utils/qty.js`)
//
// ⚠ 규칙이 두 벌이다: 화면·미리보기는 `frontend/src/utils/qty.js`가, 실제로 거래소에
//   보내는 값은 `backend/utils/round.js`가 만든다. 둘이 갈리면 **화면에 0.05로 떠 있는데
//   0.04가 나간다** — 체결된 뒤에야 보이는 종류의 어긋남이다.
//   그래서 이 파일은 값을 따로 적어 두지 않고 **두 구현을 직접 맞대어 본다**
//   (`tests/chochMirror.test.js`가 자동 ZZ와 수동 구조를 맞대는 것과 같은 방식).
//
// ⚠ **수량은 언제나 내린다.** 올리면 없는 물량을 주문하게 된다
//   (`backend/utils/round.js`·`utils/splitLevels.js`와 같은 원칙).

import test from "node:test";
import assert from "node:assert/strict";
import { floorQty, fmtQty, qtyLabel, qtyDecimals } from "../src/utils/qty.js";
import backendRound from "../../backend/utils/round.js";

const { floorToStep, decimalsOf } = backendRound;

// 실제 거래소 값 (2026-09-06 /api/symbols 실측)
const STEPS = ["0.001", "0.01", "0.1", "1", "0.00001"];

test("내림 결과가 **백엔드와 글자 그대로 같다**", () => {
  const qtys = [0, 0.0004, 0.001, 0.0019, 0.07, 0.123456, 1, 1.999, 25, 123.9, 1234.5678];
  for (const step of STEPS) {
    for (const q of qtys) {
      assert.equal(
        String(floorQty(q, step)), String(Number(floorToStep(q, step))),
        `step ${step} / 수량 ${q} — 화면과 주문이 갈렸다`);
    }
  }
});

test("자릿수 규칙도 백엔드와 같다", () => {
  // 바이낸스는 `"0.00100000"`처럼 0을 채워 보낸다 — 뒤의 0을 떼고 세야 한다
  for (const step of [...STEPS, "0.00100000", "0.10", "1.0", "1e-5"]) {
    assert.equal(qtyDecimals(step), decimalsOf(step), `단위 ${step}의 자릿수가 갈렸다`);
  }
});

test("**올리지 않는다** — 모자란 쪽으로 떨어진다", () => {
  // 올리면 없는 물량을 주문하게 된다. 한 칸 미만은 0이다
  assert.equal(floorQty(0.0019, "0.001"), 0.001);
  assert.equal(floorQty(0.0009, "0.001"), 0);
  assert.equal(floorQty(123.9,  "1"),     123);
  assert.equal(floorQty(0.99,   "1"),     0);
});

test("부동소수점 때문에 한 칸 깎이지 않는다", () => {
  // 0.07 / 0.01 은 컴퓨터 안에서 6.999…다. 그냥 버리면 0.06이 된다
  assert.equal(floorQty(0.07, "0.01"), 0.07);
  assert.equal(floorQty(0.29, "0.01"), 0.29);
  assert.equal(floorQty(0.003, "0.001"), 0.003);
});

test("이상한 값이 들어와도 주문할 수 없는 수량을 만들지 않는다", () => {
  // 음수·NaN이 그대로 나가면 거래소가 거절하거나 반대 방향으로 읽힐 수 있다
  for (const bad of [-1, -0.5, NaN, undefined, null, "", "abc"]) {
    assert.equal(floorQty(bad, "0.001"), 0, `${String(bad)} 이 0이 아니다`);
  }
});

test("표시 자릿수는 **그 심볼의 단위**를 따른다 (BTC 값을 박지 않는다)", () => {
  // DOGE(단위 1)에 `toFixed(3)`을 쓰면 `123.000`처럼 낼 수 없는 수량이 뜬다
  assert.equal(fmtQty(123.456, "1"),     "123");
  assert.equal(fmtQty(0.164,   "0.001"), "0.164");
  assert.equal(fmtQty(1.5,     "0.01"),  "1.50");
});

test("라벨은 코인 이름을 모르면 수량만 보여준다", () => {
  assert.equal(qtyLabel(0.164, "0.001", "BTC"), "0.164 BTC");
  assert.equal(qtyLabel(0.164, "0.001"), "0.164");
  assert.equal(qtyLabel(123, "1", "DOGE"), "123 DOGE");
});

test("단위를 안 넘기면 BTC 기준으로 떨어진다 (옛 호출부의 대비책)", () => {
  // ⚠ 이 기본값에 기대지 말 것 — 심볼 규칙은 `useSymbolFilters`가 준다.
  //   여기서 확인하는 것은 "안 넘겨도 터지지 않는가"뿐이다
  assert.equal(floorQty(0.1239), 0.123);
  assert.equal(fmtQty(0.1239), "0.124");
});
