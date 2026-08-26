const fs   = require("fs");
const path = require("path");
const { log, DIR } = require("../store/logStore");

// 오래 남는 요약 — 30일 청소에 걸리지 않는 자리다 (파일 머리말 참고)
const SUMMARY_FILE = path.join(__dirname, "../daily_summary.jsonl");

/**
 * 하루가 끝나면 그날치를 **한 줄로 요약해서 다음 날 파일 첫머리에 남긴다** (2026-08-25).
 *
 * 왜 필요한가 — 이 로그는 Claude가 읽는데 **컨텍스트가 한정돼 있다.**
 * "지난달 어땠어?"에 답하려면 30개 파일 수만 줄을 다 읽어야 하는데 그게 안 된다.
 * 요약이 있으면 **파일당 한 줄씩 30줄**만 읽고 답한 뒤, 이상한 날만 파고들면 된다.
 *
 * ⚠ **요약은 원본을 대신하지 않는다.** 원본은 그대로 30일 남는다 —
 *   요약만 남기고 지우면 "왜 그랬나"를 영영 못 본다
 *
 * ⚠ **요약은 `backend/daily_summary.jsonl`에도 따로 쌓는다** (2026-08-26).
 *   그전에는 그날 로그 파일 안에만 있었는데, 그 파일이 30일 뒤 지워지면서
 *   **요약도 같이 사라졌다** — 긴 기록을 짧게 읽으려고 만든 것이 정작 오래된 것을
 *   못 보게 되는 상태였다. 하루 한 줄이라 몇 년치를 모아도 작다.
 *   ⚠ `logs/` **밖에** 두는 것이 요점이다 — 그 폴더는 청소 대상이고 "지워도 되는 것"으로
 *     취급된다 (손익 커서를 밖으로 뺀 것과 같은 이유)
 *
 * ⚠ **어제 파일을 읽어서 만든다.** 오늘 파일에 넣는 이유는, 자정에 파일이 바뀐 뒤라
 *   어제 파일은 이미 닫혔기 때문이다. `summarizedFor`에 어느 날짜의 요약인지 적는다
 *   — 파일 날짜와 다르므로 **집계할 때 `summarizedFor`를 볼 것**
 */

let timer = null;

