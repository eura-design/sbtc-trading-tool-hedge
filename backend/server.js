// `quiet: true` — dotenv가 부팅마다 찍는 광고 줄(`injecting env … 🔐 encrypt with Dotenvx`)을
// 막는다. 이 줄은 logStore 설치 **전에** 나가서 파일에도 안 남고 터미널만 어지럽힌다
require("dotenv").config({ quiet: true });

// ⚠ **다른 require보다 먼저.** 콘솔 출력과 구조화 이벤트를 `logs/<날짜>.jsonl`에
//   남기는데, 이 줄 앞에서 찍힌 것은 파일에 안 남는다
//   (모듈은 require 되는 순간 로그를 찍을 수 있다)
const logStore = require("./store/logStore");
logStore.install();

const express = require("express");
const cors    = require("cors");

const { recoverPendingOrders }   = require("./services/recoveryService");
const { stop: stopWatcher }      = require("./services/orderWatcher");
const { syncServerTime }         = require("./services/binanceClient");
const incomeLogger               = require("./services/incomeLogger");
const dailySummary               = require("./services/dailySummary");
const backupStore                = require("./store/backupStore");
const store                      = require("./store/pendingOrders");
const push                       = require("./services/pushService");

const path = require("path");

const app  = express();
const PORT = 3002;

// CORS: 허용 origin 제한 (.env의 ALLOWED_ORIGINS 또는 개발 기본값)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:5174"];

// ── 기타/ 정적 페이지 (월별 결산·복리 계산기) ─────────────────────────────────
//   http://localhost:3002/tools/monthly_tracker.html 로 열면 **동일 출처**라
//   CORS가 아예 끼지 않는다. 권장 경로
app.use("/tools", express.static(path.join(__dirname, "..", "기타")));

// ⚠ /api/tracker만 `null` origin을 허용한다 — 그 페이지를 file://로 직접 열었을 때
//   브라우저가 보내는 값이다. **전역 allowedOrigins에 "null"을 넣지 말 것**:
//   그러면 아무 로컬 HTML이나 샌드박스 iframe이 주문·잔고 API까지 부를 수 있다.
//   여기서 오가는 건 월별 결산 숫자뿐이라 범위가 이 라우트에 갇힌다
//   ⚠ 전역 cors()보다 **먼저** 마운트해야 한다. 전역 cors가 origin 불일치 시에도
//     OPTIONS 프리플라이트를 204로 끝내버려서, 뒤에 있으면 POST가 도달하지 못한다
const trackerCors = cors({ origin: [...allowedOrigins, "null"] });
app.options("/api/tracker", trackerCors);
app.use("/api/tracker", trackerCors, express.json({ limit: "1mb" }), require("./routes/tracker"));

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "10mb" }));

// ── 멈춤 감지 — 얼어 있던 사이 쌓인 요청을 거절한다 (2026-08-23) ──────────────
//
// ⚠ **실제로 당한 사고다.** 콘솔 창을 클릭하면 윈도우가 출력을 멈추는데
//   (빠른 편집 모드), 그러면 stdout에 쓰려던 이 프로세스가 통째로 얼어붙는다.
//   그 상태에서 낸 숏 주문 여러 건이 큐에 쌓여 있다가, 얼음이 풀리는 순간
//   **한꺼번에 거래소로 나갔다** — 포지션 하나와 추가 진입 여러 건이 동시에 걸렸다
//
// 원리: TICK_MS마다 시각을 찍고 **찍은 간격**을 본다. 이벤트 루프가 막히면
//   타이머도 같이 막히므로 그 간격이 곧 멈춰 있던 시간이다. 깨어난 직후 처리되는
//   요청 = 그동안 쌓여 있던 것들 → 상태를 바꾸는 요청은 거절한다.
//   한 틱 뒤 간격이 정상으로 돌아오므로 저절로 풀린다 (영구히 막히지 않는다)
//
// ⚠ **`Date.now() - lastTick`으로 판정하면 안 된다** — 깨어날 때 타이머 콜백이
//   대기 중인 소켓 데이터보다 **먼저** 돌아서(타이머 단계 → poll 단계) 그 값이
//   이미 리셋돼 있다. 반드시 **간격을 따로 기록**해서 봐야 한다 (실측 확인)
//
// ⚠ **TICK_MS는 FREEZE_MS보다 충분히 작아야 한다.** 정상 간격이 곧 TICK_MS라,
//   둘이 가까우면 **평소 주문까지 전부 거절된다**. 지금은 0.2초 : 1초
//
// ⚠ GET은 막지 않는다 — 잔고·포지션 조회까지 끊기면 화면이 통째로 죽는다.
//   위험한 건 주문·취소·청산처럼 **상태를 바꾸는 요청**뿐이다
//
// ※ 5초 넘게 멈추면 Node가 keep-alive 연결을 스스로 끊어서 요청이 도달조차
//   못 한다(실측). 이 가드는 그보다 짧은 멈춤을 맡는다 — 두 겹이다
const TICK_MS   = 200;
const FREEZE_MS = 1000;
let lastTick = Date.now();
let lastGap  = 0;
setInterval(() => {
  const now = Date.now();
  lastGap  = now - lastTick;
  lastTick = now;
  if (lastGap > FREEZE_MS) {
    // ⚠ 구조화 이벤트로 남긴다 — 예전엔 `console.warn` 한 줄이 **유일한 기록**이라
    //   나중에 "그때 몇 초 멈췄었나"를 셀 수 없었다 (92분 사고가 바로 그 경우다)
    logStore.log("FREEZE_DETECTED", { level: "warn", gapMs: lastGap, thresholdMs: FREEZE_MS });
  }
}, TICK_MS).unref();

