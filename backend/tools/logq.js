#!/usr/bin/env node
/**
 * 로그 조회 도구 (2026-08-25).
 *
 *   node backend/tools/logq.js --since 24h --event NAKED_POSITION
 *   node backend/tools/logq.js --since 7d --count
 *   node backend/tools/logq.js --day 2026-08-25 --level error
 *   node backend/tools/logq.js --since 30d --sum income
 *   node backend/tools/logq.js --summary            (하루 한 줄 요약 — 30일보다 오래된 것도 나온다)
 *
 * 왜 있나 — 이 로그는 Claude가 읽는데, 물어볼 때마다 파싱 스크립트를 새로 짜면
 * **매번 조금씩 다르게 세게 된다**(특히 `tranId`처럼 함정이 있는 필드).
 * 자주 쓰는 질문을 여기 한 번만 맞게 구현해 둔다.
 *
 * ⚠ **줄 단위로 흘려 읽는다** — 파일을 통째로 배열에 올리지 않는다.
 *   30일치를 한 번에 훑어도 메모리가 늘지 않아야 한다
 * ⚠ 깨진 줄은 **건너뛰고 계속한다** — 한 줄 때문에 조회가 죽으면 안 된다
 */

const fs   = require("fs");
const path = require("path");
const readline = require("readline");

const DIR = path.join(__dirname, "../logs");
// 오래 남는 하루 요약 — `logs/` 밖이라 30일 청소에 안 걸린다
// (services/dailySummary.js 참고). 30일보다 오래된 날은 **여기서만** 볼 수 있다
const SUMMARY_FILE = path.join(__dirname, "../daily_summary.jsonl");

function parseArgs(argv) {
  const a = { limit: 50 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case "--since":  a.since = v; i++; break;   // 24h / 7d / 2026-08-01
      case "--day":    a.day   = v; i++; break;
      case "--event":  a.event = v; i++; break;
      case "--kind":   a.kind  = v; i++; break;   // event / console / client
      case "--level":  a.level = v; i++; break;
      case "--tag":    a.tag   = v; i++; break;
      case "--grep":   a.grep  = v; i++; break;
      case "--limit":  a.limit = Number(v); i++; break;
      case "--count":  a.count = true; break;     // event별 건수만
      case "--summary": a.summary = true; break;  // 하루 한 줄 요약 (오래 남는 파일)
      case "--sum":    a.sum   = v; i++; break;   // income → 종류별 합계
      case "--json":   a.json  = true; break;
      case "--help": case "-h": a.help = true; break;
    }
  }
  return a;
}

function sinceMs(s) {
  if (!s) return 0;
  const m = /^(\d+)([hdm])$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    const mult = m[2] === "h" ? 3600e3 : m[2] === "d" ? 86400e3 : 60e3;
    return Date.now() - n * mult;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function filesFor(a) {
  let names;
  try { names = fs.readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); }
  catch { return []; }
  if (a.day) names = names.filter(f => f.startsWith(a.day));
  else if (a.since) {
    // ⚠ 파일 이름(로컬 날짜)으로 넉넉히 거르고, 정밀한 컷은 아래에서 `ts`로 한다.
    //   파일 경계에 걸친 줄을 놓치지 않게 하루 여유를 둔다
    const from = new Date(sinceMs(a.since) - 86400e3);
    const p = n => String(n).padStart(2, "0");
    const key = `${from.getFullYear()}-${p(from.getMonth() + 1)}-${p(from.getDate())}`;
    names = names.filter(f => f.slice(0, 10) >= key);
  }
  return names.map(f => path.join(DIR, f));
}

function match(o, a, from) {
  if (from && o.ts < from) return false;
  if (a.event && o.event !== a.event) return false;
  if (a.kind  && o.kind  !== a.kind)  return false;
  if (a.level && o.level !== a.level) return false;
  if (a.tag   && o.tag   !== a.tag)   return false;
  if (a.grep) {
    let s;
    try { s = JSON.stringify(o); } catch { return false; }
    if (!s.includes(a.grep)) return false;
  }
  return true;
}

