require("dotenv").config();

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
    console.warn(`[멈춤감지] 백엔드가 ${(lastGap / 1000).toFixed(1)}초간 멈춰 있었습니다 — 그 사이 쌓인 요청은 거절됩니다`);
  }
}, TICK_MS).unref();

app.use((req, res, next) => {
  if (req.method === "GET" || lastGap <= FREEZE_MS) return next();
  console.warn(`[멈춤감지] ${req.method} ${req.originalUrl} 거절 (${(lastGap / 1000).toFixed(1)}초간 멈춰 있었음)`);
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
app.use("/api/indicator-params", require("./routes/indicatorparams"));
app.use("/api/leverage",         require("./routes/leverage"));
app.use("/api/daily-loss",       require("./routes/dailyloss"));
// 화면에서 일어난 일 — "왜 이 주문이 나갔나"의 절반은 프론트에 있다 (routes/log.js)
app.use("/api/log",              require("./routes/log"));

// ── 서버 시작 ─────────────────────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  push.init(server); // WebSocket push 서버 초기화
  console.log(`\n[서버] 실행중 -> http://localhost:${PORT}\n`);
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    console.warn("[서버] 경고: .env 파일에 API 키가 없습니다!\n");
  } else {
    console.log("[서버] API 키 확인됨\n");
    await syncServerTime();
    await recoverPendingOrders();
    // 손익·수수료·펀딩비를 로그에 남긴다 (10분 주기) — 이게 있어야 로그 하나로
    // 수익 곡선을 그릴 수 있다. API 키가 있을 때만 의미가 있으므로 여기서 시작한다
    incomeLogger.start();
    // 하루가 끝나면 그날치를 한 줄로 요약한다 — "지난달 어땠어?"에 30줄만 읽고 답하기 위해
    dailySummary.start();
  }
});

// ── 그레이스풀 셧다운 ──────────────────────────────────────────────────────────
async function shutdown() {
  console.log("\n[서버] 종료 중...");
  stopWatcher();
  incomeLogger.stop();
  dailySummary.stop();
  await store.flush();
  server.close(() => {
    console.log("[서버] 종료 완료");
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
