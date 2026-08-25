const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * 로그 한 벌 — 구조화 이벤트와 콘솔 출력을 **같은 날짜 파일**에 함께 남긴다.
 * (2026-08-25 전면 개편. 그전에는 `trade_log.json`(사건)과 `console.jsonl`(서술)이
 *  따로 있었고, 형식·어휘가 서로 달랐다)
 *
 * ── 읽는 쪽이 사람이 아니라 **Claude**다 ────────────────────────────────────
 * 사용자는 로그를 직접 보지 않고 필요할 때 물어본다. 그래서 설계 기준이 다르다:
 *   · 터미널을 눈으로 훑는 게 아니라 **grep으로 한 줄씩 뽑는다**
 *     → **한 줄만 봐도 뜻이 통해야 한다**(자족적). 앞뒤 줄에 기대지 말 것
 *   · 컨텍스트가 한정돼 큰 파일을 통째로 못 읽는다
 *     → `event`로 **세고 거를 수 있어야** 한다. 문장으로만 남기지 말 것
 *   · 어휘가 흔들리면 질의가 조용히 실패한다
 *     → 아래 필드 이름·값 어휘를 **고정**한다
 *
 * ── 반드시 지킬 것 ──────────────────────────────────────────────────────────
 * ⚠ **`event`는 문구가 아니라 안정적인 식별자다.** 화면 문구는 자주 바뀐다
 *   (2026-08-25 하루에만 여러 번 바꿨다). 문구를 식별자로 쓰면 바꿀 때마다
 *   과거 로그와 끊긴다. `event`는 한번 정하면 바꾸지 말 것
 *
 * ⚠ **`orderSide`(BUY/SELL)와 `posSide`(LONG/SHORT)를 절대 섞지 말 것.**
 *   옛 `trade_log.json`은 둘 다 `side`에 넣어서, `side=LONG`으로 찾으면
 *   체결 기록이 통째로 빠졌다(실측). 헷지모드라 둘은 다른 개념이다
 *
 * ⚠ **필드를 나중에 늘리지 말고 처음부터 `null`로라도 넣을 것.** 옛 로그는
 *   `NAKED_POSITION`에 수량이 있다 없다 했다 → 과거를 물어보면
 *   **"기록이 없는 것"과 "그런 일이 없었던 것"을 구분할 수 없다**
 *
 * ⚠ **에러는 원인을 그대로 남긴다** — `err: { code, msg }`.
 *   거래소 코드(-2021, -4130)가 곧 원인이라 요약하면 못 쓴다
 *
 * ⚠ **로깅이 앱을 죽이지 않는다.** 전부 try/catch, 실패하면 조용히 넘어간다
 *
 * ── 파일 ────────────────────────────────────────────────────────────────────
 *   backend/logs/2026-08-25.jsonl   ← 하루치 한 파일 (한 줄에 JSON 하나)
 *
 * ⚠ **JSON 배열로 만들지 말 것.** 옛 `trade_log.json`은 한 건 쓸 때마다 파일
 *   전체를 `readFileSync`(동기)로 읽고 통째로 다시 썼다. 파일이 커질수록 한 줄
 *   찍는 비용이 늘고 **이벤트 루프를 막는다** — `server.js`의 멈춤 감지가
 *   잡으려던 바로 그 상황이다. JSONL은 이어 붙이기라 크기와 무관하고,
 *   마지막 줄이 반쯤 쓰이다 말아도 **나머지 줄은 그대로 읽힌다**
 *
 * ⚠ 날짜는 **로컬 시각 기준**이다("어제 로그"가 사용자 하루와 맞아야 한다).
 *   정밀한 비교는 항상 `ts`(epoch ms)로 할 것 — `iso`는 사람이 읽기 위한 것이다
 */

const DIR          = path.join(__dirname, "../logs");
const RETAIN_DAYS  = 30;
const SYMBOL       = "BTCUSDT";

// 부팅마다 새로 — **재시작 경계를 알 수 있게 한다**. 이 시스템은 "꺼져 있던 사이"가
// 곧 사고 원인이라(지정가가 체결됐는데 TP/SL을 못 걸었다 등), 로그가 이어져 보이는데
// 실은 그 사이 재시작이 있었는지를 반드시 구분할 수 있어야 한다
const BOOT = crypto.randomBytes(4).toString("hex");

let fd         = null;
let curDate    = null;
let rollAt     = 0;     // 이 시각을 넘으면 날짜 파일을 바꾼다
let installed  = false;

// ⚠ 원본을 **갈아끼우기 전에** 붙잡아 둔다 — 나중에 참조하면 자기 자신을 불러 무한 재귀
const orig = {
  log:   console.log.bind(console),
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
};

function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nextMidnight() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

// ⚠ **열린 fd에 `writeSync`로 쓴다** — 스트림(`createWriteStream`)이 아니다.
//   스트림은 버퍼링이라 프로세스가 갑자기 죽으면 **마지막 줄들이 통째로 사라진다**
//   (실측: `install()` 직후 `process.exit()` 하니 `SERVER_BOOT`이 안 남았다).
//   이 로그의 존재 이유가 **"죽기 직전에 무슨 일이 있었나"**라서, 정작 그 구간을
//   잃으면 쓸모가 없다.
//   ⚠ 그렇다고 `appendFileSync`로 되돌리지 말 것 — 그건 줄마다 열고/쓰고/닫는다.
//     fd를 붙들고 있으면 syscall 한 번이다
//   ※ 동기 I/O지만 이 저장소의 로그는 전부 조건부라 하루 수백 줄 수준이고 한 줄에
//     수십 µs다. 옛 `trade_log.json`이 문제였던 건 동기라서가 아니라 **파일 전체를
//     읽고 다시 썼기 때문**이다 (크기에 비례해 계속 느려졌다)
function openStream() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    curDate = localDate();
    rollAt  = nextMidnight();
    fd      = fs.openSync(path.join(DIR, `${curDate}.jsonl`), "a");
  } catch {
    fd = null;   // 디스크가 꽉 차거나 잠겨도 앱은 그대로 굴러가야 한다
  }
}

