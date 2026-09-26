// 월별 결산을 **자동으로 채운다** (2026-09-26 사용자 요청: "완전 자동으로")
//
// 계산 규칙은 전부 `utils/trackerMonths.js`에 있다 — 여기는 거래소에서 받아와 넘기고,
// 결과를 `store/trackerStore`에 쓰는 일만 한다. 그렇게 나눈 이유는 돈이 걸린 계산을
// `tests/trackerMonths.test.js`가 거래소 없이 검산할 수 있어야 해서다.
//
// ── 무엇을 받아오나 ────────────────────────────────────────────────────────
// `/fapi/v1/income` — **종류 필터를 걸지 않는다.** 지갑 잔고를 움직이는 항목 전부가
//   필요하다 (REALIZED_PNL · COMMISSION · FUNDING_FEE · TRANSFER …). 하나라도 빠지면
//   월말 잔고 역산이 그만큼 어긋난다.
//   ⚠ 심볼 필터도 걸지 않는다 — 계정 전체 결산이다 (`incomeLogger`·`dailyloss`와 같은 이유).
// `/fapi/v2/balance` — USDT 지갑 잔고. **미실현은 포함되지 않는다**(`balance` 필드).
//   사용자가 정한 규칙이다 (trackerMonths [2]).
//
// ── 얼마나 과거까지 받아오나 ───────────────────────────────────────────────
// 실측(2026-09-26): 300일 전 창을 물어도 에러 없이 0건이 오고, 이 계정의 첫 기록은
// 2026-03-01이었다. 바이낸스 쪽 기간 제한에 걸리지 않는다.
//   ⚠ 그래도 **매번 전 기간을 긁지 않는다.** 이미 저장된 달은 다시 계산할 필요가 없고
//     (끝난 달의 income은 변하지 않는다), income 조회는 가중치 30이다.
//     그래서 `사야 할 가장 이른 달`부터만 받아온다 — 보통은 이번 달 하나다.
//
// ⚠ 시드머니(`seed`)는 **건드리지 않는다.** 사용자가 손으로 적는 값이다
//   (2026-09-26 사용자 지정: "첫 시드머니만 내가 수동입력"). 자동이 쓰면 사용자가
//   고친 값이 다음 실행에 되돌아간다.

const { binance } = require("./binanceClient");
const store = require("../store/trackerStore");
const { log, errOf } = require("../store/logStore");
const {
  localMonth, groupByMonth, withMonthEndBalance, toEntries, mergeAuto,
} = require("../utils/trackerMonths");

// BTCUSDT 무기한 선물 최초 봉 (2019-09-08) — `routes/stats.js`와 같은 값.
// 이보다 앞선 거래는 존재할 수 없으므로 "전 기간"의 시작점으로 쓴다
const FIRST_TRADE_MS = 1567900800000;

const MAX_LIMIT = 1000;   // income 한 번 조회 상한 (routes/stats.js와 같은 값)
const MAX_PAGES = 40;

// 겹침 방지 — 시작 직후와 1시간 타이머가 같이 떨어질 수 있다.
// ⚠ 이 가드가 안전한 것은 `binanceClient`에 10초 요청 제한이 있기 때문이다
//   (`REQUEST_TIMEOUT_MS`). 그게 없으면 응답이 안 올 때 이 플래그가 true로 남는다
let running = false;

/** income을 끝까지 긁어 온다 (`routes/stats.js`의 fetchIncome과 같은 방식) */
async function fetchAllIncome(startTime) {
  const out = [];
  let from = startTime;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await binance("GET", "/fapi/v1/income", { startTime: from, limit: MAX_LIMIT });
    if (!Array.isArray(data) || data.length === 0) break;
    out.push(...data);
    if (data.length < MAX_LIMIT) break;
    const last = Math.max(...data.map(r => Number(r.time)));
    // ⚠ 진전이 없으면 멈춘다 — 같은 밀리초에 1000건이 몰리면 영원히 돈다
    if (last <= from) break;
    from = last + 1;
  }
  return out;
}

/** USDT 지갑 잔고 (미실현 제외) */
async function fetchWalletBalance() {
  const { data } = await binance("GET", "/fapi/v2/balance", {});
  const usdt = Array.isArray(data) ? data.find(x => x.asset === "USDT") : null;
  const v = parseFloat(usdt?.balance);
  return Number.isFinite(v) ? v : null;
}