function dateStr(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 하루치 파일 → 요약 객체. 파일이 없으면 null */
function summarize(day) {
  const file = path.join(DIR, `${day}.jsonl`);
  let raw;
  try { raw = fs.readFileSync(file, "utf-8"); } catch { return null; }

  const events = {};      // event 이름 → 건수
  const income = {};      // incomeType → 합계
  const boots  = new Set();
  let errors = 0, warns = 0, lines = 0;
  let nakedSeconds = 0, nakedCount = 0;
  let realizedPnl = 0, fee = 0, funding = 0;

  for (const line of raw.split("\n")) {
    if (!line) continue;
    let o;
    // ⚠ 깨진 줄은 **건너뛰고 계속한다** — 한 줄 때문에 하루 요약을 통째로 버리면 안 된다
    //   (JSONL을 고른 이유가 이것이다)
    try { o = JSON.parse(line); } catch { continue; }
    lines++;
    if (o.boot) boots.add(o.boot);
    if (o.level === "error") errors++;
    else if (o.level === "warn") warns++;

    const name = o.kind === "console" ? `console:${o.tag || "-"}` : o.event;
    if (name) events[name] = (events[name] || 0) + 1;

    if (o.event === "INCOME") {
      income[o.incomeType] = +((income[o.incomeType] || 0) + o.amount).toFixed(8);
      if (o.incomeType === "REALIZED_PNL") realizedPnl += o.amount;
      if (o.incomeType === "COMMISSION")   fee         += o.amount;
      if (o.incomeType === "FUNDING_FEE")  funding     += o.amount;
    }
    if (o.event === "NAKED_RESOLVED") { nakedSeconds += o.seconds || 0; nakedCount++; }
  }
  if (lines === 0) return null;

  return {
    summarizedFor: day,
    lines, errors, warns,
    boots: boots.size,                       // 그날 재시작 횟수 (1이면 한 번도 안 끊김)
    events,
    income,
    realizedPnl: +realizedPnl.toFixed(4),
    fee:         +fee.toFixed(4),
    funding:     +funding.toFixed(4),
    net:         +(realizedPnl + fee + funding).toFixed(4),  // 수수료·펀딩은 이미 음수다
    nakedCount, nakedSeconds,               // 손절 없이 지낸 횟수·총 초
  };
}

/** 어제치 요약을 남긴다. 이미 남겼으면 아무것도 안 한다 */
function writeYesterday() {
  try {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const day = dateStr(y);

    // 이미 요약이 있으면 건너뛴다 — 하루에 여러 번 재시작해도 한 줄만 남는다.
    // **두 곳 다 본다** — 둘 중 하나에만 있어도 그날은 이미 요약한 것이다
    // (오래 남는 파일이 아직 없던 시절의 요약도 알아본다)
    const mark      = `"summarizedFor":"${day}"`;
    const todayFile = path.join(DIR, `${dateStr(new Date())}.jsonl`);
    for (const f of [SUMMARY_FILE, todayFile]) {
      try { if (fs.readFileSync(f, "utf-8").includes(mark)) return; }
      catch { /* 파일이 아직 없으면 다음 것을 본다 */ }
    }

    const sum = summarize(day);
    if (!sum) return;
    log("DAILY_SUMMARY", sum);
    // 오래 남는 쪽에도 한 줄 — 실패해도 위 로그는 이미 남았으므로 조용히 넘어간다
    try {
      fs.appendFileSync(SUMMARY_FILE, JSON.stringify({ ts: Date.now(), ...sum }) + "\n", "utf-8");
    } catch { /* 여기서 서버를 멈출 이유는 없다 */ }
  } catch { /* 요약 실패가 서버를 멈추면 안 된다 */ }
}

/**
 * 이미 로그 파일 안에 들어 있는 옛 요약을 오래 남는 파일로 한 번 옮겨 적는다.
 *
 * 안 하면 이 기능을 켠 날부터만 쌓여서, **지금 갖고 있는 30일치 요약이 그대로
 * 30일 뒤 사라진다** — 오래 보관하려고 만든 파일인데 정작 과거를 못 담는다.
 * 이미 있는 날은 건너뛰므로 몇 번 돌아도 안전하다.
 */
function backfillFromLogs() {
  try {
    const have = new Set();
    try {
      for (const line of fs.readFileSync(SUMMARY_FILE, "utf-8").split("\n")) {
        if (!line) continue;
        try { have.add(JSON.parse(line).summarizedFor); } catch { /* 깨진 줄은 건너뛴다 */ }
      }
    } catch { /* 파일이 아직 없으면 전부 새로 적는다 */ }

    const found = new Map();
    for (const f of fs.readdirSync(DIR)) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue;
      let raw;
      try { raw = fs.readFileSync(path.join(DIR, f), "utf-8"); } catch { continue; }
      for (const line of raw.split("\n")) {
        if (!line.includes('"DAILY_SUMMARY"')) continue;
        try {
          const o = JSON.parse(line);
          if (o.event === "DAILY_SUMMARY" && o.summarizedFor && !have.has(o.summarizedFor)) {
            found.set(o.summarizedFor, o);
          }
        } catch { /* 깨진 줄은 건너뛴다 */ }
      }
    }
    if (found.size === 0) return;

    const rows = [...found.values()].sort((a, b) => a.summarizedFor.localeCompare(b.summarizedFor));
    fs.appendFileSync(SUMMARY_FILE, rows.map(r => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  } catch { /* 이관 실패가 서버를 멈추면 안 된다 */ }
}

function msUntilNextRun() {
  const d = new Date();
  d.setHours(24, 0, 30, 0);   // 자정 30초 뒤 — 파일이 바뀌고 나서
  return d.getTime() - Date.now();
}

function start() {
  if (timer) return;
  backfillFromLogs();   // 로그 안에 남아 있는 옛 요약을 한 번 옮겨 적는다
  // 서버를 켤 때도 한 번 — 어제 자정에 꺼져 있었으면 그날 요약이 비어 있다
  writeYesterday();
  const tick = () => {
    writeYesterday();
    timer = setTimeout(tick, msUntilNextRun());
    timer.unref?.();
  };
  timer = setTimeout(tick, msUntilNextRun());
  timer.unref?.();
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { start, stop, summarize, writeYesterday, backfillFromLogs };