/** 보존 기간이 지난 날짜 파일 삭제 — 비동기라 이벤트 루프를 막지 않는다 */
function sweep() {
  const cutoff = Date.now() - RETAIN_DAYS * 86400_000;
  fs.readdir(DIR, (err, files) => {
    if (err) return;
    for (const f of files) {
      const m = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/.exec(f);
      if (!m) continue;
      const t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
      if (t < cutoff) fs.unlink(path.join(DIR, f), () => {});
    }
  });
}

function ensureStream() {
  if (fd === null) { openStream(); return; }
  if (Date.now() >= rollAt) {          // 날짜가 넘어갔다 → 새 파일
    try { fs.closeSync(fd); } catch {}
    fd = null;
    openStream();
    sweep();
  }
}

function writeLine(obj) {
  try {
    ensureStream();
    if (fd === null) return;
    fs.writeSync(fd, JSON.stringify(obj) + "\n");
  } catch { /* 로그 실패가 앱을 멈추면 안 된다 */ }
}

/**
 * 구조화 이벤트 한 줄.
 *
 * @param event   안정적인 식별자 (SCREAMING_SNAKE). **문구가 아니다** — 바꾸지 말 것
 * @param fields  { level?, orderSide?, posSide?, orderId?, qty?, price?, err?, ... }
 *
 * 예) log("ENTRY_FILLED", { orderId, orderSide:"BUY", posSide:"LONG", qty, price, tp, sl })
 */
function log(event, fields = {}) {
  const { level = "info", ...rest } = fields;
  const now = Date.now();
  writeLine({
    ts: now, iso: new Date(now).toISOString(), boot: BOOT,
    kind: "event", level, event, symbol: rest.symbol || SYMBOL,
    ...rest,
  });
}

/** 거래소 오류를 `err: { code, msg }`로 — 원인을 요약하지 말 것 */
function errOf(e) {
  if (!e) return null;
  return {
    code: e.response?.data?.code ?? null,
    msg:  e.response?.data?.msg  ?? e.message ?? String(e),
  };
}

// `[UDS] 연결 끊김…` → tag="UDS" / msg="연결 끊김…"
const TAG_RE = /^\[([^\]]{1,20})\]\s*/;

function fmt(a) {
  if (typeof a === "string") return a;
  if (a instanceof Error)    return a.stack || a.message;
  // 순환 참조가 있으면 JSON.stringify가 던진다 — 로그 한 줄 때문에 죽지 않게 감싼다
  try { return JSON.stringify(a); } catch { return String(a); }
}

function writeConsole(level, args) {
  try {
    // ⚠ **먼저 trim한다.** 이 저장소에는 줄바꿈으로 시작하는 로그가 있다
    //   (`[서버] 실행중` 앞에 빈 줄을 넣어 콘솔에서 눈에 띄게 한 것). 그대로 두면
    //   `[`로 시작하지 않아 **태그가 안 잡힌다** — 태그로 거르는 게 이 로그의
    //   주된 사용법이라 조용히 새는 값이 된다
    let msg = args.map(fmt).join(" ").trim();
    let tag = null;
    const m = TAG_RE.exec(msg);
    if (m) { tag = m[1]; msg = msg.slice(m[0].length); }
    const now = Date.now();
    writeLine({
      ts: now, iso: new Date(now).toISOString(), boot: BOOT,
      kind: "console", level, tag, msg,
    });
  } catch {}
}

/**
 * console.log/warn/error를 감싼다. **기존 호출부(144곳)는 한 줄도 고치지 않는다.**
 * ⚠ `server.js` 맨 위에서, 다른 모듈을 require 하기 **전에** 부를 것
 */
function install() {
  if (installed) return;
  installed = true;
  openStream();
  sweep();

  // ⚠ **파일에 먼저 쓰고 콘솔은 그다음이다.** 순서를 뒤집지 말 것 —
  //   콘솔 창이 막히면(빠른 편집 모드) `orig.log`에서 멈춰 서서
  //   **정작 그 사고를 기록해야 할 줄이 파일에 안 남는다**
  console.log   = (...a) => { writeConsole("log",   a); orig.log(...a);   };
  console.warn  = (...a) => { writeConsole("warn",  a); orig.warn(...a);  };
  console.error = (...a) => { writeConsole("error", a); orig.error(...a); };

  log("SERVER_BOOT", { node: process.version, pid: process.pid });
}

/**
 * 종료 기록 + 버퍼 비우기.
 *
 * ⚠ **두 번 불려도 안전해야 한다** — 정상 종료와 강제 종료(5초 타임아웃) 양쪽에서 부른다.
 *   재시작 경계는 이 로그의 핵심이라(꺼져 있던 사이가 곧 사고 원인) 반드시 남아야 한다
 */
let closed = false;
function close(reason = "shutdown") {
  if (closed) return;
  closed = true;
  log("SERVER_STOP", { reason });   // writeSync라 이 줄은 반드시 파일에 닿는다
  try { if (fd !== null) fs.closeSync(fd); } catch {}
  fd = null;
}

module.exports = { install, close, log, errOf, BOOT, DIR };
