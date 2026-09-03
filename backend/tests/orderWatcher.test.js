// orderWatcher.onFilled — 체결을 감지한 뒤 **손절을 거는 자리**
//
// ⚠ 여기가 이 프로그램에서 **가장 중요한 함수**다. 지정가가 체결되면 여기가
//   TP/SL을 건다. 실패하면 포지션이 손절 없이 남는다.
//   1193줄짜리 파일인데 지금까지 테스트가 한 줄도 없었다 — 떼어낸 순수 함수
//   (`positionDiff`·`slAlerts`·`orderKind`·`recoverMatch`)만 덮여 있었고,
//   **그것들을 엮어 판단하는 부분**이 안 덮여 있었다.
//
// 이 파일이 보는 것:
//   · **딱 한 번만** 처리하는가 (다섯 경로가 같은 주문에 동시에 닿는다)
//   · TP/SL 가격이 없으면 **멈추고 알리는가** (지어내면 안 된다)
//   · SL 실패는 **빨간 배너**, TP 실패는 금색 토스트인가 (손절만 급하다)
//   · 성공하면 앞서 뜬 실패 배너를 **거두는가** (안 거두면 거짓말이 남는다)
//   · 체결가를 어느 필드에서 읽는가 (REST와 UDS가 서로 다른 이름을 쓴다)

const test   = require("node:test");
const assert = require("node:assert/strict");
const { loadService } = require("./helpers/routeHarness");

const watching = (over = {}) => ({
  status: "WATCHING", side: "BUY", qty: "0.01", tp: 80000, sl: 65000,
  symbol: "BTCUSDT", closeSide: "SELL", ...over,
});

/** onFilled를 한 번 돌리고 결과를 모아 준다 */
async function run({ info = watching(), exec = { avgPrice: "70000" }, ...opts } = {}) {
  const h = await loadService("services/orderWatcher.js", {
    store: info === null ? {} : { "111": info },
    ...opts,
  });
  await h.mod.onFilled("111", exec);
  const saved = h.store.get("111");
  const evt = (name) => h.rec.logs.filter(l => l.event === name);
  const alerts = (level) => h.rec.alerts.filter(a => a.level === level);
  await h.close();
  return { saved, rec: h.rec, evt, alerts };
}

// ── 멱등: 딱 한 번만 ───────────────────────────────────────────────────────
test("WATCHING이 아니면 아무것도 하지 않는다 (다섯 경로가 동시에 닿는다)", async () => {
  // ⚠ UDS · verifyImmediateFill · resolveOrphans · poll · reconcile
  for (const status of ["FILLED", "TPSL_PLACED", "TPSL_PARTIAL", "TPSL_MISSING"]) {
    const r = await run({ info: watching({ status }) });
    assert.equal(r.rec.placed.length, 0, `${status}인데 TP/SL을 또 걸었다`);
    assert.equal(r.saved.status, status, `${status}가 바뀌었다`);
  }
});

test("store에 없는 주문이면 조용히 넘어간다", async () => {
  const r = await run({ info: null });
  assert.equal(r.rec.placed.length, 0);
  assert.equal(r.rec.alerts.length, 0, "모르는 주문에 경보를 띄웠다");
});

// ── 체결가: REST와 UDS가 이름이 다르다 ─────────────────────────────────────
test("체결가를 REST(avgPrice)·UDS(ap·L)·폴백(price) 순으로 읽는다", async () => {
  // ⚠ `price`는 LIMIT 주문 가격이라 시장가 체결이면 0이다 → 최후 폴백
  // ⚠ **`saved`가 아니라 FILLED를 적는 순간을 본다.** 뒤이은 TPSL_PLACED 쓰기가
  //   옛 `info`를 다시 펼쳐서 fillPrice를 지운다 (2026-09-03에 발견, 아래 테스트 참고)
  const cases = [
    [{ avgPrice: "70000", ap: "1", L: "2", price: "3" }, 70000, "REST avgPrice"],
    [{ ap: "71000", L: "2", price: "3" },                71000, "UDS ap(평균)"],
    [{ L: "72000", price: "3" },                         72000, "UDS L(마지막 체결)"],
    [{ price: "73000" },                                 73000, "폴백 price"],
  ];
  for (const [exec, want, why] of cases) {
    const r = await run({ exec });
    const filled = r.rec.storeWrites.find(w => w.info.status === "FILLED");
    assert.ok(filled, `${why}: FILLED를 안 적었다`);
    assert.equal(filled.info.fillPrice, want, `${why}를 못 읽었다`);
  }
});

