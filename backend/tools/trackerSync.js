#!/usr/bin/env node
// 월별 결산 자동 기록을 **지금 한 번** 돌린다
//
//   node backend/tools/trackerSync.js          실제로 채운다
//   node backend/tools/trackerSync.js --dry    무엇이 들어갈지 보여주기만 한다 (파일 안 건드림)
//
// 사이드바 `↗`로 결산 페이지를 열 때 같은 일을 한다 (`POST /api/tracker/sync` → `services/trackerAuto.js`).
// 이 도구는 **`↗` 없이** 지금 채우고 싶을 때, 그리고 `--dry`로 결과를 먼저 보고
// 싶을 때 쓴다. `tools/logq.js`·`tools/backup.js`와 같은 자리다.

require("dotenv").config({ quiet: true });

const store = require("../store/trackerStore");
const { syncTracker, fetchAllIncome } = require("../services/trackerAuto");
const { binance } = require("../services/binanceClient");
const {
  localMonth, groupByMonth, withMonthEndBalance, toEntries, mergeAuto,
} = require("../utils/trackerMonths");

const dry = process.argv.includes("--dry");
const FIRST_TRADE_MS = 1567900800000;
const num = n => n.toFixed(2).padStart(10);

async function preview() {
  // ⚠ 미리보기는 **늘 전 기간**을 받아온다 — 표 전체를 보여주는 것이 목적이다.
  //   실제 실행(syncTracker)은 필요한 달부터만 받아온다
  // ⚠ 페이지를 넘기는 규칙은 `utils/incomePages.js` 하나다 — 실제 실행과 같은 함수를 쓴다.
  //   예전엔 여기만 "마지막 시각 + 1ms"로 따로 받아, 같은 시각에 몰린 펀딩비가 1000건 경계에
  //   걸리면 미리보기에서만 빠질 수 있었다 (2026-09-28에 고쳤다)
  const out = await fetchAllIncome(FIRST_TRADE_MS);
  const { data: bal } = await binance("GET", "/fapi/v2/balance", {});
  const usdt = bal.find(x => x.asset === "USDT");
  const balance = parseFloat(usdt.balance);

  const now   = Date.now();
  const rows  = withMonthEndBalance(groupByMonth(out, now), balance);
  const saved = store.load();
  const r     = mergeAuto(saved.entries, toEntries(rows), saved.autoSkip);

  console.log(`income ${out.length}건 · 지금 지갑 잔고 ${balance.toFixed(2)} USDT`);
  console.log(`시드머니 ${saved.seed} (자동은 이 값을 건드리지 않는다)`);
  console.log(`이번 달 ${localMonth(now)}\n`);
  console.log("월        월말잔고      입금      출금   비고");
  for (const e of r.entries) {
    const old = saved.entries.find(x => x.month === e.month);
    const 비고 = !old ? "새로 넣음" : old.auto !== true ? "사람이 넣은 줄 — 그대로 둠" : "자동 갱신";
    console.log(`${e.month} ${num(e.asset)}${num(e.deposit)}${num(e.withdrawal)}   ${비고}`);
  }
  if (saved.autoSkip?.length) console.log(`\n건너뛴 달(사용자가 지움): ${saved.autoSkip.join(", ")}`);
  console.log(`\n새로 ${r.added}개 · 갱신 ${r.updated}개 · 그대로 ${r.kept}개 · 건너뜀 ${r.skipped}개`);
  console.log("\n※ --dry 라서 파일은 건드리지 않았습니다.");
}

(async () => {
  try {
    if (dry) { await preview(); return; }
    const r = await syncTracker();
    if (!r.ok) { console.log("실패:", r.reason); process.exit(1); }
    console.log(`새로 ${r.added}개 · 갱신 ${r.updated}개 · 그대로 ${r.kept}개 · 건너뜀 ${r.skipped}개`);
    console.log(`저장 위치: ${store.FILE}`);
  } catch (e) {
    console.log("실패:", e.message);
    process.exit(1);
  }
})();
