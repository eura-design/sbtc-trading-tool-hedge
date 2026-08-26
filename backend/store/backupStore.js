// 백업 — **지워져도 되살릴 수 있게** (2026-08-26 사용자 요청)
//
// ── 무엇을 담나 ────────────────────────────────────────────────────────────
//   · 브라우저 저장소 전체 (도형·플랜 박스·리스크/레버리지·지표·알림·단축키·연습 기록)
//   · `기타/tracker_data.json` — 월별 결산. **손으로 입력한 값이라 어디서도 못 되살린다**
//
// ⚠ **API 키(`.env`)는 절대 담지 않는다.** 백업 파일은 평문이고, 키가 새면
//   백업의 목적(잃은 것을 되찾기)과 비교가 안 되는 손해가 난다.
//
// ── 하루 한 파일, 오늘 것만 덮어쓴다 ───────────────────────────────────────
// 어제 이전 파일은 **다시 건드리지 않는다**. 그래서 오늘 낮에 저장소를 날려도
// 잃는 건 최대 하루치다. 시간마다 파일을 만들면 정확하지만 파일이 수백 개가 된다.
//
// ⚠ **빈 내용은 받지 않는다.** 브라우저 저장소를 지운 직후에 보내온 "키 0개"를
//   그대로 덮어쓰면, 되살리려고 만든 백업이 **비어 있는 상태를 저장**하게 된다.
//   백업이 가장 필요한 순간에 스스로를 망치는 셈이라 그 경우는 거절한다.

const fs   = require("fs");
const path = require("path");
const { log, errOf } = require("./logStore");

const DIR         = path.join(__dirname, "../backups");
const RETAIN_DAYS = 60;          // 하루 한 파일이라 60개다
const MAX_BYTES   = 4 * 1024 * 1024;   // 브라우저 저장소 상한(보통 5MB)보다 조금 아래

// 같이 담을 백엔드 파일 — **이름을 여기 적은 것만** 담고 되살린다(경로 주입 방지)
//
// ※ `indicator_params.json`은 2026-08-26에 목록에서 빠졌다 — 지표 설정이 브라우저로
//   옮겨가면서 그 파일 자체가 사라졌다. 그날 이전 백업에는 아직 들어 있지만,
//   여기 이름이 없으면 되돌리기 대상이 아니다 (되돌릴 곳이 없으므로 맞다).
const FILES = {
  "tracker_data.json": path.join(__dirname, "..", "..", "기타", "tracker_data.json"),
};

let lastBrowser   = null;   // { items, at } — 마지막으로 받은 브라우저 저장소
let timer         = null;

function dateStr(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const fileFor = day => path.join(DIR, `${day}.json`);

function readFiles() {
  const out = {};
  for (const [name, file] of Object.entries(FILES)) {
    try { out[name] = JSON.parse(fs.readFileSync(file, "utf-8")); }
    catch { /* 없으면 담지 않는다 — 되살릴 때 "없었다"와 구분된다 */ }
  }
  return out;
}

/**
 * 오늘 파일을 지금 상태로 쓴다. 원자적 쓰기 — 반쯤 잘린 백업은 없느니만 못하다.
 *
 * ⚠ **브라우저 저장소를 아직 못 받았으면 있던 것을 그대로 이어 쓴다** (2026-08-26에 고친 버그).
 *   백엔드를 켤 때·6시간마다 이 함수가 도는데, 그때 `lastBrowser`는 메모리라 비어 있다.
 *   그대로 쓰면 **오늘 파일의 브라우저 데이터가 `null`로 덮인다** — 실측으로 39개 키가
 *   한 번에 날아갔다. 어제 하루에만 재시작이 13번이었으니 사실상 늘 비어 있는 셈이었다.
 *   ⚠ 되돌리지 말 것: **백업이 스스로를 비우는 것**이 이 파일에서 가장 나쁜 고장이다.
 *   ※ 오늘 것이 없으면 **가장 최근 것**을 물려받는다 — 날이 바뀐 직후에도 비지 않는다.
 *     낡은 값이지만 `browserAt`에 언제 것인지 적혀 있고, 없는 것보다 낫다.
 */
function carryOverBrowser() {
  if (lastBrowser) return lastBrowser;
  const prev = read();                       // 오늘 것 → 없으면 가장 최근 것
  if (prev?.browser && Object.keys(prev.browser).length) {
    return { items: prev.browser, at: prev.browserAt ?? null };
  }
  return null;
}

function writeSnapshot() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const carried = carryOverBrowser();
    const snap = {
      v: 1,
      ts: Date.now(),
      iso: new Date().toISOString(),
      browser:   carried?.items ?? null,
      browserAt: carried?.at ?? null,
      files: readFiles(),
    };
    const file = fileFor(dateStr());
    const tmp  = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(snap), "utf-8");
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    log("BACKUP_FAILED", { level: "error", err: errOf(e) });
    return false;
  }
}

