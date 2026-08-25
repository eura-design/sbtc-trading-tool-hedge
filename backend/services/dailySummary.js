const fs   = require("fs");
const path = require("path");
const { log, DIR } = require("../store/logStore");

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

    // 이미 요약이 있으면 건너뛴다 — 하루에 여러 번 재시작해도 한 줄만 남는다
    const todayFile = path.join(DIR, `${dateStr(new Date())}.jsonl`);
    try {
      if (fs.readFileSync(todayFile, "utf-8").includes(`"summarizedFor":"${day}"`)) return;
    } catch { /* 오늘 파일이 아직 없으면 그냥 진행 */ }

    const sum = summarize(day);
    if (sum) log("DAILY_SUMMARY", sum);
  } catch { /* 요약 실패가 서버를 멈추면 안 된다 */ }
}

function msUntilNextRun() {
  const d = new Date();
  d.setHours(24, 0, 30, 0);   // 자정 30초 뒤 — 파일이 바뀌고 나서
  return d.getTime() - Date.now();
}

function start() {
  if (timer) return;
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

module.exports = { start, stop, summarize, writeYesterday };
