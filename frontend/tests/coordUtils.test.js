// 캔들 인덱스 ↔ 타임스탬프
//
// ⚠ 도형 좌표는 timestamp라 **전 TF가 공유한다**. 이 변환이 틀리면 1h에서 그린
//   선이 4h에서 다른 자리에 붙는다. 그리고 월봉은 달마다 길이가 달라서
//   `+ n * interval`로 외삽하면 **한 칸마다 하루씩 밀린다** (2026-08-24 실측).

import test from "node:test";
import assert from "node:assert/strict";
import { addMonthsUTC, idxToTimestamp, getCandleMs } from "../src/utils/coordUtils.js";

const HOUR = 3600000;
const DAY  = 86400000;

const ymd = (ts) => new Date(ts).toISOString().slice(0, 10);
const bars = (ts) => ts.map(t => ({ t }));

// 바이낸스 월봉은 그 달 1일 00:00 UTC에 열린다
const MONTHLY = bars([
  Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1),
  Date.UTC(2026, 3, 1), Date.UTC(2026, 4, 1), Date.UTC(2026, 5, 1),
]);

test("addMonthsUTC — 항상 그 달 1일 00:00 UTC로 떨어진다", () => {
  assert.equal(ymd(addMonthsUTC(Date.UTC(2026, 0, 17, 13, 45), 1)), "2026-02-01");
  assert.equal(ymd(addMonthsUTC(Date.UTC(2026, 0, 1), 0)),         "2026-01-01");
});

test("addMonthsUTC — 해를 넘어간다", () => {
  assert.equal(ymd(addMonthsUTC(Date.UTC(2026, 11, 1), 1)), "2027-01-01");
  assert.equal(ymd(addMonthsUTC(Date.UTC(2026,  0, 1), -1)), "2025-12-01");
});

test("addMonthsUTC — 31일에서 짧은 달로 가도 넘치지 않는다", () => {
  // 1월 31일 + 1개월. 날짜를 그대로 옮기면 3월 3일이 된다
  assert.equal(ymd(addMonthsUTC(Date.UTC(2026, 0, 31), 1)), "2026-02-01");
});

test("월봉 오른쪽 빈 칸은 한 칸에 한 달씩 간다 (2026-08-24 회귀)", () => {
  // 옛 코드는 첫 두 봉의 간격(1월→2월 = 31일)을 모든 달에 곱해서,
  // 오른쪽 여섯 칸이 전부 한 달씩 뒤처졌다 — 8월이 두 번 있는 것처럼 보였다
  const last = MONTHLY.length - 1;   // 2026-06-01
  const got = [1, 2, 3, 4, 5, 6].map(n => ymd(idxToTimestamp(last + n, MONTHLY)));
  assert.deepEqual(got, [
    "2026-07-01", "2026-08-01", "2026-09-01",
    "2026-10-01", "2026-11-01", "2026-12-01",
  ]);
});

test("월봉 왼쪽 빈 칸도 달력을 따라간다", () => {
  assert.equal(ymd(idxToTimestamp(-1, MONTHLY)), "2025-12-01");
  assert.equal(ymd(idxToTimestamp(-3, MONTHLY)), "2025-10-01");
});

test("주봉은 달 단위가 아니다 — 7일씩 간다", () => {
  const weekly = bars([0, 7 * DAY, 14 * DAY]);
  assert.equal(idxToTimestamp(3, weekly), 21 * DAY);
  assert.equal(idxToTimestamp(5, weekly), 35 * DAY);
});

test("캔들이 있는 구간은 그 봉의 시각을 그대로 쓴다 (계산하지 않는다)", () => {
  // 간격이 고르지 않아도 — 거래소가 봉을 빼먹은 구간이 있어도 — 정확해야 한다
  const gappy = bars([0, HOUR, 5 * HOUR, 6 * HOUR]);
  assert.equal(idxToTimestamp(0, gappy), 0);
  assert.equal(idxToTimestamp(2, gappy), 5 * HOUR);
  assert.equal(idxToTimestamp(3, gappy), 6 * HOUR);
});

test("소수 인덱스는 가까운 봉으로 반올림한다", () => {
  const h = bars([0, HOUR, 2 * HOUR]);
  assert.equal(idxToTimestamp(1.4, h), HOUR);
  assert.equal(idxToTimestamp(1.6, h), 2 * HOUR);
});

test("범위를 벗어난 인덱스도 값을 낸다 — 캔들 하나뿐이면 그 봉이다", () => {
  const one = bars([12345]);
  assert.equal(idxToTimestamp(0,   one), 12345);
  assert.equal(idxToTimestamp(99,  one), 12345);
  assert.equal(idxToTimestamp(-99, one), 12345);
});

test("캔들이 없으면 0이다 (심볼을 막 바꾼 직후가 그렇다)", () => {
  assert.equal(idxToTimestamp(0, []), 0);
  assert.equal(idxToTimestamp(7, []), 0);
});

test("getCandleMs — 앞의 두 봉이 간격을 정한다", () => {
  assert.equal(getCandleMs(bars([0, HOUR, 2 * HOUR])), HOUR);
  assert.equal(getCandleMs(bars([0, 5 * 60000])),      5 * 60000);
});

test("getCandleMs — 봉이 모자라면 1시간으로 본다", () => {
  assert.equal(getCandleMs([]),           HOUR);
  assert.equal(getCandleMs(bars([1000])), HOUR);
});
