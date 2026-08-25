#!/usr/bin/env node
/**
 * 로그 조회 도구 (2026-08-25).
 *
 *   node backend/tools/logq.js --since 24h --event NAKED_POSITION
 *   node backend/tools/logq.js --since 7d --count
 *   node backend/tools/logq.js --day 2026-08-25 --level error
 *   node backend/tools/logq.js --since 30d --sum income
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
  const files = filesFor(a);
  if (files.length === 0) { console.log("로그 파일이 없습니다:", DIR); return; }

  const counts = {};
  const sums   = {};
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
        // ⚠ `tranId`로 묶지 말 것 — 손익과 수수료가 같은 값을 쓴다 (incomeLogger 주석)
        if (o.event === "INCOME") sums[o.incomeType] = (sums[o.incomeType] || 0) + o.amount;
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
  } else {
    for (const o of hits) console.log(a.json ? JSON.stringify(o) : fmt(o));
    console.log(`\n(${hits.length}건 표시 / ${scanned}줄 훑음${broken ? ` / 깨진 줄 ${broken}` : ""})`);
  }
}

main().catch(e => { console.error("조회 실패:", e.message); process.exit(1); });
