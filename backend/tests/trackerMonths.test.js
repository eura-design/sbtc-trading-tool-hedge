// 월별 결산 자동 기록의 계산 — `utils/trackerMonths.js`
//
// 여기서 지키는 것 둘:
//   ① 역산이 맞는가 — 지금 잔고에서 거꾸로 내려온 월말 잔고가 실제와 맞는가
//   ② **손으로 넣은 줄을 덮어쓰지 않는가** (`mergeAuto`). 이게 깨지면 다시 만들 수 없는
//      기록이 조용히 사라진다 (`store/trackerStore.js` 머리말 참고)

const test   = require("node:test");
const assert = require("node:assert/strict");
const {
  localMonth, nextMonth, groupByMonth, withMonthEndBalance, toEntries, mergeAuto,
} = require("../utils/trackerMonths");

// 로컬 시간으로 그 달 15일 정오 — 시간대가 어디든 그 달 안에 들어간다
const at = (y, m, d = 15) => new Date(y, m - 1, d, 12, 0, 0).getTime();
const inc = (y, m, type, amount, d = 15) =>
  ({ time: at(y, m, d), income: String(amount), incomeType: type });

test("달 경계는 로컬 시간 기준이다", () => {
  assert.equal(localMonth(at(2026, 9, 1)), "2026-09");
  assert.equal(localMonth(at(2026, 9, 30)), "2026-09");
  assert.equal(nextMonth("2026-09"), "2026-10");
  assert.equal(nextMonth("2026-12"), "2027-01");   // 해를 넘긴다
});

test("TRANSFER는 순합으로 센다 — 넣었다 뺐다 하면 상쇄된다", () => {
  // 실측(2026-09-26): 하루에 +140, −100, +100이 있었다 → 순 유입 140
  const g = groupByMonth([
    inc(2026, 9, "TRANSFER", 140),
    inc(2026, 9, "TRANSFER", -100),
    inc(2026, 9, "TRANSFER", 100),
  ], at(2026, 9, 26));
  assert.equal(g.length, 1);
  assert.equal(g[0].transfer, 140, "순합이 아니라 총액을 셌다");
});

test("거래가 없는 달도 표에 나온다 — 5월 → 7월로 건너뛰지 않는다", () => {
  const g = groupByMonth([
    inc(2026, 5, "REALIZED_PNL", 10),
    inc(2026, 7, "REALIZED_PNL", 20),
  ], at(2026, 7, 20));
  assert.deepEqual(g.map(x => x.month), ["2026-05", "2026-06", "2026-07"]);
  assert.equal(g[1].total, 0, "빈 달의 변화량은 0이어야 한다");
});

test("income이 끊긴 뒤의 달도 이번 달까지 채운다", () => {
  const g = groupByMonth([inc(2026, 5, "REALIZED_PNL", 10)], at(2026, 8, 3));
  assert.deepEqual(g.map(x => x.month), ["2026-05", "2026-06", "2026-07", "2026-08"]);
});

test("월말 잔고를 지금 잔고에서 거꾸로 채운다", () => {
  const g = groupByMonth([
    inc(2026, 7, "REALIZED_PNL", 100),
    inc(2026, 8, "REALIZED_PNL", -30),
    inc(2026, 9, "TRANSFER", 500),
  ], at(2026, 9, 20));
  const rows = withMonthEndBalance(g, 1570);   // 지금 잔고
  assert.equal(rows[2].asset, 1570, "이번 달 월말 잔고 = 지금 잔고");
  assert.equal(rows[1].asset, 1070, "1570 − 500");
  assert.equal(rows[0].asset, 1100, "1070 − (−30)");
});

test("잔고 변화량 합계와 월말 잔고가 어긋나지 않는다", () => {
  const g = groupByMonth([
    inc(2026, 3, "TRANSFER", 1000), inc(2026, 3, "REALIZED_PNL", -50.5),
    inc(2026, 4, "COMMISSION", -1.25), inc(2026, 4, "FUNDING_FEE", 0.75),
  ], at(2026, 4, 28));
  const rows = withMonthEndBalance(g, 949);
  const first = rows[0].asset - rows[0].total;          // 첫 달 이전 잔고
  const sum = rows.reduce((s, r) => s + r.total, 0);
  assert.equal(Math.round((first + sum) * 100) / 100, 949, "역산이 지금 잔고로 돌아오지 않는다");
});

test("TRANSFER 부호가 입금·출금으로 갈린다", () => {
  const e = toEntries([
    { month: "2026-03", transfer:  500, total: 500, asset: 500 },
    { month: "2026-04", transfer: -200, total: -200, asset: 300 },
    { month: "2026-05", transfer:    0, total: 0, asset: 300 },
  ]);
  assert.deepEqual([e[0].deposit, e[0].withdrawal], [500, 0]);
  assert.deepEqual([e[1].deposit, e[1].withdrawal], [0, 200], "출금은 양수로 적는다");
  assert.deepEqual([e[2].deposit, e[2].withdrawal], [0, 0]);
  assert.ok(e.every(x => x.auto === true), "자동이 넣은 줄에는 표시가 있어야 한다");
});

// ── mergeAuto — 이 기능의 안전장치 ──────────────────────────────────────────
const autoRow = (month, asset, deposit = 0) => ({ month, asset, deposit, withdrawal: 0, auto: true });

test("빈 표에는 전부 들어간다", () => {
  const r = mergeAuto([], [autoRow("2026-03", 100), autoRow("2026-04", 200)]);
  assert.equal(r.added, 2);
  assert.deepEqual(r.entries.map(e => e.month), ["2026-03", "2026-04"]);
});

test("⚠ 손으로 넣은 줄은 덮어쓰지 않는다", () => {
  const mine = { month: "2026-03", asset: 9999, deposit: 7, withdrawal: 3 };   // auto 표시가 없다
  const r = mergeAuto([mine], [autoRow("2026-03", 100, 50)]);
  assert.equal(r.kept, 1);
  assert.equal(r.updated, 0);
  assert.deepEqual(r.entries[0], mine, "사람이 넣은 값이 바뀌었다");
});

test("자동이 넣은 줄은 갱신한다 — 이번 달 잔고가 굳지 않게", () => {
  const r = mergeAuto([autoRow("2026-09", 1000)], [autoRow("2026-09", 1200)]);
  assert.equal(r.updated, 1);
  assert.equal(r.entries[0].asset, 1200);
});

test("값이 그대로면 갱신으로 세지 않는다", () => {
  const r = mergeAuto([autoRow("2026-09", 1000)], [autoRow("2026-09", 1000)]);
  assert.equal(r.updated, 0);
  assert.equal(r.added, 0);
});

test("⚠ autoSkip에 적힌 달은 되살리지 않는다 — 지울 방법이 있어야 한다", () => {
  const r = mergeAuto([], [autoRow("2026-05", 100), autoRow("2026-06", 200)], ["2026-05"]);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.entries.map(e => e.month), ["2026-06"], "지운 달이 되살아났다");
});

test("합친 결과는 월 순으로 정렬된다", () => {
  const r = mergeAuto([autoRow("2026-12", 3)], [autoRow("2026-02", 1), autoRow("2027-01", 4)]);
  assert.deepEqual(r.entries.map(e => e.month), ["2026-02", "2026-12", "2027-01"]);
});
