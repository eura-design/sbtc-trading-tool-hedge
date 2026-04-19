require("dotenv").config();
const express = require("express");
const cors    = require("cors");

const { recoverPendingOrders }   = require("./services/recoveryService");
const { stop: stopWatcher }      = require("./services/orderWatcher");
const { start: startSR, stop: stopSR } = require("./services/srService");
const { syncServerTime }         = require("./services/binanceClient");
const store                      = require("./store/pendingOrders");
const push                       = require("./services/pushService");

const app  = express();
const PORT = 3001;

// CORS: 허용 origin 제한 (.env의 ALLOWED_ORIGINS 또는 개발 기본값)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:5173"];
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
app.use("/api/sr-levels", require("./routes/sr"));
app.use("/api/stats",     require("./routes/stats"));
app.use("/api/scale-in",   require("./routes/scalein"));
app.use("/api/swap",       require("./routes/swap"));
app.use("/api/indicator-params", require("./routes/indicatorparams"));
app.use("/api/leverage",         require("./routes/leverage"));
app.use("/api/daily-loss",       require("./routes/dailyloss"));
app.use("/api/screenshot",       require("./routes/screenshot"));

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
    startSR();
  }
});

// ── 그레이스풀 셧다운 ──────────────────────────────────────────────────────────
async function shutdown() {
  console.log("\n[서버] 종료 중...");
  stopWatcher();
  stopSR();
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
