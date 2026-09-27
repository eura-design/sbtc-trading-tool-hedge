// 월별 결산을 **자동으로 채운다** (2026-09-26 사용자 요청: "완전 자동으로")
//
// ── 언제 도나 ───────────────────────────────────────────────────────────────
// **사이드바 `거래 통계`의 `↗`로 결산 페이지를 열 때** 한 번 돈다 — 페이지가 주소의 `?sync=1`을
// 보고 `POST /api/tracker/sync`를 부른다 (2026-09-28 사용자 요청). 예전엔 시작 20초 후 +
// 1시간마다 돌았다. 상단 탭으로 오가거나 새로고침할 때는 돌지 않는다 (사용자가 정했다).
//   ※ 오래 안 열어도 값을 잃지 않는다: 이번 달 줄이 없으면 `earliestNeededMonth`가
//     전 기간을 다시 받아 **모든 달의 월말 잔고를 다시 계산한다.**
//   ⚠ 백엔드가 알아서 채우지 않는다. `↗`를 안 누르면 `tracker_data.json`은 그대로다.
//     `↗` 없이 채우려면 `node backend/tools/trackerSync.js`를 실행한다
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
const { fetchIncomePages } = require("../utils/incomePages");
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

// 겹침 방지 — `↗`를 빠르게 두 번 누르면 두 번 불린다.
// 도는 중에 또 불리면 새로 돌지 않고 **도는 중인 실행의 결과를 같이 받는다.**
//   예전엔 `{ ok: false, reason: "already-running" }`을 돌려줬는데, 페이지가 그걸 실패로 읽으면
//   멀쩡히 채워지는 중인데도 "새로 받지 못했다"는 줄이 뜬다.
// ⚠ 이 가드가 안전한 것은 `binanceClient`에 10초 요청 제한이 있기 때문이다
//   (`REQUEST_TIMEOUT_MS`). 그게 없으면 응답이 안 올 때 이 Promise가 끝나지 않는다
let running = null;

/**
 * income을 끝까지 받아 온다.
 * ⚠ 페이지를 넘기는 규칙은 `utils/incomePages.js` 하나다 (`routes/stats.js`와 같이 쓴다).
 *   예전엔 "마지막 시각 + 1ms"부터 받아 같은 시각에 몰린 펀딩비가 경계에서 빠질 수 있었다 —
 *   빠지면 그 달 변화량이 틀리고, 월말 잔고는 **거꾸로 내려오므로 그 앞 달이 전부** 틀린다
 */
async function fetchAllIncome(startTime) {
  return fetchIncomePages(async (from) => {
    const { data } = await binance("GET", "/fapi/v1/income", { startTime: from, limit: MAX_LIMIT });
    return data;
  }, startTime, { limit: MAX_LIMIT, maxPages: MAX_PAGES });
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
function earliestNeededMonth(entries, nowMs, autoSkip = []) {
  const cur = localMonth(nowMs);
  if (!entries?.length) return null;
  const months = new Set(entries.map(e => e.month));
  // ⚠ 사용자가 **이번 달 자동 줄을 지운 경우**(autoSkip)는 "비어 있다"가 아니다 (2026-09-27).
  //   예전엔 그것도 빈 것으로 읽어, 그 달이 끝날 때까지 **매시간 전 기간**을 다시 받았다.
  //   지운 달은 어차피 채우지 않으므로(mergeAuto) 이번 달부터만 받으면 된다
  if (!months.has(cur) && !autoSkip.includes(cur)) return null;   // 어디까지 비었는지 모른다 → 전부
  return cur;
}

/**
 * 한 번 실행. 실패해도 던지지 않는다 — 결산표는 없어도 매매에 영향이 없고,
 * 다음에 `↗`를 누를 때 다시 시도하면 된다.
 *
 * @returns `{ ok, added, updated, kept, skipped }` (실패 시 `{ ok: false, reason }`)
 */
function syncTracker() {
  if (!running) running = runOnce().finally(() => { running = null; });
  return running;
}

async function runOnce() {
  try {
    const now   = Date.now();
    const saved = store.load();

    const from  = earliestNeededMonth(saved.entries, now, saved.autoSkip);
    const start = from === null ? FIRST_TRADE_MS : monthStartMs(from);

    const [incomes, balance] = await Promise.all([fetchAllIncome(start), fetchWalletBalance()]);
    if (balance === null) {
      log("TRACKER_SYNC_FAILED", { level: "warn", what: "balance" });
      return { ok: false, reason: "no-balance" };
    }

    const rows = withMonthEndBalance(groupByMonth(incomes, now), balance);
    if (!rows.length) return { ok: true, added: 0, updated: 0, kept: 0, skipped: 0 };

    // ⚠ **저장 직전에 파일을 다시 읽어 그 위에 합친다** (2026-09-27에 고친 경쟁 조건).
    //   위에서 읽은 `saved`는 거래소 응답을 기다리기 **전**의 내용이다. 그 사이(약 1초)에
    //   결산 페이지에서 저장하면, 옛 내용 위에 합쳐 저장하는 순간 **사람이 방금 넣은 값이
    //   사라진다** — 손으로 넣은 값은 다시 만들 수 없다(`store/trackerStore.js`).
    //   다시 읽으면 그 창이 저장 한 번(수 ms)으로 줄어든다.
    //   ※ seed·autoSkip도 새로 읽은 것을 쓴다 — 페이지에서 바꿨을 수 있다
    const fresh = store.load();
    const r = mergeAuto(fresh.entries, toEntries(rows), fresh.autoSkip);
    if (r.added === 0 && r.updated === 0) return { ok: true, ...r, entries: undefined };

    // ⚠ seed는 넘겨받은 값을 그대로 다시 쓴다 (파일 머리말의 ⚠)
    if (!store.save({ seed: fresh.seed, entries: r.entries, autoSkip: fresh.autoSkip })) {
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
  }
}

module.exports = { syncTracker, earliestNeededMonth, fetchAllIncome };