/** 보존 기간이 지난 백업 삭제 */
function sweep() {
  const cutoff = Date.now() - RETAIN_DAYS * 86400_000;
  fs.readdir(DIR, (err, files) => {
    if (err) return;
    for (const f of files) {
      const m = /^(\d{4})-(\d{2})-(\d{2})\.json(?:\..+)?$/.exec(f);
      if (!m) continue;
      const t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
      if (t < cutoff) fs.unlink(path.join(DIR, f), () => {});
    }
  });
}

/**
 * 브라우저 저장소를 받는다. 받아만 두고 파일은 주기적으로/여기서 바로 쓴다.
 * @returns { ok, reason }
 */
function putBrowser(items) {
  if (!items || typeof items !== "object") return { ok: false, reason: "형식이 아님" };
  const keys = Object.keys(items);
  if (keys.length === 0) {
    // 파일 머리말 참고 — 비어 있는 상태로 백업을 덮지 않는다
    log("BACKUP_EMPTY_REJECTED", { level: "warn" });
    return { ok: false, reason: "빈 내용" };
  }
  const size = Buffer.byteLength(JSON.stringify(items));
  if (size > MAX_BYTES) {
    log("BACKUP_TOO_LARGE", { level: "warn", size });
    return { ok: false, reason: "너무 큼" };
  }
  lastBrowser = { items, at: Date.now() };
  const ok = writeSnapshot();
  return { ok, keys: keys.length, size };
}

/** 백업 목록 (최신순) */
function list() {
  try {
    return fs.readdirSync(DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort().reverse()
      .map(f => {
        const st = fs.statSync(path.join(DIR, f));
        return { day: f.slice(0, 10), size: st.size, mtime: st.mtimeMs };
      });
  } catch { return []; }
}

/** 특정 날짜(없으면 가장 최근) 백업 읽기 */
function read(day) {
  const target = day || list()[0]?.day;
  if (!target) return null;
  try { return JSON.parse(fs.readFileSync(fileFor(target), "utf-8")); }
  catch { return null; }
}

/**
 * 백업 안의 백엔드 파일을 원래 자리로 되돌린다 (`tools/backup.js`가 부른다).
 * ⚠ 이름표에 적힌 것만 되돌린다 — 백업 파일이 손대진 것이어도 엉뚱한 경로를 못 쓴다.
 * ⚠ 되돌리기 전에 지금 파일을 `.before-restore`로 옆에 남긴다 — 잘못 되돌렸을 때
 *   원래대로 갈 방법이 없으면 복구 도구가 아니라 또 하나의 파괴 도구다.
 */
function restoreFiles(day) {
  const snap = read(day);
  if (!snap?.files) return { ok: false, reason: "백업이 없거나 파일이 담겨 있지 않음" };
  const done = [];
  for (const [name, data] of Object.entries(snap.files)) {
    const dest = FILES[name];
    if (!dest) continue;
    try {
      try { fs.copyFileSync(dest, dest + ".before-restore"); } catch { /* 원본이 없으면 넘어간다 */ }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, JSON.stringify(data, null, 2), "utf-8");
      done.push(name);
    } catch (e) {
      log("BACKUP_RESTORE_FAILED", { level: "error", file: name, err: errOf(e) });
    }
  }
  return { ok: done.length > 0, restored: done, from: snap.iso };
}

/** 하루 한 번 + 시작할 때 한 번 — 브라우저가 안 붙어도 백엔드 파일은 남는다 */
function start() {
  if (timer) return;
  writeSnapshot();
  sweep();
  timer = setInterval(() => { writeSnapshot(); sweep(); }, 6 * 3600 * 1000);
  timer.unref?.();
}

function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { start, stop, putBrowser, list, read, restoreFiles, writeSnapshot, DIR };
