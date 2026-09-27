// income을 페이지로 끝까지 받기 — `routes/stats.js`·`services/trackerAuto.js` 공용
//
// ⚠ 예전 방식은 다음 페이지를 "마지막 시각 + 1ms"부터 받아, **같은 시각에 몰린 기록이
//   1000건 경계에 걸리면 뒤쪽이 빠졌다.** 펀딩비는 모든 코인에 같은 시각으로 붙어서
//   그런 몰림이 흔하다 (실측 31일에 7번). 빠져도 에러가 없어 금액이 틀린 줄 모른다.

const test   = require("node:test");
const assert = require("node:assert/strict");
const { fetchIncomePages } = require("../utils/incomePages");

/** 가짜 거래소 — `startTime` 이상인 기록을 시간순으로 `limit`개까지 준다 (진짜와 같다) */
function exchange(rows, limit) {
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  const calls = [];
  const fetchPage = async (from) => {
    calls.push(from);
    return sorted.filter(r => r.time >= from).slice(0, limit);
  };
  return { fetchPage, calls };
}
const row = (tranId, time, incomeType = "FUNDING_FEE") => ({ tranId, time, incomeType, income: "-0.1" });

test("⚠ 페이지 경계가 같은 시각 한가운데 걸려도 **하나도 빠지지 않는다** (고친 버그)", async () => {
  // 한 페이지 4건. 시각 300에 3건이 몰려 있고 경계가 그 사이에 걸린다
  const rows = [row(1, 100), row(2, 200), row(3, 300), row(4, 300), row(5, 300), row(6, 400)];
  const { fetchPage } = exchange(rows, 4);
  const out = await fetchIncomePages(fetchPage, 0, { limit: 4 });
  assert.deepEqual(out.map(r => r.tranId).sort(), [1, 2, 3, 4, 5, 6],
    "예전 방식(+1ms)이면 시각 300의 뒤쪽 두 건이 빠진다");
});

test("겹쳐 받은 기록은 한 번만 센다 (중복 없음)", async () => {
  const rows = [row(1, 100), row(2, 300), row(3, 300), row(4, 300), row(5, 500)];
  const { fetchPage } = exchange(rows, 3);
  const out = await fetchIncomePages(fetchPage, 0, { limit: 3 });
  assert.equal(out.length, 5);
  assert.equal(new Set(out.map(r => r.tranId)).size, 5);
});

test("중복 키는 `tranId + incomeType`이다 — 같은 tranId라도 종류가 다르면 둘 다 센다", async () => {
  // CLAUDE.md: tranId 단독은 유일하지 않다 (한 체결에 손익과 수수료가 같은 tranId로 온다)
  const rows = [{ tranId: 7, time: 100, incomeType: "REALIZED_PNL", income: "5" },
                { tranId: 7, time: 100, incomeType: "COMMISSION",   income: "-0.1" }];
  const { fetchPage } = exchange(rows, 1000);
  const out = await fetchIncomePages(fetchPage, 0);
  assert.equal(out.length, 2);
});

test("같은 1ms에 한 페이지를 넘게 몰려도 **멈춘다** (영원히 돌지 않는다)", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(i + 1, 100));
  const { fetchPage, calls } = exchange(rows, 3);
  const out = await fetchIncomePages(fetchPage, 0, { limit: 3, maxPages: 50 });
  assert.ok(calls.length < 50, `${calls.length}번 불렀다 — 무한 반복`);
  assert.ok(out.length >= 3);
});

test("한 페이지에 다 들어오면 한 번만 부른다 (지금 이 계정 규모)", async () => {
  const rows = [row(1, 100), row(2, 200)];
  const { fetchPage, calls } = exchange(rows, 1000);
  const out = await fetchIncomePages(fetchPage, 0);
  assert.equal(out.length, 2);
  assert.equal(calls.length, 1);
});