function fmt(o) {
  const t = new Date(o.ts).toISOString().replace("T", " ").slice(0, 19);
  if (o.kind === "console") return `${t} ${o.level.padEnd(5)} [${o.tag || "-"}] ${o.msg}`;
  const extra = Object.entries(o)
    .filter(([k]) => !["ts", "iso", "boot", "kind", "level", "event", "symbol"].includes(k))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  return `${t} ${o.level.padEnd(5)} ${o.event} ${extra}`;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    console.log(fs.readFileSync(__filename, "utf-8").split("*/")[0].replace(/^#!.*\n/, ""));
    return;
  }
  const from  = a.day ? 0 : sinceMs(a.since);

  // ── 하루 요약 — 별도 파일이라 30일 청소와 무관하다 ────────────────────────
  if (a.summary) {
    let rows = [];
    try {
      for (const line of fs.readFileSync(SUMMARY_FILE, "utf-8").split("\n")) {
        if (!line) continue;
        try { rows.push(JSON.parse(line)); } catch { /* 깨진 줄은 건너뛴다 */ }
      }
    } catch { console.log("요약 파일이 아직 없습니다:", SUMMARY_FILE); return; }
    if (a.day)   rows = rows.filter(r => r.summarizedFor === a.day);
    if (a.since) rows = rows.filter(r => Date.parse(r.summarizedFor + "T00:00:00") >= from);
    for (const r of rows) {
      console.log(
        `${r.summarizedFor}  줄 ${String(r.lines).padStart(5)}  오류 ${String(r.errors).padStart(3)}` +
        `  재시작 ${r.boots}  손익 ${r.net >= 0 ? "+" : ""}${r.net}` +
        (r.nakedCount ? `  손절공백 ${r.nakedCount}회/${r.nakedSeconds}s` : ""));
    }
    console.log(`\n(${rows.length}일)`);
    return;
  }

  const files = filesFor(a);
  if (files.length === 0) { console.log("로그 파일이 없습니다:", DIR); return; }

  const counts = {};
  const sums   = {};
  // INCOME 중복 제거용 — 커서 파일이 사라지면 같은 건이 두 번 기록될 수 있다
  // (services/incomeLogger.js 주석 참고). 그때 합계가 부풀려지는 것을 여기서 막는다.
  // ⚠ 키에 `tranId` 하나만 쓰지 말 것 — 손익과 수수료가 같은 값을 쓴다(실측).
  //   incomeTime·amount까지 넣는 이유는 **서로 다른 건을 하나로 뭉치지 않기 위해서**다
  //   (tranId가 비는 종류가 있어서 그것만으로는 갈리지 않는다)
  const seenIncome = new Set();
  let dupIncome = 0;
  const hits   = [];
  let scanned = 0, broken = 0;

  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch { broken++; continue; }
      scanned++;
      if (!match(o, a, from)) continue;

      if (a.count) {
        const key = o.kind === "console" ? `console:${o.tag || "-"}` : o.event;
        counts[key] = (counts[key] || 0) + 1;
      } else if (a.sum === "income") {
        // ⚠ `tranId`로만 묶지 말 것 — 손익과 수수료가 같은 값을 쓴다 (incomeLogger 주석)
        if (o.event === "INCOME") {
          const key = `${o.tranId}|${o.incomeType}|${o.incomeTime}|${o.amount}`;
          if (seenIncome.has(key)) { dupIncome++; continue; }
          seenIncome.add(key);
          sums[o.incomeType] = (sums[o.incomeType] || 0) + o.amount;
        }
      } else {
        hits.push(o);
        if (hits.length > a.limit) hits.shift();   // 최근 것만 남긴다
      }
    }
  }

  if (a.count) {
    const rows = Object.entries(counts).sort((x, y) => y[1] - x[1]);
    for (const [k, v] of rows) console.log(String(v).padStart(6), k);
    console.log(`\n(${files.length}개 파일 / ${scanned}줄 훑음${broken ? ` / 깨진 줄 ${broken}` : ""})`);
  } else if (a.sum === "income") {
    let net = 0;
    for (const [k, v] of Object.entries(sums)) { console.log(k.padEnd(14), v.toFixed(4)); net += v; }
    console.log("-".repeat(24));
    console.log("NET".padEnd(14), net.toFixed(4));
    // 중복이 있었다는 건 커서가 한 번 유실됐다는 뜻이다 — 조용히 넘기지 않는다
    if (dupIncome) console.log(`
⚠ 중복 ${dupIncome}건을 빼고 합쳤습니다 (커서 유실 흔적)`);
  } else {
    for (const o of hits) console.log(a.json ? JSON.stringify(o) : fmt(o));
    console.log(`\n(${hits.length}건 표시 / ${scanned}줄 훑음${broken ? ` / 깨진 줄 ${broken}` : ""})`);
  }
}

main().catch(e => { console.error("조회 실패:", e.message); process.exit(1); });
