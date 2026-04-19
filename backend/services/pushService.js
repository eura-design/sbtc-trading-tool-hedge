const WebSocket = require("ws");

let wss = null;
const clients = new Set();

function init(server) {
  wss = new WebSocket.Server({ server });
  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
    console.log(`[PUSH] 프론트엔드 연결됨 (총 ${clients.size}개)`);
  });
  console.log("[PUSH] WebSocket 서버 시작됨");
}

/**
 * 프론트엔드에 업데이트 신호를 보냄.
 * targets: ["position", "balance", "tpsl"] 중 해당되는 것들
 */
function broadcast(type, data) {
  if (!wss || clients.size === 0) return;
  const msg = JSON.stringify({ type, ...data, ts: Date.now() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

/** 포지션/잔고 갱신 신호 */
function pushUpdate(targets) {
  broadcast("update", { targets });
}

/** 긴급 알림 (SL 실패 등) */
function pushAlert(level, msg) {
  broadcast("alert", { level, msg });
}

module.exports = { init, pushUpdate, pushAlert };
