const WebSocket = require("ws");
const { log, errOf } = require("../store/logStore");

let wss = null;
const clients = new Set();

function init(server) {
  wss = new WebSocket.Server({ server });
  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
    log("CLIENT_CONNECTED", { clients: clients.size });
  });
  log("PUSH_SERVER_STARTED", {});
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
      log("PUSH_SEND_FAILED", { level: "warn", clients: clients.size, err: errOf(e) });
      clients.delete(client);
    }
  }
}

/** 포지션/잔고 갱신 신호 */
function pushUpdate(targets) {
  broadcast("update", { targets });
}

/**
 * 사용자에게 즉시 알림.
 *
 * ⚠ **level은 두 갈래뿐이다** (2026-08-25 사용자 요청).
 *
 * | level | 화면 | 뜻 |
 * |---|---|---|
 * | `"critical"` (기본) | **빨간 배너** — 누르거나 `pushAlertClear`가 와야 사라진다 | **손절이 없거나 모자라다** |
 * | `"notice"` | 금색 토스트 — 30초 뒤 저절로 닫힌다 | 익절·수량 문제. 돈이 새지는 않는다 |
 *
 * 왜 나눴나: 예전엔 프론트가 level을 **읽지도 않고** 전부 빨간 배너로 띄웠다.
 * `⚠ LONG 포지션에 SL이 없습니다`와 `TP 등록 실패 — 수동 설정 필요`가 같은 무게로
 * 보여서, 빨간 줄이 떠도 읽어보기 전에는 손을 쓸지 정할 수 없었다.
 * 이제 **빨강 = 손절이 비어 있다** 하나다.
 *
 * ⚠ **level을 빠뜨리면 빨강이다** (프론트가 `notice`만 골라 내린다). 의도된 방향이다 —
 *   새 경보에 level을 안 붙여도 시끄러워질 뿐 조용히 묻히지 않는다.
 *   `notice`를 붙일 때는 **"손절과 무관한가"**를 먼저 확인할 것.
 *
 * ⚠ `notice`는 30초 뒤 사라지므로 **`pushAlertClear`로 거둘 수 없다** —
 *   거둘 일이 있는 경보(무방비 경보)는 반드시 `critical`이어야 한다
 */
function pushAlert(level, msg) {
  broadcast("alert", { level, msg });
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

module.exports = { init, pushUpdate, pushAlert, pushAlertClear };