test('체결가 체인은 **없는 필드**만 건너뛴다 — 문자열 "0"은 안 건너뛴다', async () => {
  // ⚠ `a || b`는 문자열 `"0"`을 **참으로 본다**(빈 문자열이 아니다). 그래서
  //   avgPrice가 `"0.00000"`으로 오면 뒤 필드로 안 넘어가고 체결가가 0이 된다.
  //   지금은 문제가 안 된다 — `onFilled`를 부르는 **일곱 곳이 전부**
  //   `status === "FILLED"`를 확인하고 부르는데, 체결된 주문의 avgPrice는 실제 값이다.
  //   ⚠ FILLED 확인 없이 부르는 경로를 새로 만들면 여기가 0이 된다
  const r = await run({ exec: { avgPrice: "0", price: "74000" } });
  const filled = r.rec.storeWrites.find(w => w.info.status === "FILLED");
  assert.equal(filled.info.fillPrice, 0, "동작이 바뀌었다 — 위 주석을 다시 볼 것");
});

test("체결 시각을 남긴다 (복구가 이걸로 최근 기록을 고른다)", async () => {
  const before = Date.now();
  const r = await run();
  const filled = r.rec.storeWrites.find(w => w.info.status === "FILLED");
  assert.ok(filled.filledAt ?? filled.info.filledAt >= before, "체결 시각이 없다");
});

test("체결가·체결시각이 **끝까지 남는다** (2026-09-04에 고친 결함)", async () => {
  // 예전엔 나중 `store.set`이 옛 `info`를 다시 펼쳐서 이 두 필드를 지웠다.
  // 재시작 복구(`pickRecoverable`)는 fillPrice가 없는 기록을 낡은 것으로 보고
  // **거부**하므로, 정작 복구가 필요한 TPSL_PARTIAL이 대상에서 빠졌다.
  // ⚠ 네 상태 모두 남아 있어야 한다 — 하나만 빠뜨리면 그 경로만 조용히 복구 불가다
  const ok = await run();
  assert.equal(ok.saved.status, "TPSL_PLACED");
  assert.equal(ok.saved.fillPrice, 70000);
  assert.ok(ok.saved.filledAt > 0);

  const partial = await run({
    placeTPSL: async () => ({ tp: null, sl: null, failed: [{ type: "SL", error: "x" }] }),
  });
  assert.equal(partial.saved.status, "TPSL_PARTIAL");
  assert.equal(partial.saved.fillPrice, 70000, "복구가 가장 필요한 상태에서 사라졌다");
  assert.ok(partial.saved.filledAt > 0);

  const missing = await run({ info: watching({ sl: null }) });
  assert.equal(missing.saved.status, "TPSL_MISSING");
  assert.equal(missing.saved.fillPrice, 70000);
});

// ── TP/SL 가격이 없을 때 ───────────────────────────────────────────────────
test("TP/SL 가격이 없으면 **멈추고 빨간 배너를 띄운다** (지어내지 않는다)", async () => {
  for (const missing of [{ tp: null }, { sl: null }, { tp: null, sl: null }]) {
    const r = await run({ info: watching(missing) });
    assert.equal(r.saved.status, "TPSL_MISSING", JSON.stringify(missing));
    assert.equal(r.rec.placed.length, 0, "가격도 없이 주문을 걸었다");
    assert.equal(r.alerts("critical").length, 1, "빨간 배너가 없다");
    assert.match(r.alerts("critical")[0].msg, /TP\/SL 가격 없음/);
    assert.ok(r.evt("TPSL_MISSING_INFO").length, "기록을 안 남겼다");
  }
});

// ── 정상 경로 ──────────────────────────────────────────────────────────────
test("성공하면 TPSL_PLACED로 바뀌고 경보가 없다", async () => {
  const r = await run();
  assert.equal(r.saved.status, "TPSL_PLACED");
  assert.equal(r.rec.placed.length, 1, "TP/SL을 안 걸었다");
  assert.equal(r.alerts("critical").length, 0, "멀쩡한데 빨간 배너가 떴다");
  assert.ok(r.evt("ENTRY_FILLED").length, "체결을 안 남겼다");
  assert.ok(r.evt("TPSL_PLACED").length);
  // 화면이 바로 따라와야 한다 — 안 알리면 폴링(60초) 전까지 안 보인다
  assert.ok(r.rec.updates.flat().includes("tpsl"), "프론트에 TP/SL 갱신을 안 알렸다");
});

