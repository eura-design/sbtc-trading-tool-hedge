// 빨간 줄(무방비 경보)이 **언제 뜨고 언제 안 뜨는가** — `orderWatcher.checkNakedFast`
//
// 이 파일이 지키는 계약 셋 (2026-09-06 사용자 요청으로 바뀐 부분):
//   ① 손절이 없으면 15초(5회 관측) 뒤에 뜬다 — 체결 직후의 틈에 오경보를 내지 않는다
//   ② **사용자가 일부러 지웠으면 뜨지 않는다** — 진입은 손절이 필수라 차트에서 지우는
//      것이 손절 없이 들고 가는 유일한 길이다. 그 선택에 계속 빨간 줄을 띄우면
//      사용자가 배너를 무시하게 된다
//   ③ 그 침묵은 **그 포지션 그 구간뿐이다** — 포지션이 닫히거나 손절이 다시 보이면
//      표시를 거둔다. 안 거두면 다음에 진짜로 손절이 빠져도 조용하다 (기록은 7일 남는다)

const test   = require("node:test");
const assert = require("node:assert/strict");
const { loadService } = require("./helpers/routeHarness");

const NAKED_ALARM_STRIKES = 5;   // orderWatcher와 같은 값 — 3초 × 5 = 약 15초

const pos = (amt = "0.004", side = "LONG") => [{ positionSide: side, positionAmt: amt }];
/** 전량 손절 (closePosition) */
const fullStop = (side = "LONG") => ({ orderType: "STOP_MARKET", positionSide: side,
  side: side === "LONG" ? "SELL" : "BUY", closePosition: true, triggerPrice: "65000" });
/** 수량을 지정한 부분 손절 */
const partStop = (qty, side = "LONG") => ({ orderType: "STOP_MARKET", positionSide: side,
  side: side === "LONG" ? "SELL" : "BUY", quantity: qty, triggerPrice: "65000" });

const entry = (over = {}) => ({
  status: "TPSL_PLACED", side: "BUY", closeSide: "SELL", symbol: "BTCUSDT",
  tp: 80000, sl: 65000, qty: "0.004", fillPrice: 70000, filledAt: Date.now(), ...over,
});

/** checkNakedFast를 n번 돌린다 (3초 감시가 n회 관측한 셈) */
async function watch(h, { times = NAKED_ALARM_STRIKES, positions = pos(), algos = [] } = {}) {
  for (let i = 0; i < times; i++) h.mod.checkNakedFast("BTCUSDT", positions, [], algos);
  return h.rec.alerts;
}
const reds = (h) => h.rec.alerts.filter(a => a.level === "critical");

// ── ① 손절이 없으면 알린다 ────────────────────────────────────────────────
test("손절이 없으면 **15초(5회) 뒤에** 빨간 줄이 뜬다", async () => {
  const h = await loadService("services/orderWatcher.js", { store: { E1: entry() } });
  await watch(h, { times: NAKED_ALARM_STRIKES - 1 });
  assert.equal(reds(h).length, 0, "유예 안에 떴다 — 체결 직후의 틈마다 오경보가 난다");

  await watch(h, { times: 1 });
  assert.equal(reds(h).length, 1, "15초가 지나도 안 떴다");
  assert.match(reds(h)[0].msg, /BTCUSDT LONG 포지션에 손절\(SL\)이 없습니다/);
  await h.close();
});

test("전량 손절이 걸려 있으면 뜨지 않는다", async () => {
  const h = await loadService("services/orderWatcher.js", { store: { E1: entry() } });
  await watch(h, { algos: [fullStop()] });
  assert.equal(reds(h).length, 0, "손절이 있는데 빨간 줄이 떴다");
  await h.close();
});

test("손절이 일부만 덮으면 **수량을 적어** 알린다", async () => {
  const h = await loadService("services/orderWatcher.js", { store: { E1: entry() } });
  await watch(h, { algos: [partStop("0.003")] });
  assert.equal(reds(h).length, 1);
  assert.match(reds(h)[0].msg, /일부만 덮습니다 \(0\.003 \/ 0\.004\)/);
  await h.close();
});

