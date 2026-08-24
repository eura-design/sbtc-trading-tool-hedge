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
    if (client.readyState !== WebSocket.OPEN) {
      // OPEN이 아닌(CLOSING/CLOSED) 클라이언트는 close 이벤트 누락 가능 → 즉시 제거
      clients.delete(client);
      continue;
    }
    try {
      client.send(msg);
    } catch (e) {
      console.warn("[PUSH] 전송 실패 → 클라이언트 제거:", e.message);
      clients.delete(client);
    }
  }
}

/** 포지션/잔고 갱신 신호 */
function pushUpdate(targets) {
  broadcast("update", { targets });
}

/** 긴급 알림 (SL 실패 등) — 빨간 배너, 확인 버튼을 눌러야 사라진다 */
function pushAlert(level, msg) {
  broadcast("alert", { level, msg });
}

/**
 * 지나가는 알림 (금색 토스트, 30초 뒤 자동으로 사라짐) — 2026-08-24.
 *
 * `pushAlert`와 나눈 이유: 무방비 경보가 **해소됐을 때** 무슨 일이 있었는지 알려주려는데,
 * 그건 좋은 소식이라 빨간 배너 + 확인 버튼이 어울리지 않는다. 배너를 거두는
 * `pushAlertClear`는 조용히 지우기만 해서, 사용자는 배너가 왜 사라졌는지 알 수 없었다.
 */
function pushNotice(msg) {
  broadcast("notice", { msg });
}

/**
 * 이미 띄운 경보를 거두는 신호 (2026-08-22).
 *
 * ⚠ **`msg`는 `pushAlert`로 보낸 문구와 글자 그대로 같아야 한다** — 프론트는
 *   문구를 키로 목록에서 지운다(uiSlice.dismissCriticalAlert). 한쪽 문구만 고치면
 *   배너가 영영 안 닫힌다. 그래서 무방비 경보는 orderWatcher의 `nakedMsg()` 하나가 만든다.
 *
 * 왜 필요한가: SL 없음 경보는 상태가 해소돼도(SL 재등록·포지션 종료) 화면에 그대로
 * 남아 있었다. 실측(08-22): SL 교체 중 **0.1초**의 빈틈에 경보가 떴고, 20ms 뒤
 * 새 SL이 걸렸는데도 배너는 몇 시간을 남아 "SL이 있는데 경보가 뜬다"로 보였다.
 */
function pushAlertClear(msg) {
  broadcast("alert-clear", { msg });
}

module.exports = { pushNotice, init, pushUpdate, pushAlert, pushAlertClear };
