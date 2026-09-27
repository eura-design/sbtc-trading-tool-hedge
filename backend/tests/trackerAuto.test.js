// 월별 결산 자동 기록 — 저장·순서·다시 받는 범위
//
// ⚠ **진짜 결산 파일(`기타/tracker_data.json`)을 절대 건드리지 않는다.** 실제 금액이다.
//   저장소·거래소·로그를 전부 가짜로 끼워 넣고 시험한다 (require.cache에 먼저 심는다).

const test   = require("node:test");
const assert = require("node:assert/strict");
const path   = require("path");
const express = require("express");

const R = (rel) => require.resolve(path.join(__dirname, "..", rel));
const { localMonth } = require("../utils/trackerMonths");

/** 가짜 저장소 — `loads`를 차례로 돌려준다 (마지막 것은 계속). 저장한 것은 `saved`에 */
function fakeStore(loads) {
  const saved = [];
  let i = 0;
  return {
    saved,
    mod: {
      load: () => JSON.parse(JSON.stringify(loads[Math.min(i++, loads.length - 1)])),
      save: (d) => { saved.push(JSON.parse(JSON.stringify(d))); return true; },
      DEFAULTS: {}, FILE: "(가짜)",
    },
  };
}

function plant(rel, exportsObj) {
  const id = R(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj, children: [], paths: [] };
  return id;
}
function unplant(ids) { for (const id of ids) delete require.cache[id]; }

async function loadTrackerAuto({ store, income = [], balance = 1000 }) {
  const ids = [
    plant("store/trackerStore.js", store),
    plant("store/logStore.js", { log: () => {}, errOf: (e) => ({ msg: String(e?.message ?? e) }) }),
    plant("services/binanceClient.js", {
      binance: async (m, p) => {
        if (p === "/fapi/v1/income")  return { data: income };
        if (p === "/fapi/v2/balance") return { data: [{ asset: "USDT", balance: String(balance) }] };
        return { data: [] };
      },
    }),
  ];
  const svcId = R("services/trackerAuto.js");
  delete require.cache[svcId];
  const mod = require(svcId);
  return { mod, done: () => { delete require.cache[svcId]; unplant(ids); } };
}

const CUR = localMonth(Date.now());

test("⚠ 저장 직전에 다시 읽는다 — 그 사이 **손으로 넣은 줄이 사라지지 않는다** (고친 경쟁 조건)", async () => {
  // 첫 읽기: 이번 달 자동 줄만 / 두 번째 읽기: 그 사이 결산 페이지에서 2월을 손으로 넣었다
  const before = { seed: 100, entries: [{ month: CUR, asset: 900, deposit: 0, withdrawal: 0, auto: true }], autoSkip: [] };
  const during = { ...before, entries: [{ month: "2020-02", asset: 50, deposit: 0, withdrawal: 0 }, ...before.entries] };
  const st = fakeStore([before, during]);
  const { mod, done } = await loadTrackerAuto({
    store: st.mod, balance: 1000,
    income: [{ tranId: 1, time: Date.now(), incomeType: "REALIZED_PNL", income: "10" }],
  });
  try {
    const r = await mod.syncTracker();
    assert.equal(r.ok, true);
    assert.equal(st.saved.length, 1);
    const months = st.saved[0].entries.map(e => e.month);
    assert.ok(months.includes("2020-02"), "손으로 넣은 줄이 옛 내용 위에 덮여 사라졌다");
    const manual = st.saved[0].entries.find(e => e.month === "2020-02");
    assert.equal(manual.asset, 50, "손으로 넣은 값은 그대로여야 한다");
    assert.equal(manual.auto, undefined);
  } finally { done(); }
});

test("seed·autoSkip도 다시 읽은 것을 쓴다 (페이지에서 바꿨을 수 있다)", async () => {
  const before = { seed: 100, entries: [{ month: CUR, asset: 900, deposit: 0, withdrawal: 0, auto: true }], autoSkip: [] };
  const during = { ...before, seed: 250, autoSkip: ["2020-01"] };
  const st = fakeStore([before, during]);
  const { mod, done } = await loadTrackerAuto({
    store: st.mod, balance: 1000,
    income: [{ tranId: 1, time: Date.now(), incomeType: "REALIZED_PNL", income: "10" }],
  });
  try {
    await mod.syncTracker();
    assert.equal(st.saved[0].seed, 250);
    assert.deepEqual(st.saved[0].autoSkip, ["2020-01"]);
  } finally { done(); }
});

test("이번 달 자동 줄을 지웠으면(autoSkip) **전 기간을 다시 받지 않는다**", async () => {
  const { mod, done } = await loadTrackerAuto({ store: fakeStore([{ seed: 1, entries: [], autoSkip: [] }]).mod });
  try {
    const entries = [{ month: "2020-01", asset: 1 }];
    assert.equal(mod.earliestNeededMonth(entries, Date.now(), [CUR]), CUR,
      "지운 달을 '비어 있다'로 읽으면 그 달 내내 매시간 전 기간을 긁는다");
    assert.equal(mod.earliestNeededMonth(entries, Date.now(), []), null,
      "지우지 않고 없는 것은 여전히 '어디까지 비었는지 모른다' → 전 기간 (회귀)");
    assert.equal(mod.earliestNeededMonth([{ month: CUR }], Date.now()), CUR, "있으면 이번 달부터 (회귀)");
  } finally { done(); }
});

// ── 결산 저장 라우트 — 달 순서 ─────────────────────────────────────────────
test("⚠ 저장할 때 **달 순서로 정렬한다** — 앞선 달을 뒤늦게 넣어도 수익 계산이 어긋나지 않게", async () => {
  const st = fakeStore([{ seed: 1, entries: [], autoSkip: [] }]);
  const ids = [
    plant("store/trackerStore.js", st.mod),
    plant("store/logStore.js", { log: () => {}, errOf: () => ({}) }),
  ];
  const routeId = R("routes/tracker.js");
  delete require.cache[routeId];
  const app = express();
  app.use(express.json());
  app.use("/", require(routeId));
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      // 페이지가 보내는 그대로 — 새 줄(2월)이 맨 끝에 붙어 있다
      body: JSON.stringify({ seed: 100, autoSkip: [], entries: [
        { month: "2026-03", asset: 110 }, { month: "2026-09", asset: 200 }, { month: "2026-02", asset: 100 },
      ] }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(st.saved[0].entries.map(e => e.month), ["2026-02", "2026-03", "2026-09"]);
  } finally {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
    delete require.cache[routeId];
    unplant(ids);
  }
});
