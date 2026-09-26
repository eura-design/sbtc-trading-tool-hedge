// 리플레이 모드를 켜고 끌 때 **실계좌·연습 계좌 슬롯을 비우는가**
//
// ⚠ 두 계좌가 같은 슬롯(`position`/`balance`/`tpsl`)을 쓴다. 모드를 바꿀 때 안 비우면
//   한쪽 값이 다른 쪽인 척 화면에 남고, 더 나쁘게는 **플랜 박스가 지워진다**:
//   `App`의 drawing↔pending 동기화가 `box.orderId && !pend`를 보고 지우기 때문이다.
//   2026-09-27까지 **켜는 쪽에만 이 짝이 빠져 있어서**, 리플레이에서 지정가를 걸어두고
//   모드를 끄고 다시 켜면 박스가 사라지고 점선 대기선만 남았다 (사용자 신고).
//   페이퍼 미체결의 `drawing`은 늘 null이라 되살아나지도 않았다.

import test from "node:test";
import assert from "node:assert/strict";
import { createReplaySlice } from "../src/store/replaySlice.js";

/** 아주 작은 스토어 대역 — 슬라이스만 올린다 (`orderActions.test.js`와 같은 방식) */
function makeStore(initial = {}) {
  let state = {
    replayOn: false, drawings: { long: null, short: null }, symbol: "BTCUSDT",
    position: null, balance: null, tpsl: null,
    // 실거래 설정 — swapTradeSettings가 읽는 값들 (없으면 기본으로 떨어진다)
    riskPctLong: 1, riskPctShort: 1, leverage: 10,
    ...initial,
  };
  const set = (patch) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; };
  const get = () => state;
  const slice = createReplaySlice(set, get);
  Object.assign(state, slice);
  return { get: () => state, slice };
}

test("리플레이를 **켤 때** 실계좌 스냅샷을 비운다 (박스가 지워지지 않게)", () => {
  const s = makeStore({
    position: { long: { size: 1, entryPrice: 100 }, pending: null },
    balance:  { walletBalance: 1234 },
  });
  s.slice.setReplayOn(true);
  assert.equal(s.get().replayOn, true);
  assert.equal(s.get().position, null,
    "실계좌 포지션이 남으면 App 동기화가 리플레이 박스를 지운다");
  assert.equal(s.get().balance, null);
  assert.ok(s.get().tpsl, "tpsl은 null이 아니라 **빈 모양**이어야 한다 (화면이 바로 읽는다)");
  assert.equal(s.get().tpsl.long.tp, null);
  assert.deepEqual(s.get().tpsl.long.splitTps, []);
});

test("리플레이를 **끌 때**도 비운다 (기존 동작 유지)", () => {
  const s = makeStore({
    replayOn: true,
    position: { long: { size: 2, entryPrice: 50 } },
    balance:  { walletBalance: 10000 },
  });
  s.slice.setReplayOn(false);
  assert.equal(s.get().replayOn, false);
  assert.equal(s.get().position, null);
  assert.equal(s.get().balance, null);
  assert.equal(s.get().replayNowMs, null, "시계도 비운다 — 남으면 지표가 과거 시각으로 잘린다");
});

test("⚠ 켜는 쪽과 끄는 쪽이 **같은 값**을 쓴다 (비대칭이 곧 그 버그였다)", () => {
  const on  = makeStore({ position: { long: {} }, balance: { walletBalance: 1 } });
  on.slice.setReplayOn(true);
  const off = makeStore({ replayOn: true, position: { long: {} }, balance: { walletBalance: 1 } });
  off.slice.setReplayOn(false);
  for (const key of ["position", "balance"]) {
    assert.equal(on.get()[key], off.get()[key], `${key}가 두 방향에서 달라졌다`);
  }
  assert.deepEqual(on.get().tpsl, off.get().tpsl);
});

// ── 실주문 차단 가드가 **스토어를 읽는가** (2026-09-27) ─────────────────────
//
// ⚠ 예전에는 `setReplayOn`이 boolean을 api 모듈로 밀어 넣어 값이 **두 벌**이었다.
//   실제로 어긋나서, 실거래 모드인데 실계좌 미체결 취소가
//   "리플레이 모드에서는 실제 주문을 보낼 수 없습니다"로 막혔다 (사용자 신고).
//   지금은 api가 스토어의 `replayOn`을 **그때그때 읽는다** — 갈라질 자리가 없다.
import { setReplayGuardSource, api } from "../src/api/client.js";

test("가드는 스토어의 replayOn을 그때그때 읽는다 (두 벌이 아니다)", async () => {
  let replayOn = false;
  setReplayGuardSource(() => replayOn);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: 1 }) });

  // 실거래 — 통과해야 한다
  assert.deepEqual(await api("DELETE", "/api/orders", { orderId: "1" }), { ok: 1 });

  // 리플레이 — 막혀야 한다. **가드를 따로 건드리지 않았는데** 바뀐다
  replayOn = true;
  await assert.rejects(() => api("DELETE", "/api/orders", { orderId: "1" }),
    /리플레이 모드/);

  // 다시 실거래 — 스스로 풀린다 (옛 버그는 여기서 계속 막혔다)
  replayOn = false;
  assert.deepEqual(await api("DELETE", "/api/orders", { orderId: "1" }), { ok: 1 });

  setReplayGuardSource(null);   // 뒷정리 — 다른 테스트에 새지 않게
});

test("GET은 리플레이 중에도 통과한다 (잔고·통계 조회가 막히면 사이드바가 통째로 에러다)", async () => {
  setReplayGuardSource(() => true);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: 1 }) });
  assert.deepEqual(await api("GET", "/api/balance"), { ok: 1 });
  setReplayGuardSource(null);
});