// ── ② 일부러 지웠으면 알리지 않는다 (2026-09-06 사용자 요청) ───────────────
test("**사용자가 일부러 지웠으면** 손절이 없어도 빨간 줄이 안 뜬다", async () => {
  const h = await loadService("services/orderWatcher.js", {
    store: { E1: entry({ slRemovedAt: Date.now() }) },
  });
  await watch(h, { times: NAKED_ALARM_STRIKES * 3 });   // 45초를 봐도 조용해야 한다
  assert.equal(reds(h).length, 0, "내가 지운 손절을 두고 빨간 줄이 떴다");
  await h.close();
});

test("표시는 **그 방향에만** 듣는다 (반대쪽 무방비는 그대로 알린다)", async () => {
  const h = await loadService("services/orderWatcher.js", {
    store: {
      LONG_BTC:  entry({ slRemovedAt: Date.now() }),
      SHORT_BTC: entry({ side: "SELL", closeSide: "BUY" }),
    },
  });
  for (let i = 0; i < NAKED_ALARM_STRIKES; i++) {
    h.mod.checkNakedFast("BTCUSDT", [...pos("0.004", "LONG"), ...pos("0.004", "SHORT")], [], []);
  }
  assert.equal(reds(h).length, 1, "롱은 조용하고 숏만 떠야 한다");
  assert.match(reds(h)[0].msg, /SHORT/);
  await h.close();
});

test("이미 떠 있던 빨간 줄도 **지운 순간 거둔다**", async () => {
  // "일부만 덮습니다"가 떠 있는 동안 그 부분 손절을 지우면, 그때부터는 사용자가 고른 상태다
  const h = await loadService("services/orderWatcher.js", { store: { E1: entry() } });
  await watch(h, { algos: [partStop("0.003")] });
  assert.equal(reds(h).length, 1);
  const shown = reds(h)[0].msg;

  h.store.set("E1", { ...h.store.get("E1"), slRemovedAt: Date.now() });
  await watch(h, { times: 1 });
  const cleared = h.rec.alerts.filter(a => a.level === "clear").map(a => a.msg);
  assert.ok(cleared.includes(shown), "지웠는데 빨간 줄이 화면에 남는다");
  await h.close();
});

// ── ③ 표시를 거두는 두 조건 ───────────────────────────────────────────────
test("포지션이 닫히면 표시를 **거둔다** (안 거두면 다음 포지션까지 조용하다)", async () => {
  const h = await loadService("services/orderWatcher.js", {
    store: { E1: entry({ slRemovedAt: Date.now() }) },
  });
  h.mod.checkNakedFast("BTCUSDT", [{ positionSide: "LONG", positionAmt: "0" }], [], []);
  assert.equal(h.store.get("E1").slRemovedAt, undefined,
    "포지션이 닫혔는데 표시가 남았다 — 그 방향이 기록 정리(7일)까지 조용해진다");
  await h.close();
});

test("손절이 다시 보이면 표시를 **거둔다** (바이낸스 앱에서 걸어도 마찬가지다)", async () => {
  const h = await loadService("services/orderWatcher.js", {
    store: { E1: entry({ slRemovedAt: Date.now() }) },
  });
  h.mod.checkNakedFast("BTCUSDT", pos(), [], [fullStop()]);
  assert.equal(h.store.get("E1").slRemovedAt, undefined, "손절이 다시 걸렸는데 표시가 남았다");
  await h.close();
});

test("표시가 거둬진 뒤 손절이 또 사라지면 **이번엔 알린다**", async () => {
  const h = await loadService("services/orderWatcher.js", {
    store: { E1: entry({ slRemovedAt: Date.now() }) },
  });
  h.mod.checkNakedFast("BTCUSDT", pos(), [], [fullStop()]);   // 다시 걸었다 → 표시 거둠
  await watch(h);                                             // 그런데 또 사라졌다
  assert.equal(reds(h).length, 1, "이건 사용자가 고른 상태가 아니다 — 알려야 한다");
  await h.close();
});

test("아직 지운 상태 그대로면 표시를 **거두지 않는다**", async () => {
  // ⚠ `resolveNaked(..., "removed")`는 배너만 내린다. 여기서 표시까지 거두면
  //   다음 회차에 다시 배너가 떠서 기능이 통째로 무효가 된다
  const h = await loadService("services/orderWatcher.js", {
    store: { E1: entry({ slRemovedAt: Date.now() }) },
  });
  await watch(h, { times: NAKED_ALARM_STRIKES });
  assert.ok(h.store.get("E1").slRemovedAt, "표시가 스스로 사라졌다");
  assert.equal(reds(h).length, 0);
  await h.close();
});
