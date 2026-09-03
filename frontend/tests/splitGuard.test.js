// 분할 주문의 가격 방향 검증
//
// ⚠ 여기가 틀리면 **잘못된 쪽에 주문이 조용히 나간다.**
//   추가 진입·분할 SL은 방향이 반대면 거래소가 -2021로 거절하거나(트리거)
//   **즉시 체결되고**(지정가), 분할 TP는 진입가 반대편이면 애초에 익절이 아니다.

import test from "node:test";
import assert from "node:assert/strict";
import { validateSplitPrices } from "../src/utils/splitGuard.js";

const at = (...prices) => prices.map(price => ({ price, qty: 1 }));
const ok = (r) => assert.equal(r, null, `막혔다: ${r?.msg}`);
const blocked = (r, reason) => {
  assert.ok(r, "통과했다 — 잘못된 쪽에 주문이 나간다");
  assert.equal(r.reason, reason, r.msg);
};

// ── 추가 진입 · 분할 SL: 기준은 **현재가** ─────────────────────────────────
test("추가 진입 — 롱은 현재가 아래에만", () => {
  ok(validateSplitPrices({ orders: at(95, 90), kind: "scale_in", isLong: true, mark: 100 }));
  blocked(validateSplitPrices({ orders: at(95, 105), kind: "scale_in", isLong: true, mark: 100 }), "wrong-side");
  // 현재가와 같은 값도 막는다 — 즉시 체결된다
  blocked(validateSplitPrices({ orders: at(100), kind: "scale_in", isLong: true, mark: 100 }), "wrong-side");
});

test("추가 진입 — 숏은 현재가 위에만", () => {
  ok(validateSplitPrices({ orders: at(105, 110), kind: "scale_in", isLong: false, mark: 100 }));
  blocked(validateSplitPrices({ orders: at(105, 95), kind: "scale_in", isLong: false, mark: 100 }), "wrong-side");
});

test("분할 SL도 현재가 기준이다 (추가 진입과 같은 쪽)", () => {
  ok(validateSplitPrices({ orders: at(95), kind: "partial_sl", isLong: true, mark: 100 }));
  blocked(validateSplitPrices({ orders: at(105), kind: "partial_sl", isLong: true, mark: 100 }), "wrong-side");
  ok(validateSplitPrices({ orders: at(105), kind: "partial_sl", isLong: false, mark: 100 }));
});

// ── 분할 TP: 기준은 **진입가** ─────────────────────────────────────────────
test("분할 TP — 롱은 진입가 위에만 (현재가와 무관하다)", () => {
  // ⚠ 현재가가 진입가보다 낮아도(손실 중) 진입가 위면 통과해야 한다
  ok(validateSplitPrices({ orders: at(105, 110), kind: "split_tp", isLong: true,
                           entryPrice: 100, mark: 80 }));
  blocked(validateSplitPrices({ orders: at(105, 95), kind: "split_tp", isLong: true,
                                entryPrice: 100, mark: 120 }), "wrong-side");
});

test("분할 TP — 숏은 진입가 아래에만", () => {
  ok(validateSplitPrices({ orders: at(95, 90), kind: "split_tp", isLong: false,
                           entryPrice: 100, mark: 120 }));
  blocked(validateSplitPrices({ orders: at(95, 105), kind: "split_tp", isLong: false,
                                entryPrice: 100 }), "wrong-side");
});

// ── 기준값이 없을 때 (가장 위험한 자리) ────────────────────────────────────
test("기준값이 없으면 **거절한다** — 건너뛰지 않는다", () => {
  // ⚠ 0으로 두면 롱은 "0보다 크다"가 늘 참이라 전부 걸러지고(사유가 엉뚱하다),
  //   숏은 반대로 **전부 통과해서 잘못된 쪽에 주문이 나간다**
  for (const isLong of [true, false]) {
    blocked(validateSplitPrices({ orders: at(95), kind: "scale_in", isLong, mark: 0 }), "no-reference");
    blocked(validateSplitPrices({ orders: at(95), kind: "scale_in", isLong, mark: undefined }), "no-reference");
    blocked(validateSplitPrices({ orders: at(95), kind: "split_tp", isLong, entryPrice: 0, mark: 100 }), "no-reference");
    blocked(validateSplitPrices({ orders: at(95), kind: "split_tp", isLong, entryPrice: undefined }), "no-reference");
  }
});

test("숏에서 기준값이 없을 때가 특히 위험했다 (회귀)", () => {
  // 옛 방식(mark = 0)이면 `o.price <= 0`이 전부 거짓 → 전부 통과했다
  const r = validateSplitPrices({ orders: at(95, 90), kind: "scale_in", isLong: false, mark: 0 });
  assert.ok(r, "숏 + 기준값 없음이 통과했다 — 잘못된 쪽에 주문이 나간다");
  assert.equal(r.reason, "no-reference");
});

// ── 문구 ───────────────────────────────────────────────────────────────────
test("문구가 종류와 방향을 정확히 말한다", () => {
  assert.match(validateSplitPrices({ orders: at(105), kind: "scale_in", isLong: true, mark: 100 }).msg,
    /추가 진입.*현재가보다 낮은/);
  assert.match(validateSplitPrices({ orders: at(95), kind: "split_tp", isLong: true, entryPrice: 100 }).msg,
    /분할 TP.*진입가보다 높은/);
  assert.match(validateSplitPrices({ orders: at(95), kind: "partial_sl", isLong: false, mark: 100 }).msg,
    /분할 SL.*현재가보다 높은/);
  assert.match(validateSplitPrices({ orders: at(95), kind: "split_tp", isLong: true, entryPrice: 0 }).msg,
    /진입가를 아직 못 읽었습니다/);
  assert.match(validateSplitPrices({ orders: at(95), kind: "scale_in", isLong: true, mark: 0 }).msg,
    /현재가를 아직 못 읽었습니다/);
});

test("빈 목록은 통과한다 (막을 것이 없다)", () => {
  ok(validateSplitPrices({ orders: [], kind: "scale_in", isLong: true, mark: 100 }));
  ok(validateSplitPrices({ orders: undefined, kind: "scale_in", isLong: true, mark: 100 }));
});

test("하나라도 틀리면 전부 막는다 (부분 등록을 만들지 않는다)", () => {
  const r = validateSplitPrices({ orders: at(95, 90, 105), kind: "scale_in", isLong: true, mark: 100 });
  blocked(r, "wrong-side");
  assert.equal(r.price, 105, "어느 가격이 문제인지 알려야 한다");
});
