const WebSocket    = require("ws");
const { binance, placeTPSL, checkExistingTPSL } = require("./binanceClient");
const store          = require("../store/pendingOrders");
const push           = require("./pushService");
const tradeLog       = require("../store/tradeLog");
const statsCache     = require("./statsCache");

// 포지션 상태 추적 (reconcile 간 상태 유지)
let prevHasPos          = null; // null = 최초 실행 전
let currentEntryFilledAt = null; // 진입 체결 시각 (ms)

const RECONCILE_INTERVAL = 60 * 1000; // 60초마다 바이낸스 실제 상태와 검증
let reconcileTimer = null;

let listenKeyTimer    = null;
let userDataWS        = null;
let pollTimer         = null;
let reconnectTimer    = null;
let reconnectDelay    = 5000;
const MAX_RECONNECT   = 60000;

// ListenKey 갱신 실패 카운터
let listenKeyFailCount = 0;
const MAX_LISTENKEY_FAILURES = 3;

async function getListenKey() {
  const { data } = await binance("POST", "/fapi/v1/listenKey", {});
  return data.listenKey;
}

async function keepAliveListenKey(listenKey) {
  try {
    await binance("PUT", "/fapi/v1/listenKey", { listenKey });
    listenKeyFailCount = 0; // 성공 시 초기화
  } catch (e) {
    listenKeyFailCount++;
    console.warn(`[UDS] listenKey 갱신 실패 (${listenKeyFailCount}/${MAX_LISTENKEY_FAILURES}):`, e.response?.data?.msg || e.message);
    if (listenKeyFailCount >= MAX_LISTENKEY_FAILURES) {
      console.error("[UDS] listenKey 갱신 연속 실패 → 새 listenKey로 재연결");
      listenKeyFailCount = 0;
      // 기존 WS 종료 후 재시작
      if (userDataWS) { try { userDataWS.terminate(); } catch {} userDataWS = null; }
      startUserDataStream();
    }
  }
}

async function onFilled(orderId, executionData) {
  const info = store.get(orderId);
  if (!info) return;

  const fillPrice = parseFloat(executionData.ap || executionData.L || executionData.price || 0);
  console.log(`[UDS] 진입 체결됨 orderId=${orderId} fillPrice=${fillPrice} → TP/SL 등록 시작`);
  store.set(orderId, { ...info, status: "FILLED", fillPrice, filledAt: Date.now() });

  // 거래 로그 기록
  tradeLog.append({ event: "FILLED", orderId, side: info.side, qty: info.qty, fillPrice, tp: info.tp, sl: info.sl });

  if (!info.tp || !info.sl) {
    console.error(`[경고] TP/SL 가격 없음 (orderId=${orderId}) — 수동 설정 필요!`);
    store.set(orderId, { ...info, status: "TPSL_MISSING" });
    push.pushAlert("critical", `주문 ${orderId} 체결됨 — TP/SL 가격 없음! 즉시 수동 설정 필요`);
    push.pushUpdate(["position", "balance"]);
    return;
  }

  const tpsl = await placeTPSL(info);
  const slFailed = tpsl.failed.some(f => f.type === "SL");
  const tpFailed = tpsl.failed.some(f => f.type === "TP");

  if (tpsl.failed.length > 0) {
    const failedTypes = tpsl.failed.map(f => f.type).join(", ");
    console.error(`[경고] TP/SL 부분 실패 orderId=${orderId}: ${failedTypes}`);
    store.set(orderId, { ...info, status: "TPSL_PARTIAL", tpsl });
    tradeLog.append({ event: "TPSL_PARTIAL", orderId, failed: failedTypes });

    if (slFailed) {
      const msg = `⚠ 긴급: SL 등록 5회 실패 — orderId=${orderId} 포지션 무방비! 즉시 수동 SL 설정 필요`;
      console.error(`[긴급] ${msg}`);
      push.pushAlert("critical", msg);
    }
    if (tpFailed) {
      push.pushAlert("warning", `TP 등록 실패 (orderId=${orderId}) — 수동 설정 필요`);
    }
  } else {
    console.log(`[UDS] TP/SL 등록 완료 orderId=${orderId}`);
    store.set(orderId, { ...info, status: "TPSL_PLACED", tpsl });
    tradeLog.append({ event: "TPSL_PLACED", orderId, tp: info.tp, sl: info.sl });
  }

  push.pushUpdate(["position", "balance", "tpsl"]);
}

// UDS 실패 시 폴링으로 체결 여부 확인
async function pollForFills() {
  const watching = [...store.entries()].filter(([, o]) => o.status === "WATCHING");
  for (const [orderId] of watching) {
    try {
      const { data } = await binance("GET", "/fapi/v1/order", { symbol: "BTCUSDT", orderId });
      if (data.status === "FILLED")                                     await onFilled(orderId, data);
      else if (data.status === "CANCELED" || data.status === "EXPIRED") {
        console.log(`[POLL] 주문 ${orderId} 상태: ${data.status} → store 제거`);
        store.delete(orderId);
        push.pushUpdate(["position"]);
      }
    } catch (e) {
      console.warn(`[POLL] orderId=${orderId} 조회 실패:`, e.response?.data?.msg || e.message);
    }
  }
}

