require("dotenv").config();
const express = require("express");
const cors    = require("cors");

const { recoverPendingOrders }   = require("./services/recoveryService");
const { stop: stopWatcher }      = require("./services/orderWatcher");
const { syncServerTime }         = require("./services/binanceClient");
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
  }
});

// ── 그레이스풀 셧다운 ──────────────────────────────────────────────────────────
async function shutdown() {
  console.log("\n[서버] 종료 중...");
  stopWatcher();
  await store.flush();
  server.close(() => {
    console.log("[서버] 종료 완료");
    process.exit(0);
  });
  // 5초 후 강제 종료
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);
