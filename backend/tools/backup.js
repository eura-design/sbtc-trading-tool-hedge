#!/usr/bin/env node
/**
 * 백업 조회·되돌리기 도구 (2026-08-26).
 *
 *   node backend/tools/backup.js --list
 *   node backend/tools/backup.js --show                 (가장 최근 백업 요약)
 *   node backend/tools/backup.js --show 2026-08-20
 *   node backend/tools/backup.js --restore-files        (백엔드 파일만 되돌린다)
 *
 * ⚠ **브라우저 저장소는 여기서 못 되돌린다** — 브라우저 안에만 쓸 수 있다.
 *   차트를 열고 콘솔에서 `__restoreBackup(true)`를 부를 것.
 * ⚠ 되돌리기는 덮어쓰는 동작이라 **웹 라우트로 만들지 않았다.** 명령을 직접 쳐야 한다.
 * ⚠ 되돌리기 전 원본은 `<파일>.before-restore`로 옆에 남는다.
 */

const backup = require("../store/backupStore");

const argv = process.argv.slice(2);
const has  = f => argv.includes(f);
const val  = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const day  = argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));

const kb = n => (n / 1024).toFixed(1) + "KB";

if (has("--list")) {
  const rows = backup.list();
  if (!rows.length) { console.log("백업이 없습니다:", backup.DIR); process.exit(0); }
  for (const r of rows) console.log(`${r.day}  ${kb(r.size).padStart(9)}  ${new Date(r.mtime).toLocaleString("ko-KR")}`);
  console.log(`\n(${rows.length}개)`);
} else if (has("--restore-files")) {
  const r = backup.restoreFiles(day || val("--restore-files"));
  if (!r.ok) { console.error("되돌리지 못했습니다:", r.reason); process.exit(1); }
  console.log(`${r.from} 백업에서 되돌렸습니다:`, r.restored.join(", "));
  console.log("원본은 <파일>.before-restore 로 남겨 뒀습니다.");
  console.log("⚠ 지표 설정은 브라우저가 원본입니다 — 필요하면 차트 콘솔에서 __restoreBackup(true)");
} else {
  const snap = backup.read(day || val("--show"));
  if (!snap) { console.log("백업이 없습니다:", backup.DIR); process.exit(0); }
  const keys = Object.keys(snap.browser || {});
  console.log(`백업 시각      ${snap.iso}`);
  console.log(`브라우저 저장소 ${keys.length}개 키` + (snap.browserAt ? `  (받은 시각 ${new Date(snap.browserAt).toLocaleString("ko-KR")})` : "  (아직 받은 적 없음)"));
  console.log(`백엔드 파일     ${Object.keys(snap.files || {}).join(", ") || "없음"}`);
  if (keys.length) {
    const big = keys.map(k => [k, (snap.browser[k] || "").length]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log("\n큰 항목:");
    for (const [k, n] of big) console.log(`  ${k.padEnd(24)} ${kb(n).padStart(9)}`);
  }
}