// 바이낸스 실제 미체결 주문과 store를 주기적으로 검증/교정
async function reconcileWithBinance() {
  const relevant = [...store.entries()].filter(
    ([, o]) => o.status === "WATCHING" || o.status === "SCALE_IN" || o.status === "SPLIT_TP"
  );

  // store에 pending 없어도 포지션 추적은 항상 실행
  const hasStoreEntries = store.size > 0;
  if (!relevant.length && !hasStoreEntries && prevHasPos !== true) return;

  try {
    const [{ data: openOrders }, { data: posData }] = await Promise.all([
      binance("GET", "/fapi/v1/openOrders",   { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" }),
    ]);
    const openIds  = new Set(openOrders.map(o => String(o.orderId)));
    const hasPos   = posData.some(p => parseFloat(p.positionAmt) !== 0);

    // ── 포지션 오픈 → 진입 시각 기록 ──────────────────────────────────────
    if (hasPos && prevHasPos !== true && currentEntryFilledAt === null) {
      const storeEntry = [...store.entries()].find(([, o]) =>
        o.status === "TPSL_PLACED" || o.status === "TPSL_PARTIAL" || o.status === "FILLED"
      );
      const posUpdateTime = posData.find(p => parseFloat(p.positionAmt) !== 0)?.updateTime;
      currentEntryFilledAt = storeEntry?.[1]?.filledAt
        || (posUpdateTime ? parseInt(posUpdateTime) : Date.now() - 24 * 60 * 60 * 1000);
      console.log(`[RECONCILE] 포지션 진입 감지, filledAt=${currentEntryFilledAt}`);
    }

    // ── 포지션 클로즈 → stats 캐시 무효화 신호 ──────────────────────────
    if (prevHasPos === true && !hasPos) {
      console.log("[RECONCILE] 포지션 종료 감지 → stats 갱신 push");
      statsCache.invalidateCache();
      push.pushUpdate(["stats"]);
      currentEntryFilledAt = null;
    }

    prevHasPos = hasPos;

    // ── TPSL_PARTIAL / FILLED(TP/SL 미등록) → 포지션 있으면 재시도 ──────────
    const retryable = [...store.entries()].filter(
      ([, o]) => (o.status === "TPSL_PARTIAL" || o.status === "FILLED") && o.tp && o.sl
    );
    if (retryable.length > 0) {
      if (!hasPos) {
        // 포지션이 없으면 해당 항목은 더 이상 유효하지 않음 → 제거
        for (const [orderId] of retryable) store.delete(orderId);
      } else {
        const hasTpsl = await checkExistingTPSL();
        for (const [orderId, info] of retryable) {
          if (hasTpsl) {
            // TP/SL이 이미 등록돼 있으면 PLACED로 전환
            store.set(orderId, { ...info, status: "TPSL_PLACED" });
            console.log(`[RECONCILE] TP/SL 이미 존재 → TPSL_PLACED 전환 orderId=${orderId}`);
          } else {
            console.log(`[RECONCILE] TPSL 재시도 orderId=${orderId} (status=${info.status})`);
            const tpsl = await placeTPSL(info);
            if (tpsl.failed.length === 0) {
              store.set(orderId, { ...info, status: "TPSL_PLACED", tpsl });
              console.log(`[RECONCILE] TPSL 재등록 완료 orderId=${orderId}`);
              push.pushUpdate(["tpsl"]);
            } else {
              const failed = tpsl.failed.map(f => f.type).join(", ");
              console.error(`[RECONCILE] TPSL 재시도도 실패 (${failed}) orderId=${orderId}`);
              store.set(orderId, { ...info, status: "TPSL_PARTIAL", tpsl });
              if (tpsl.failed.some(f => f.type === "SL")) {
                push.pushAlert("critical", `⚠ SL 재등록 실패 (orderId=${orderId}) — 수동 설정 필요!`);
              }
            }
          }
        }
      }
    }

    if (!relevant.length) return;

    // 포지션이 없는데 SCALE_IN 주문이 남아 있으면 전부 취소
    if (!hasPos) {
      const scaleIns = relevant.filter(([, o]) => o.status === "SCALE_IN");
      for (const [orderId] of scaleIns) {
        try {
          await binance("DELETE", "/fapi/v1/order", { symbol: "BTCUSDT", orderId });
        } catch (e) {
          console.warn(`[RECONCILE] SCALE_IN 취소 실패 orderId=${orderId}:`, e.response?.data?.msg);
        }
        store.delete(orderId);
        console.log(`[RECONCILE] 포지션 없음 → SCALE_IN 주문 취소 orderId=${orderId}`);
      }
      if (scaleIns.length) push.pushUpdate(["position"]);
    }

    for (const [orderId, info] of relevant) {
      if (openIds.has(String(orderId))) continue;

      try {
        const { data } = await binance("GET", "/fapi/v1/order", { symbol: "BTCUSDT", orderId });
        if (data.status === "FILLED") {
          if (info.status === "WATCHING") {
            await onFilled(orderId, data);
          } else if (info.status === "SCALE_IN") {
            console.log(`[RECONCILE] 추가 진입 체결됨 orderId=${orderId}`);
            store.delete(orderId);
            push.pushUpdate(["position", "balance"]);
          } else if (info.status === "SPLIT_TP") {
            console.log(`[RECONCILE] 분할 TP 체결됨 orderId=${orderId}`);
            store.delete(orderId);
            push.pushUpdate(["position", "balance", "tpsl"]);
          }
        } else if (data.status === "CANCELED" || data.status === "EXPIRED" || data.status === "REJECTED") {
          console.log(`[RECONCILE] 주문 ${orderId} 상태: ${data.status} → store 제거`);
          store.delete(orderId);
          push.pushUpdate(["position"]);
        } else {
          // NEW / PARTIALLY_FILLED 등 아직 살아있는 상태 — openOrders 응답 지연일 뿐
          // (실수로 지우면 position.js에서 external 주문으로 오인됨)
          console.log(`[RECONCILE] 주문 ${orderId} 상태: ${data.status} → 유지 (openOrders 응답 지연)`);
        }
      } catch (e) {
        console.warn(`[RECONCILE] orderId=${orderId} 조회 실패:`, e.response?.data?.msg || e.message);
      }
    }
  } catch (e) {
    console.warn("[RECONCILE] openOrders 조회 실패:", e.response?.data?.msg || e.message);
  }
}

function startPolling() {
  if (pollTimer) return;
  console.warn("[UDS] 폴링 모드 시작 (30초 간격)");
  pollTimer = setInterval(pollForFills, 30000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function connectUserDataStream(listenKey) {
  if (userDataWS) {
    try { userDataWS.terminate(); } catch {}
  }

  userDataWS = new WebSocket(`wss://fstream.binance.com/ws/${listenKey}`);

  userDataWS.on("open", () => {
    stopPolling();
    reconnectDelay = 5000;
    console.log("[UDS] User Data Stream 연결됨");
  });

  userDataWS.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.e !== "ORDER_TRADE_UPDATE") return;
      const o = msg.o;
      if (!store.has(o.i)) return;

      if (o.X === "FILLED" && o.o === "LIMIT") {
        const info = store.get(o.i);
        if (info?.status === "SPLIT_TP") {
          console.log(`[UDS] 분할 TP 체결됨 orderId=${o.i}`);
          store.delete(o.i);
          push.pushUpdate(["position", "balance", "tpsl"]);
        } else if (info?.status === "SCALE_IN") {
          console.log(`[UDS] 추가 진입 체결됨 orderId=${o.i}`);
          store.delete(o.i);
          push.pushUpdate(["position", "balance"]);
        } else {
          await onFilled(o.i, o);
        }
      } else if (o.X === "CANCELED" || o.X === "EXPIRED") {
        console.log(`[UDS] 주문 ${o.i} ${o.X} → store 제거`);
        store.delete(o.i);
        push.pushUpdate(["position"]);
      }
    } catch (e) {
      console.error("[UDS] 메시지 처리 오류:", e.message);
    }
  });

  userDataWS.on("close", () => {
    console.warn(`[UDS] 연결 끊김, ${reconnectDelay / 1000}초 후 재연결...`);
    startPolling();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; startUserDataStream(); }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT);
  });

  userDataWS.on("error", e => console.error("[UDS] 오류:", e.message));
}

async function startUserDataStream() {
  try {
    const listenKey = await getListenKey();
    connectUserDataStream(listenKey);

    if (listenKeyTimer) clearInterval(listenKeyTimer);
    listenKeyTimer = setInterval(() => keepAliveListenKey(listenKey), 25 * 60 * 1000);
  } catch (e) {
    console.error("[UDS] 시작 실패:", e.response?.data?.msg || e.message);
    startPolling();
  }

  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = setInterval(reconcileWithBinance, RECONCILE_INTERVAL);
}

function stop() {
  if (reconnectTimer)  { clearTimeout(reconnectTimer);   reconnectTimer  = null; }
  if (listenKeyTimer)  { clearInterval(listenKeyTimer);  listenKeyTimer  = null; }
  if (reconcileTimer)  { clearInterval(reconcileTimer);  reconcileTimer  = null; }
  if (userDataWS)      { try { userDataWS.terminate(); } catch {} userDataWS = null; }
  stopPolling();
}

module.exports = { startUserDataStream, stop };