/** `"2026-03"` → 그 달 1일 0시(로컬)의 ms */
const monthStartMs = key => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();
};

/**
 * 받아와야 할 가장 이른 달 — **저장된 표에서 자동이 손댈 수 있는 가장 이른 달**이다.
 *
 * 이번 달은 아직 안 끝나서 늘 다시 계산해야 한다. 그보다 앞선 달은 저장돼 있으면
 * 건드릴 일이 없다(끝난 달의 income은 변하지 않는다). 그래서 보통은 이번 달만 받아온다.
 *
 * ⚠ 표가 비어 있으면 `null`을 돌려준다 — 그때는 **전 기간**을 받아와야 한다(첫 채우기).
 *   ⚠ 이번 달이 표에 없는 경우도 전 기간이다: 그 앞 달들이 아직 안 채워졌을 수 있고,
 *     월말 잔고 역산은 **그 사이의 income이 하나도 빠지면 안 된다.**
 */
function earliestNeededMonth(entries, nowMs) {
  const cur = localMonth(nowMs);
  if (!entries?.length) return null;
  const months = new Set(entries.map(e => e.month));
  if (!months.has(cur)) return null;      // 이번 달이 없다 → 어디까지 비었는지 모른다 → 전부
  return cur;
}

/**
 * 한 번 실행. 실패해도 던지지 않는다 — 결산표는 없어도 매매에 영향이 없고,
 * 주기적으로 도는 일이라 다음 회차에 다시 시도하면 된다.
 *
 * @returns `{ ok, added, updated, kept, skipped }` (실패 시 `{ ok: false, reason }`)
 */
async function syncTracker() {
  if (running) return { ok: false, reason: "already-running" };
  running = true;
  try {
    const now   = Date.now();
    const saved = store.load();

    const from  = earliestNeededMonth(saved.entries, now);
    const start = from === null ? FIRST_TRADE_MS : monthStartMs(from);

    const [incomes, balance] = await Promise.all([fetchAllIncome(start), fetchWalletBalance()]);
    if (balance === null) {
      log("TRACKER_SYNC_FAILED", { level: "warn", what: "balance" });
      return { ok: false, reason: "no-balance" };
    }

    const rows = withMonthEndBalance(groupByMonth(incomes, now), balance);
    if (!rows.length) return { ok: true, added: 0, updated: 0, kept: 0, skipped: 0 };

    const r = mergeAuto(saved.entries, toEntries(rows), saved.autoSkip);
    if (r.added === 0 && r.updated === 0) return { ok: true, ...r, entries: undefined };

    // ⚠ seed는 넘겨받은 값을 그대로 다시 쓴다 (파일 머리말의 ⚠)
    if (!store.save({ seed: saved.seed, entries: r.entries, autoSkip: saved.autoSkip })) {
      log("TRACKER_SYNC_FAILED", { level: "warn", what: "save" });
      return { ok: false, reason: "save-failed" };
    }
    log("TRACKER_SYNC", {
      added: r.added, updated: r.updated, kept: r.kept, skipped: r.skipped,
      months: r.entries.length, scanFrom: from ?? "all",
    });
    return { ok: true, added: r.added, updated: r.updated, kept: r.kept, skipped: r.skipped };
  } catch (e) {
    log("TRACKER_SYNC_FAILED", { level: "warn", what: "income", err: errOf(e) });
    return { ok: false, reason: "error" };
  } finally {
    running = false;
  }
}

const SYNC_INTERVAL = 60 * 60 * 1000;   // 1시간
let timer = null;

/**
 * 시작 시 한 번 + 1시간마다.
 *
 * ⚠ 1시간인 이유: 확정된 달은 값이 변하지 않고, 이번 달은 잔고가 시시각각 바뀌지만
 *   **월별 결산표에 시시각각의 잔고가 필요하지 않다.** 더 자주 돌리면 income 조회
 *   가중치(30)만 쓴다. 더 드물게 두면 달이 바뀌는 순간을 며칠 놓친다.
 * ※ 첫 실행을 20초 늦추는 것은 부팅 직후 `symbolInfo`·복구가 거래소를 부르는 구간을
 *   피하려는 것이다 (`orderWatcher`가 같은 이유로 늦춘다).
 */
function start() {
  if (timer) return;
  setTimeout(() => { syncTracker(); }, 20_000);
  timer = setInterval(() => { syncTracker(); }, SYNC_INTERVAL);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { syncTracker, start, stop, earliestNeededMonth };
