// 월별 결산을 income에서 만들어내는 **순수 함수들** (2026-09-26 사용자 요청)
//
// 거래소 호출도 파일 접근도 없다 — `services/trackerAuto.js`가 값을 받아 여기에 넘긴다.
// 돈이 걸린 계산이라 `tests/trackerMonths.test.js`가 여기만 따로 검산한다.
//
// ── 사용자가 정한 규칙 (2026-09-26) ─────────────────────────────────────────
// [1] 한 달의 경계는 **이 컴퓨터의 로컬 시간**이다 (`store/logStore.js`의 localDate와 같은
//     관례). 바이낸스는 시각을 UTC로 주는데 그대로 자르면 "9월"이 한국시간 9월 1일 오전
//     9시~10월 1일 오전 9시가 되어, 사람이 읽는 결산표가 9시간 어긋난다.
// [2] 월말 잔고에 **미실현 손익을 넣지 않는다.** 확정된 지갑 잔고만 쓴다.
//     넣으면 다음 달에 청산되면서 그 달 수익으로 또 잡혀 **같은 돈을 두 번 센다.**
// [3] 입금·출금은 그 달 `TRANSFER`의 **순합**이다. 양수면 입금, 음수면 출금.
//     총액을 따로 적지 않는다 — 현물↔선물로 넣었다 뺐다 하면(실측: 하루에 +140/−100/+100)
//     총 입금이 실제보다 커 보이고, 월 수익률의 분모도 같이 부풀어 수익률이 낮게 나온다.
// [4] `TRANSFER`가 **밖에서 온 새 돈인지 현물에서 옮겨온 내 돈인지 가리지 않는다.**
//     선물 API로는 구분할 방법이 없다(진짜 외부 입금은 `/sapi` 계열에 있고, 이 시스템은
//     그 계열을 부르지 않는다). 이 표가 재는 것은 **선물 계정의 성적**이므로, 어디서 왔든
//     "내가 번 게 아니라 넣은 돈"으로 세는 것이 맞다.
// [5] 손으로 넣은 달은 **절대 덮어쓰지 않는다** (`mergeAuto` 참고).
//
// ⚠ 월말 잔고는 **시드머니에서 더해 올리지 않는다.** 지금 지갑 잔고에서 거꾸로 내려온다.
//   시드머니는 사용자가 손으로 적는 값이라, 그 값을 기준으로 삼으면 사용자가 시드를
//   고치는 순간 과거 월말 잔고가 전부 따라 움직인다. 지갑 잔고는 거래소가 아는 사실이다.

/** 로컬 시간 기준 `YYYY-MM` ([1]) */
function localMonth(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** `"2026-09"` → `"2026-10"` */
function nextMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return localMonth(new Date(y, m, 1).getTime());   // Date의 월은 0부터라 m이 곧 다음 달이다
}

/** USDT는 소수 2자리까지 적는다 — 부동소수 오차가 표에 그대로 보이지 않게 */
const round2 = n => Math.round(n * 100) / 100;

/**
 * income 기록을 달별로 묶는다.
 *
 * @param incomes `/fapi/v1/income` 응답 배열 — `{ time, income, incomeType }`.
 *                `income`은 문자열로 온다 (`"0.12340000"`).
 * @param nowMs   지금 시각. **income이 끊긴 뒤의 달도 표에 나와야** 하므로 여기까지 채운다
 *                (6월에 아무 거래가 없어도 5월 → 7월로 건너뛰면 결산표가 이상해진다)
 * @returns 시간순 `[{ month, transfer, total }]`
 *          `transfer` = 그 달 TRANSFER 순합 ([3]) / `total` = 그 달 지갑 잔고 변화량 전부
 */
function groupByMonth(incomes, nowMs = Date.now()) {
  if (!incomes?.length) return [];

  const acc = new Map();
  let firstMonth = null;
  for (const r of incomes) {
    const t = Number(r.time);
    const v = parseFloat(r.income);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    const k = localMonth(t);
    if (firstMonth === null || k < firstMonth) firstMonth = k;
    const cur = acc.get(k) ?? { transfer: 0, total: 0 };
    cur.total += v;
    if (r.incomeType === "TRANSFER") cur.transfer += v;
    acc.set(k, cur);
  }
  if (firstMonth === null) return [];

  // 첫 달부터 이번 달까지 **빈 달도 채운다**
  const out = [];
  const lastMonth = localMonth(nowMs);
  for (let k = firstMonth; k <= lastMonth; k = nextMonth(k)) {
    const cur = acc.get(k) ?? { transfer: 0, total: 0 };
    out.push({ month: k, transfer: round2(cur.transfer), total: round2(cur.total) });
    if (out.length > 600) break;   // 50년치 — 무한 루프 방지
  }
  return out;
}