test("성공하면 앞서 뜬 SL 실패 배너를 **거둔다**", async () => {
  // ⚠ 안 거두면 화면은 계속 `SL 등록 실패`라고 거짓말한다 (2026-09-03 감사)
  const r = await run();
  const cleared = r.rec.alerts.filter(a => a.level === "clear");
  assert.ok(cleared.length >= 1, "실패 배너를 거두지 않았다");
  assert.ok(cleared.some(a => /111/.test(a.msg)), "그 주문의 배너를 안 거뒀다");
});

// ── 실패했을 때: 손절과 익절을 다르게 다룬다 ───────────────────────────────
test("SL 실패는 **빨간 배너** — 포지션이 무방비다", async () => {
  const r = await run({
    placeTPSL: async () => ({ tp: { orderId: "TP1" }, sl: null,
                              failed: [{ type: "SL", error: "-2021" }] }),
  });
  assert.equal(r.saved.status, "TPSL_PARTIAL");
  assert.equal(r.alerts("critical").length, 1, "SL이 없는데 빨간 배너가 없다");
  assert.equal(r.alerts("notice").length, 0);
  // 사유를 남겨야 나중에 로그로 되짚을 수 있다 (콘솔은 사라진다)
  const [e] = r.evt("TPSL_PARTIAL");
  assert.ok(e.errors.some(x => /2021/.test(x.msg)), "거절 사유를 안 남겼다");
});

test("TP만 실패하면 **금색 토스트** — 손절은 걸려 있다", async () => {
  const r = await run({
    placeTPSL: async () => ({ tp: null, sl: { orderId: "SL1" },
                              failed: [{ type: "TP", error: "-4131" }] }),
  });
  assert.equal(r.saved.status, "TPSL_PARTIAL");
  assert.equal(r.alerts("critical").length, 0, "익절만 빠졌는데 빨간 배너가 떴다");
  assert.equal(r.alerts("notice").length, 1, "알리긴 해야 한다");
  assert.match(r.alerts("notice")[0].msg, /TP 등록 실패/);
});

test("둘 다 실패하면 빨간 배너와 토스트가 함께 뜬다", async () => {
  const r = await run({
    placeTPSL: async () => ({ tp: null, sl: null,
                              failed: [{ type: "TP", error: "x" }, { type: "SL", error: "y" }] }),
  });
  assert.equal(r.alerts("critical").length, 1);
  assert.equal(r.alerts("notice").length, 1);
});

test("실패해도 **화면에는 알린다** — 포지션은 이미 생겼다", async () => {
  const r = await run({
    placeTPSL: async () => ({ tp: null, sl: null, failed: [{ type: "SL", error: "y" }] }),
  });
  assert.ok(r.rec.updates.flat().includes("position"), "포지션 갱신을 안 알렸다");
});

// ── 일일 손실 한도: 체결은 막을 수 없다 ────────────────────────────────────
test("체결 뒤 한도를 넘었으면 알리되 **TP/SL은 그대로 건다**", async () => {
  // ⚠ 체결 자체는 되돌릴 수 없다. 여기서 멈추면 손절 없는 포지션이 남는다 —
  //   알리기만 하고 보호는 반드시 건다
  const r = await run({
    dailyLoss: async () => { throw new Error("오늘 손실 한도(4%)에 도달했습니다"); },
  });
  assert.equal(r.rec.placed.length, 1, "한도를 넘었다고 손절을 안 걸었다");
  assert.equal(r.saved.status, "TPSL_PLACED");
  assert.ok(r.alerts("critical").some(a => /수동 청산/.test(a.msg)), "사용자에게 안 알렸다");
  assert.ok(r.evt("DAILY_LOSS_CHECK_FAILED").length);
});

// ── 사이드 ─────────────────────────────────────────────────────────────────
test("숏 체결도 같은 길을 지난다 (주문 방향 → 포지션 방향)", async () => {
  const r = await run({ info: watching({ side: "SELL", closeSide: "BUY", tp: 60000, sl: 75000 }) });
  assert.equal(r.saved.status, "TPSL_PLACED");
  const [e] = r.evt("ENTRY_FILLED");
  assert.equal(e.posSide, "SHORT", "SELL을 SHORT로 안 읽었다");
  assert.equal(e.orderSide, "SELL");
});