app.use((req, res, next) => {
  if (req.method === "GET" || lastGap <= FREEZE_MS) return next();
  logStore.log("FREEZE_REJECTED", {
    level: "warn", method: req.method, path: req.originalUrl, gapMs: lastGap,
  });
  res.status(503).json({ error: "백엔드가 잠시 멈춰서 주문이 취소됐습니다 — 다시 시도하세요" });
});

// ── 라우트 ────────────────────────────────────────────────────────────────────
app.use("/api/health",   require("./routes/health"));
app.use("/api/balance",  require("./routes/balance"));
app.use("/api/position", require("./routes/position"));
app.use("/api/order",    require("./routes/order"));
app.use("/api/close",    require("./routes/close"));
app.use("/api/orders",   require("./routes/orders"));
app.use("/api/tpsl",      require("./routes/tpsl"));
app.use("/api/stats",     require("./routes/stats"));
app.use("/api/scale-in",   require("./routes/scalein"));
app.use("/api/leverage",         require("./routes/leverage"));
app.use("/api/daily-loss",       require("./routes/dailyloss"));
// 화면에서 일어난 일 — "왜 이 주문이 나갔나"의 절반은 프론트에 있다 (routes/log.js)
app.use("/api/log",              require("./routes/log"));
// 백업 — 브라우저 저장소를 받아 하루 한 파일로 남긴다 (store/backupStore.js)
// ⚠ 본문이 브라우저 저장소 전체라 크다. **위의 전역 `express.json({ limit: "10mb" })`가
//   이미 적용된다** — 여기에 또 붙이면 전역이 먼저 파싱해서 아무 일도 안 하는데,
//   읽는 사람은 8MB가 한도인 줄 알게 된다. 실제 상한은 backupStore의 MAX_BYTES(4MB)다
//   (`/api/tracker`가 자기 파서를 갖는 건 전역보다 **앞에** 있기 때문이다 — 여긴 뒤다)
app.use("/api/backup", require("./routes/backup"));

// ── 서버 시작 ─────────────────────────────────────────────────────────────────
// ⚠ **127.0.0.1에만 붙인다 — 두 번째 인자를 지우지 말 것** (2026-09-02).
//   빼면 Node가 0.0.0.0(모든 인터페이스)에 붙는다. 그러면 같은 공유기에 있는 누구든
//   `curl -X POST http://<이PC>:3002/api/order`로 **실제 주문을 낼 수 있다.**
//   위 CORS는 이걸 막지 못한다 — origin 헤더는 브라우저만 보낸다.
//   이 서버에는 로그인도 토큰도 없고, 남은 방어선은 일일 손실 한도뿐이다.
//
//   프론트엔드도 `API_BASE = "http://localhost:3002"` 하나만 부르므로 잃는 것이 없다.
//   ⚠ 나중에 휴대폰 같은 다른 기기에서 열고 싶어지면, 여기를 여는 게 아니라
//     **인증을 먼저** 붙일 것 (SSH 터널이나 리버스 프록시가 더 쉽다)
const HOST = "127.0.0.1";
const server = app.listen(PORT, HOST, async () => {
  push.init(server); // WebSocket push 서버 초기화
  const hasKey = !!(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET);
  logStore.log("SERVER_LISTENING", { port: PORT, host: HOST, url: `http://localhost:${PORT}`, apiKey: hasKey });
  if (!hasKey) {
    logStore.log("API_KEY_MISSING", { level: "warn" });
  } else {
    await syncServerTime();
    await recoverPendingOrders();
    // 손익·수수료·펀딩비를 로그에 남긴다 (10분 주기) — 이게 있어야 로그 하나로
    // 수익 곡선을 그릴 수 있다. API 키가 있을 때만 의미가 있으므로 여기서 시작한다
    incomeLogger.start();
    // 하루가 끝나면 그날치를 한 줄로 요약한다 — "지난달 어땠어?"에 30줄만 읽고 답하기 위해
    dailySummary.start();
  }
  // 백업 — **API 키와 무관하게** 시작한다. 매매 기능이 아니라 "지워져도 되살리기"용이라
  // 키가 없는 환경(설정 전, 다른 PC)에서도 도형·설정은 지켜져야 한다
  backupStore.start();
});

// ── 그레이스풀 셧다운 ──────────────────────────────────────────────────────────
async function shutdown() {
  logStore.log("SERVER_STOPPING");
  stopWatcher();
  incomeLogger.stop();
  dailySummary.stop();
  // 끄기 직전 상태를 한 번 더 남긴다 — 마지막 몇 시간이 통째로 비는 것을 막는다
  backupStore.writeSnapshot();
  backupStore.stop();
  await store.flush();
  server.close(() => {
    // ※ 완료 기록은 `logStore.close()`의 SERVER_STOP 한 줄이다 — 여기서 또 찍으면
    //   같은 사실이 두 줄이 된다 (재시작 경계를 셀 때 두 배로 잡힌다)
    logStore.close(); // 버퍼에 남은 줄을 흘려보낸다 — 안 하면 마지막 몇 줄이 사라진다
    process.exit(0);
  });
  // 5초 후 강제 종료
  // ⚠ 이 경로로 죽어도 **종료 기록은 남겨야 한다** — 재시작 경계를 잃으면
  //   "그 사이 꺼져 있었나"를 로그로 알 수 없다 (close는 두 번 불려도 안전하다)
  setTimeout(() => { logStore.close("forced"); process.exit(1); }, 5000);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);