/**
 * 월말 잔고를 **지금 잔고에서 거꾸로** 채운다 (파일 머리말의 ⚠ 참고).
 *
 * 마지막 달(= 이번 달)의 월말 잔고는 지금 잔고다. 아직 끝나지 않은 달이므로 "지금까지"라는
 * 뜻이고, 달이 끝나면 그 값이 그대로 확정된다.
 *   그 앞 달 월말 잔고 = 뒤 달 월말 잔고 − 뒤 달 변화량
 *
 * @param groups  groupByMonth 결과 (시간순)
 * @param balance 지금 지갑 잔고 (USDT, 미실현 제외 — [2])
 * @returns `[{ month, transfer, total, asset }]`
 */
function withMonthEndBalance(groups, balance) {
  const out = groups.map(g => ({ ...g }));
  let bal = balance;
  for (let i = out.length - 1; i >= 0; i--) {
    out[i].asset = round2(bal);
    bal -= out[i].total;
  }
  return out;
}

/**
 * 자동 계산 결과를 결산표 한 줄 모양으로 — `{ month, asset, deposit, withdrawal, auto }`.
 * `auto: true`는 "이 줄은 자동이 넣었다"는 표시다. 이 표시가 있는 줄만 자동이 다시 고친다.
 */
function toEntries(rows) {
  return rows.map(r => ({
    month:      r.month,
    asset:      r.asset,
    deposit:    r.transfer > 0 ?  round2(r.transfer) : 0,
    withdrawal: r.transfer < 0 ? -round2(r.transfer) : 0,
    auto:       true,
  }));
}

/**
 * 자동 결과를 이미 저장된 표에 합친다.
 *
 * ⚠ **이 함수가 이 기능의 안전장치다.** `store/trackerStore.js`에 "결산 기록은 손으로 넣은
 *   값이라 다시 만들 수 없다"고 적혀 있고, 그래서 저장이 임시 파일 + rename 방식이다.
 *   규칙은 셋뿐이다:
 *     · 저장된 줄에 `auto` 표시가 **없으면** 사람이 넣은 것이다 → **그대로 둔다**
 *     · `auto: true`면 자동이 넣은 것이다 → 새 값으로 **갱신한다**
 *       (이번 달은 아직 안 끝나서 잔고가 매시간 바뀐다. 갱신하지 않으면 첫 값에 굳는다)
 *     · `autoSkip`에 적힌 달은 **넣지 않는다** — 사용자가 자동 줄을 지웠다는 뜻이다.
 *       이게 없으면 지운 줄이 다음 실행에 되살아나 **지울 방법이 없어진다**
 *
 * @returns `{ entries, added, updated, kept, skipped }` — entries는 월 순으로 정렬돼 있다
 */
function mergeAuto(existing, autoEntries, autoSkip = []) {
  const skip = new Set(autoSkip);
  const byMonth = new Map((existing ?? []).map(e => [e.month, e]));
  let added = 0, updated = 0, kept = 0, skipped = 0;

  for (const row of autoEntries) {
    if (skip.has(row.month)) { skipped++; continue; }
    const old = byMonth.get(row.month);
    if (!old)            { byMonth.set(row.month, row); added++;   continue; }
    if (old.auto !== true) { kept++; continue; }        // 사람이 넣은 줄 — 손대지 않는다
    // 값이 같으면 갱신으로 세지 않는다 (로그가 매시간 "갱신했다"로 도배되지 않게)
    if (old.asset === row.asset && old.deposit === row.deposit && old.withdrawal === row.withdrawal) continue;
    byMonth.set(row.month, row);
    updated++;
  }

  const entries = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  return { entries, added, updated, kept, skipped };
}

module.exports = { localMonth, nextMonth, round2, groupByMonth, withMonthEndBalance, toEntries, mergeAuto };
