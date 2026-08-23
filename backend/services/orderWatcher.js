const WebSocket    = require("ws");
const { binance, cancelOrder, placeTPSL, checkExistingTPSL, cancelPresetTPSL } = require("./binanceClient");
const store          = require("../store/pendingOrders");
const push           = require("./pushService");
const tradeLog       = require("../store/tradeLog");
const statsCache     = require("./statsCache");
const { closeToPosition, sideToPosition } = require("../utils/side");
const { checkDailyLoss } = require("../routes/dailyloss");

// 포지션 상태 추적 (reconcile 간 상태 유지) — 헷지모드: LONG/SHORT 각각 독립 추적
let prevHasLong         = null; // null = 최초 실행 전
let prevHasShort        = null;
let currentEntryFilledAt = null; // 진입 체결 시각 (ms)

const RECONCILE_INTERVAL = 60 * 1000; // 60초마다 바이낸스 실제 상태와 검증
let reconcileTimer = null;

// placeTPSL 중복 호출 방지 락 — onFilled와 reconcile이 동시에 같은 orderId에 진입하지 않도록
// 재시도 최대 31초가 걸리므로 reconcile(60초) 윈도우와 겹칠 수 있음
const placingTpsl = new Set();

async function safePlaceTPSL(orderId, info) {
  if (placingTpsl.has(String(orderId))) {
    console.log(`[TPSL] orderId=${orderId} 이미 등록 진행 중 → 중복 호출 스킵`);
    return null;
  }
  placingTpsl.add(String(orderId));
  try {
    return await placeTPSL(info);
  } finally {
    placingTpsl.delete(String(orderId));
  }
}

// 중복 조회 방지 — /api/position이 30초마다 부르는 경로라 같은 주문이 여러 번 겹칠 수 있다
const resolvingOrphans = new Set();

// SL 없는 포지션 경보 래치 — 60초마다 같은 경보가 쌓이지 않게 사이드당 한 번만 띄운다
// (SL이 생기거나 포지션이 닫히면 해제 → 다음에 또 벌거벗으면 다시 울린다)
const nakedWarned = new Set();

// ⚠ **한 번 보고 경보하지 않는다 — 이 지연을 없애지 말 것** (2026-08-22, 실계좌 재현).
//   SL을 차트에서 드래그해 옮기면 `PUT /api/tpsl`이 **취소 → 등록** 순서로 처리하므로
//   그 사이 실제로 SL이 없는 순간이 생긴다(실측 69ms). 거기에 reconcile 조회가 끼어들어
//   오경보가 떴다:
//     01:37:01.010 기존 SL(72188.2) 취소 → .079 새 SL(65906.9) 등록 → .099 "SL이 없습니다"
//   순서를 뒤집는 건 답이 아니다 — 같은 사이드에 closePosition STOP_MARKET이 둘이 되는
//   순간이 생겨 바이낸스가 -4130으로 거절할 수 있다(`cancelExistingAlgoTPSL`이 있는 이유).
//   → 대신 **경보를 내기 전에 한 번 더 확인한다.** 교체 창은 0.1초, 여기 지연은 5초다
const NAKED_RECHECK_MS = 5000;

// 무방비 경보 문구는 여기 하나가 만든다 — 띄울 때와 거둘 때가 **글자 그대로 같아야**
// 프론트가 목록에서 지운다 (pushService.pushAlertClear 주석)
const nakedMsg = side => `⚠ ${side} 포지션에 SL이 없습니다`;

// 경보 해소 — 래치를 풀고, 이미 띄운 배너가 있으면 거둔다
// (안 거두면 20ms 만에 해결된 경보가 몇 시간씩 화면에 남는다 — 그게 이번 신고였다)
function resolveNaked(side) {
  if (!nakedWarned.delete(side)) return;
  push.pushAlertClear(nakedMsg(side));
  console.log(`[안전망] ${side} SL 확인됨 → 경보 해제`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 지정가 주문 접수 직후 "이미 체결됐는지"를 한 번 확인한다.
//
// ⚠ 이 검증을 빼지 말 것 (2026-08-15, 실계좌 재현). 호가를 먹는 가격의 지정가는
//   접수와 동시에 체결되는데, 그때 UDS의 FILLED 이벤트가 **store.set보다 먼저** 도착해
//   `if (!store.has(o.i)) return`에 걸려 통째로 버려진다. 그러면 TP/SL이 등록되지 않는다.
//   POST 응답의 status만 믿는 것도 안 된다 — 바이낸스는 즉시 체결돼도 보통 "NEW"를 돌려준다
//   (orderId 1103367652357: time === updateTime === 체결시각인데 응답은 NEW였다).
async function verifyImmediateFill(orderId, entryOrder) {
  try {
    if (entryOrder?.status === "FILLED") return await onFilled(orderId, entryOrder);
    // UDS가 정상 처리할 시간을 조금 주고 → 그래도 WATCHING이면 직접 확인
    await new Promise(r => setTimeout(r, 700));
    if (store.get(orderId)?.status !== "WATCHING") return;
    const { data } = await binance("GET", "/fapi/v1/order", { symbol: "BTCUSDT", orderId });
    if (data.status === "FILLED") {
      console.log(`[즉시체결] UDS가 놓친 체결 감지 orderId=${orderId} → TP/SL 등록`);
      await onFilled(orderId, data);
    }
  } catch (e) {
    console.warn(`[즉시체결] 확인 실패 orderId=${orderId}:`, e.response?.data?.msg || e.message);
  }
}

// openOrders에 없는 WATCHING 주문의 **실제 상태를 조회해서** 처리한다.
//
// ⚠ 체결과 취소는 둘 다 openOrders에서 사라진다. 구분 없이 store.delete하면
//   체결된 주문의 항목이 없어져 onFilled / pollForFills / reconcile이 **전부**
//   대상을 잃고 TP/SL이 영구 미등록으로 남는다 (실제로 그렇게 됐다).
//   지우는 건 바이낸스가 CANCELED/EXPIRED/REJECTED라고 답했을 때뿐이다.
// 진입 주문이 사라졌으면 **함께 걸어 둔 TP/SL도 내린다** (2026-08-23).
// 안 내리면 트리거 주문만 거래소에 남아, 나중에 그 사이드에 포지션이 생겼을 때
// 엉뚱한 가격에 발동한다. 체결(FILLED)일 때는 부르지 않는다 —
// 그쪽은 onFilled → placeTPSL이 cancelExistingAlgoTPSL로 갈아끼운다
async function dropPreset(orderId) {
  const info = store.get(String(orderId));
  if (!info?.presetTpsl) return;
  await cancelPresetTPSL(info.presetTpsl)
    .catch(e => console.warn(`[사전 TPSL] 취소 실패 orderId=${orderId}:`, e.message));
}

async function resolveOrphans(entries) {
  for (const [orderId] of entries) {
    const key = String(orderId);
    if (resolvingOrphans.has(key)) continue;
    resolvingOrphans.add(key);
    try {
      const { data } = await binance("GET", "/fapi/v1/order", { symbol: "BTCUSDT", orderId });
      if (data.status === "FILLED") {
        console.log(`[고아] 체결됐는데 감지 못한 주문 발견 orderId=${orderId} → TP/SL 등록`);
        if (store.get(orderId)?.status === "WATCHING") await onFilled(orderId, data);
      } else if (data.status === "CANCELED" || data.status === "EXPIRED" || data.status === "REJECTED") {
        console.log(`[고아] 주문 ${orderId} ${data.status} → store 제거`);
        await dropPreset(orderId);
        store.delete(orderId);
        push.pushUpdate(["position"]);
      } else {
        console.log(`[고아] 주문 ${orderId} 상태 ${data.status} → 유지 (openOrders 응답 지연)`);
      }
    } catch (e) {
      // 조회 실패 시엔 **지우지 않는다** — 못 지운 항목은 다음 사이클에 다시 본다
      console.warn(`[고아] orderId=${orderId} 조회 실패:`, e.response?.data?.msg || e.message);
    } finally {
      resolvingOrphans.delete(key);
    }
  }
}

// ── UDS 진단 (2026-08-23) ────────────────────────────────────────────────────
// "바이낸스에서 직접 낸 주문이 늦게 뜬다"는 보고의 원인을 가리기 위한 계측.
// UDS가 살아 있으면 체결이 즉시 반영되고, 끊겨 있으면 프론트 30초 폴링까지 기다린다
// (`pollForFills`는 store에 있는 주문만 봐서 **외부 주문은 폴링으로도 안 잡힌다**).
// 둘을 구분하지 못하면 "늦다"의 원인이 앱인지 연결인지 알 수 없다
const uds = { connectedAt: null, lastEventAt: null, lastEvent: null, events: 0, reconnects: 0 };
function udsStatus() {
  return {
    connected:   !!(userDataWS && userDataWS.readyState === 1),
    connectedAt: uds.connectedAt,
    lastEventAt: uds.lastEventAt,
    lastEvent:   uds.lastEvent,
    events:      uds.events,
    reconnects:  uds.reconnects,
  };
}

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
  // 멱등 보장 — UDS / verifyImmediateFill / resolveOrphans / poll / reconcile 다섯 경로가
  // 같은 주문에 동시에 도달할 수 있다. 진입 주문은 WATCHING일 때 딱 한 번만 처리한다
  // (그 뒤 상태는 reconcile의 retryable 경로가 맡는다)
  if (info.status !== "WATCHING") return;

  // REST(/fapi/v1/order) 응답: avgPrice / UDS(ORDER_TRADE_UPDATE): ap(avg) | L(last fill)
  // price는 LIMIT 주문 가격이라 시장가 체결 시 0 → 최후 폴백
  const fillPrice = parseFloat(
    executionData.avgPrice || executionData.ap || executionData.L || executionData.price || 0
  );
  console.log(`[UDS] 진입 체결됨 orderId=${orderId} fillPrice=${fillPrice} → TP/SL 등록 시작`);
  store.set(orderId, { ...info, status: "FILLED", fillPrice, filledAt: Date.now() });

  // 거래 로그 기록
  tradeLog.append({ event: "FILLED", orderId, side: info.side, qty: info.qty, fillPrice, tp: info.tp, sl: info.sl });

  // 일일 손실 한도 재검증 — 주문 등록 시점엔 OK였지만 체결까지 대기 중 한도 초과 가능
  // 체결 자체는 막을 수 없으므로 critical alert로 사용자에게 즉시 알림 (수동 청산 판단)
  try {
    await checkDailyLoss();
  } catch (e) {
    const msg = `⚠ 체결됨 (orderId=${orderId}) — ${e.message}. 수동 청산 검토 필요`;
    console.error(`[경고] ${msg}`);
    push.pushAlert("critical", msg);
  }

  if (!info.tp || !info.sl) {
    console.error(`[경고] TP/SL 가격 없음 (orderId=${orderId}) — 수동 설정 필요!`);
    store.set(orderId, { ...info, status: "TPSL_MISSING" });
    push.pushAlert("critical", `⚠ 주문 ${orderId} 체결됨 — TP/SL 가격 없음`);
    push.pushUpdate(["position", "balance"]);
    return;
  }

  const tpsl = await safePlaceTPSL(orderId, info);
  if (!tpsl) return; // 중복 호출 스킵된 경우 (다른 호출자가 처리 중)
  const slFailed = tpsl.failed.some(f => f.type === "SL");
  const tpFailed = tpsl.failed.some(f => f.type === "TP");

  if (tpsl.failed.length > 0) {
    const failedTypes = tpsl.failed.map(f => f.type).join(", ");
    console.error(`[경고] TP/SL 부분 실패 orderId=${orderId}: ${failedTypes}`);
    store.set(orderId, { ...info, status: "TPSL_PARTIAL", tpsl });
    // ⚠ 거부 **사유**를 남길 것 — 예전엔 실패 타입만 남겨서, 나중에 로그를 봐도
    //   바이낸스가 왜 거절했는지 알 수 없었다 (콘솔은 이미 사라진 뒤다)
    tradeLog.append({
      event: "TPSL_PARTIAL", orderId, failed: failedTypes,
      errors: tpsl.failed.map(f => `${f.type}: ${f.error}`),
      side: info.side, tp: info.tp, sl: info.sl,
    });

    if (slFailed) {
      const msg = `⚠ SL 등록 5회 실패 (orderId=${orderId})`;
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
        await dropPreset(orderId);   // 다른 취소 경로와 같은 처리 (2026-08-23 감사에서 누락 발견)
        store.delete(orderId);
        push.pushUpdate(["position"]);
      }
    } catch (e) {
      console.warn(`[POLL] orderId=${orderId} 조회 실패:`, e.response?.data?.msg || e.message);
    }
  }
}

// 바이낸스 실제 미체결 주문과 store를 주기적으로 검증/교정
// ⚠ **같은 시각에 두 번 돌지 않게 막는다** (2026-08-23). 예전엔 60초 타이머 하나만
//   불렀으므로 겹칠 일이 없었는데, 이제 `watchAccount`도 부른다(포지션이 사라진 순간).
//   reconcile은 보기만 하는 게 아니라 **주문을 취소하고 TP/SL을 새로 건다** —
//   겹치면 같은 주문에 취소를 두 번 날리게 된다
let reconcileRunning = false;
async function reconcileWithBinance() {
  if (reconcileRunning) return;
  reconcileRunning = true;
  try { await runReconcile(); }
  finally { reconcileRunning = false; }
}

async function runReconcile() {
  const relevant = [...store.entries()].filter(
    ([, o]) => o.status === "WATCHING" || o.status === "SCALE_IN" || o.status === "SPLIT_TP"
  );

  // store에 pending 없어도 포지션 추적은 항상 실행
  // 첫 실행 시(prevHas*가 null) early return 금지 — 포지션 상태를 한 번은 초기화해야
  // 이후 LONG/SHORT 종료를 정상 감지할 수 있음
  const hasStoreEntries = store.size > 0;
  const isInitialized   = prevHasLong !== null && prevHasShort !== null;
  if (isInitialized && !relevant.length && !hasStoreEntries && !prevHasLong && !prevHasShort) return;

  try {
    const [{ data: openOrders }, { data: posData }] = await Promise.all([
      binance("GET", "/fapi/v1/openOrders",   { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" }),
    ]);
    const openIds  = new Set(openOrders.map(o => String(o.orderId)));
    const hasLong  = posData.some(p => p.positionSide === "LONG"  && parseFloat(p.positionAmt) > 0);
    const hasShort = posData.some(p => p.positionSide === "SHORT" && parseFloat(p.positionAmt) < 0);
    const hasPos   = hasLong || hasShort;
    const prevHasPos = prevHasLong || prevHasShort;

    // ── 포지션 오픈 → 진입 시각 기록 ──────────────────────────────────────
    if (hasPos && !prevHasPos && currentEntryFilledAt === null) {
      const storeEntry = [...store.entries()].find(([, o]) =>
        o.status === "TPSL_PLACED" || o.status === "TPSL_PARTIAL" || o.status === "FILLED"
      );
      const posUpdateTime = posData.find(p => parseFloat(p.positionAmt) !== 0)?.updateTime;
      currentEntryFilledAt = storeEntry?.[1]?.filledAt
        || (posUpdateTime ? parseInt(posUpdateTime) : Date.now() - 24 * 60 * 60 * 1000);
      console.log(`[RECONCILE] 포지션 진입 감지, filledAt=${currentEntryFilledAt}`);
    }

    // ── 포지션 클로즈 → stats 캐시 무효화 신호 (한쪽만 닫혀도 즉시 갱신) ──
    const longJustClosed  = prevHasLong  === true && !hasLong;
    const shortJustClosed = prevHasShort === true && !hasShort;
    if (longJustClosed || shortJustClosed) {
      const closedSide = longJustClosed && shortJustClosed ? "LONG+SHORT" : longJustClosed ? "LONG" : "SHORT";
      console.log(`[RECONCILE] ${closedSide} 포지션 종료 감지 → stats 갱신 push`);
      statsCache.invalidateCache();
      push.pushUpdate(["stats"]);
      if (!hasPos) currentEntryFilledAt = null; // 양쪽 모두 닫혔을 때만 진입 시각 초기화
    }

    prevHasLong  = hasLong;
    prevHasShort = hasShort;

    // ── 주인 없는 사전 TP/SL 정리 (2026-08-23, ETH 실측으로 발견) ─────────
    //
    // ⚠ **조건부 트리거 주문은 포지션이 0이 돼도 자동 취소되지 않는다.**
    //   분할 TP(LIMIT reduceOnly)는 바이낸스가 알아서 지우지만 트리거는 남는다
    //   (실측: 손절이 발동해 포지션이 0이 된 뒤에도 익절이 status=NEW로 생존).
    //   → 백엔드가 꺼진 사이에 체결·청산까지 일어나면 **사전 익절만 유령으로 남고**,
    //     나중에 같은 사이드에 새 포지션을 열면 **엉뚱한 가격에 발동한다**
    //
    // ⚠ **우리가 만든 id만 건드린다.** 포지션 없는 사이드의 알고 주문을 싹 지우면
    //   사용자가 바이낸스에서 직접 걸어 둔 예약 주문까지 날아간다
    // ⚠ **미체결 진입 주문이 살아 있으면 손대지 않는다** — 주인이 있는 정상 상태다
    for (const [orderId, info] of [...store.entries()]) {
      if (!info.presetTpsl) continue;
      if (openIds.has(String(orderId))) continue;             // 진입 주문이 아직 살아 있다
      const posSide = closeToPosition(info.closeSide);
      if (posSide === "LONG" ? hasLong : hasShort) continue;   // 포지션이 있으면 유효한 TP/SL이다
      console.warn("[RECONCILE] 주인 없는 사전 TP/SL → 취소 orderId=" + orderId);
      await cancelPresetTPSL(info.presetTpsl)
        .catch(e => console.warn("[RECONCILE] 사전 TPSL 취소 실패:", e.message));
      store.set(orderId, { ...info, presetTpsl: null });
      push.pushUpdate(["tpsl"]);
    }

    // ── TPSL_PARTIAL / FILLED(TP/SL 미등록) → 포지션 있으면 재시도 ──────────
    const retryable = [...store.entries()].filter(
      ([, o]) => (o.status === "TPSL_PARTIAL" || o.status === "FILLED") && o.tp && o.sl
    );
    if (retryable.length > 0) {
      if (!hasPos) {
        // 포지션이 없으면 해당 항목은 더 이상 유효하지 않음 → 제거
        for (const [orderId] of retryable) store.delete(orderId);
      } else {
        for (const [orderId, info] of retryable) {
          // 헤지 모드: 해당 포지션 방향의 TP/SL만 확인
          const orderPosSide = closeToPosition(info.closeSide);
          // TP·SL **둘 다** 있어야 완료다 — 한쪽만 보고 넘기면 빠진 쪽이 영영 재시도되지 않는다
          const { hasTP, hasSL } = await checkExistingTPSL(orderPosSide);
          if (hasTP && hasSL) {
            // TP/SL이 이미 등록돼 있으면 PLACED로 전환
            store.set(orderId, { ...info, status: "TPSL_PLACED" });
            console.log(`[RECONCILE] TP/SL 이미 존재 → TPSL_PLACED 전환 orderId=${orderId}`);
          } else {
            console.log(`[RECONCILE] TPSL 재시도 orderId=${orderId} (status=${info.status}, TP=${hasTP} SL=${hasSL})`);
            const tpsl = await safePlaceTPSL(orderId, info);
            if (!tpsl) continue; // 다른 호출자가 진행 중 → 다음 reconcile 사이클에 재확인
            if (tpsl.failed.length === 0) {
              store.set(orderId, { ...info, status: "TPSL_PLACED", tpsl });
              console.log(`[RECONCILE] TPSL 재등록 완료 orderId=${orderId}`);
              push.pushUpdate(["tpsl"]);
            } else {
              const failed = tpsl.failed.map(f => f.type).join(", ");
              console.error(`[RECONCILE] TPSL 재시도도 실패 (${failed}) orderId=${orderId}`,
                tpsl.failed.map(f => `${f.type}: ${f.error}`).join(" / "));
              store.set(orderId, { ...info, status: "TPSL_PARTIAL", tpsl });
              tradeLog.append({
                event: "TPSL_RETRY_FAILED", orderId, failed,
                errors: tpsl.failed.map(f => `${f.type}: ${f.error}`),
              });
              if (tpsl.failed.some(f => f.type === "SL")) {
                push.pushAlert("critical", `⚠ SL 재등록 실패 (orderId=${orderId})`);
              }
            }
          }
        }
      }
    }

    // ── 안전망: 포지션이 있는데 SL이 없으면 알린다 ────────────────────────────
    // recoveryService의 3단계 안전망은 **서버 시작 때만** 돌아서, 켜 둔 채로 생긴
    // 무방비 포지션은 아무도 알려주지 않았다 (실제로 1.6시간 방치된 적이 있다).
    // 여기선 등록을 대신 해주지 않는다 — store에 tp/sl이 없으면 가격을 지어내는 셈이라
    // 위 retryable 경로가 못 고친 건 사람이 판단해야 한다. 알리기만 한다.
    for (const side of ["LONG", "SHORT"]) {
      const open = side === "LONG" ? hasLong : hasShort;
      if (!open) { resolveNaked(side); continue; }
      const first = await checkExistingTPSL(side);
      if (first.hasSL) { resolveNaked(side); continue; }
      // 위 retryable이 이번 사이클에 고칠 예정이면 중복 경보를 내지 않는다
      const willRetry = retryable.some(([, o]) => closeToPosition(o.closeSide) === side);
      if (willRetry || nakedWarned.has(side)) continue;

      // ── 재확인 (NAKED_RECHECK_MS 주석 참고) ────────────────────────────
      //   5초 뒤 **포지션과 SL을 같이** 다시 본다. 포지션까지 보는 이유는 그새 청산될
      //   수 있어서다 — 닫힌 포지션에 "SL이 없다"고 알리면 그것도 오경보다
      await sleep(NAKED_RECHECK_MS);
      const [second, posRes] = await Promise.all([
        checkExistingTPSL(side),
        binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" }).catch(() => null),
      ]);
      if (second.hasSL) { resolveNaked(side); continue; }
      if (posRes) {
        const amt = parseFloat(posRes.data.find(p => p.positionSide === side)?.positionAmt ?? 0);
        if (amt === 0) { resolveNaked(side); continue; }   // 그새 닫혔다
      }
      // ⚠ **"없다"와 "못 물어봤다"를 구분한다** — 조회가 실패했으면 침묵하고 다음
      //   사이클(60초)에 다시 본다. 통신이 한 번 튄 것을 SL 사고로 알리면 안 된다
      //   (binanceClient.checkExistingTPSL의 `ok` 주석)
      if (!second.ok) {
        console.warn(`[안전망] ${side} SL 확인 실패 → 경보 보류 (다음 사이클에 재확인)`);
        continue;
      }

      nakedWarned.add(side);
      const msg = nakedMsg(side);
      console.error(`[안전망] ${msg}`);
      tradeLog.append({ event: "NAKED_POSITION", side });
      push.pushAlert("critical", msg);
    }

    if (!relevant.length) return;

    // ── 포지션이 사라진 사이드의 SCALE_IN 주문 취소 ────────────────────────
    //
    // ⚠ **사이드별로 판정한다** (2026-08-23). 예전엔 `if (!hasPos)` — 롱·숏이 **둘 다**
    //   비었을 때만 돌아서, **숏을 하나라도 들고 있으면 롱 쪽 뒷정리를 통째로
    //   건너뛰었다.** 롱을 청산해도 롱 추가 진입 주문이 남고, 나중에 그 가격에 닿으면
    //   **손절 없는 새 포지션이 혼자 열린다** (기타/주의사항.txt의 "최악" 항목).
    //   헷지모드로 바꿀 때 이 줄만 원웨이 시절 그대로 남아 있었다
    //
    // ⚠ 사이드는 **거래소가 정한다** — 살아 있는 주문의 `positionSide`를 먼저 본다
    //   ("주문의 정체는 바이낸스가 정한다" 절). openOrders에 없으면 store의 `side`로
    //   떨어지고, 그것도 없으면 **옛 동작**(양쪽 다 비었을 때만)으로 남긴다 —
    //   근거가 없을 때는 취소하지 않는 쪽이 안전하다
    const liveById = new Map(openOrders.map(o => [String(o.orderId), o]));
    const scaleIns = [];
    for (const [orderId, o] of relevant) {
      if (o.status !== "SCALE_IN") continue;
      const posSide = liveById.get(String(orderId))?.positionSide
        || (o.side ? sideToPosition(o.side) : null);
      const orphan = posSide ? (posSide === "LONG" ? !hasLong : !hasShort) : !hasPos;
      if (orphan) scaleIns.push([orderId, posSide || "?"]);
    }
    for (const [orderId, posSide] of scaleIns) {
      try {
        await cancelOrder({ orderId });
      } catch (e) {
        console.warn(`[RECONCILE] SCALE_IN 취소 실패 orderId=${orderId}:`, e.response?.data?.msg);
      }
      store.delete(orderId);
      console.log(`[RECONCILE] ${posSide} 포지션 없음 → SCALE_IN 주문 취소 orderId=${orderId}`);
    }
    if (scaleIns.length) push.pushUpdate(["position"]);

    const toCheck = relevant.filter(([orderId]) => !openIds.has(String(orderId)));
    if (toCheck.length > 0) {
      const results = await Promise.allSettled(
        toCheck.map(([orderId]) =>
          binance("GET", "/fapi/v1/order", { symbol: "BTCUSDT", orderId }).then(r => r.data)
        )
      );
      for (let i = 0; i < toCheck.length; i++) {
        const [orderId, info] = toCheck[i];
        const result = results[i];
        if (result.status === "rejected") {
          console.warn(`[RECONCILE] orderId=${orderId} 조회 실패:`, result.reason?.response?.data?.msg || result.reason?.message);
          continue;
        }
        const data = result.value;
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
          await dropPreset(orderId);
          store.delete(orderId);
          push.pushUpdate(["position"]);
        } else {
          // NEW / PARTIALLY_FILLED 등 아직 살아있는 상태 — openOrders 응답 지연일 뿐
          console.log(`[RECONCILE] 주문 ${orderId} 상태: ${data.status} → 유지 (openOrders 응답 지연)`);
        }
      }
    }
  } catch (e) {
    console.warn("[RECONCILE] openOrders 조회 실패:", e.response?.data?.msg || e.message);
  }
}

// ── 계정 변화 감시 (2026-08-23) ─────────────────────────────────────────────
//
// ⚠ **UDS만 믿으면 안 된다.** 이 환경에서 실측한 결과, 계정 스트림은
//   `wss://fstream.binance.com/ws/<listenKey>`로 **연결은 되지만 이벤트가 한 건도
//   오지 않는다**(4개 경로 전부 확인. 시세는 `/market/ws/...`로 정상 수신).
//   그런데 `startPolling`은 WS가 **닫힐 때만** 켜지므로, "연결됐는데 조용한" 상태에서는
//   폴백이 영영 안 돈다 → 밖에서 낸 매매가 프론트 30초 폴링까지 화면에 안 뜬다
//   (사용자 신고: "바이낸스에서 진입하면 늦게 뜬다").
//
// → 그래서 **UDS와 무관하게 항상 도는** 감시를 둔다. 포지션·미체결·알고 주문의
//   지문(signature)을 만들어 **달라졌을 때만** 푸시한다.
//   가중치는 폴당 약 11(=5+1+5), 3초 간격이면 분당 220 — 한도(2400)의 10% 이하다
const ACCOUNT_WATCH_MS = 3000;
let accountWatchTimer  = null;
let lastAccountSig     = null;
let lastSides          = null;   // { long, short } — 직전 관측. 포지션 사라짐 감지용
const acct = { polls: 0, changes: 0, lastChangeAt: null };

function accountSignature(positions, orders, algos) {
  const p = positions.filter(x => parseFloat(x.positionAmt) !== 0)
    .map(x => x.positionSide + ":" + x.positionAmt + ":" + x.entryPrice).sort().join("|");
  const o = orders
    .map(x => x.orderId + ":" + x.type + ":" + x.price + ":" + x.stopPrice + ":" + x.origQty + ":" + x.executedQty + ":" + x.status)
    .sort().join("|");
  const a = algos
    .map(x => x.algoId + ":" + x.orderType + ":" + x.triggerPrice + ":" + x.quantity + ":" + x.algoStatus)
    .sort().join("|");
  return p + " # " + o + " # " + a;
}

async function watchAccount() {
  acct.polls++;
  try {
    const [posR, ordR, algoR] = await Promise.allSettled([
      binance("GET", "/fapi/v2/positionRisk",   { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/openOrders",     { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" }),
    ]);
    // ⚠ 하나라도 실패하면 **비교하지 않는다** — 빈 값을 "사라졌다"로 오해하면
    //   통신이 튈 때마다 가짜 변화가 잡혀 화면이 계속 갱신된다
    if (posR.status !== "fulfilled" || ordR.status !== "fulfilled" || algoR.status !== "fulfilled") return;
    const algoRaw = algoR.value.data;
    const algos = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);
    const sig = accountSignature(posR.value.data, ordR.value.data, algos);
    const hasLong  = posR.value.data.some(p => p.positionSide === "LONG"  && parseFloat(p.positionAmt) > 0);
    const hasShort = posR.value.data.some(p => p.positionSide === "SHORT" && parseFloat(p.positionAmt) < 0);

    if (lastAccountSig === null) { lastAccountSig = sig; lastSides = { long: hasLong, short: hasShort }; return; }  // 첫 관측은 기준선만
    if (sig === lastAccountSig) return;
    lastAccountSig = sig;
    acct.changes++; acct.lastChangeAt = Date.now();
    console.log("[ACCOUNT] 변화 감지 → 화면 갱신 + 체결 확인");
    push.pushUpdate(["position", "balance", "tpsl"]);
    // 우리 주문이 체결됐을 수도 있다 — TP/SL 등록 경로를 바로 태운다
    // (UDS가 죽어 있으면 이게 아니면 reconcile 60초까지 기다린다)
    pollForFills().catch(e => console.warn("[ACCOUNT] pollForFills 실패:", e.message));

    // ── 포지션이 사라졌으면 **즉시** 뒷정리 (2026-08-23) ────────────────────
    //
    // 남은 추가 진입 주문을 치우는 건 reconcile인데 타이머가 60초라 그동안 살아 있었다.
    // 그 사이 가격이 그 자리에 닿으면 **손절 없는 새 포지션이 혼자 열린다**
    // (기타/주의사항.txt의 "최악" 항목).
    //
    // 이 감시는 3초마다 돌면서 **보기만** 하므로, 여기서 사라짐을 발견해 정리를 부르면
    // 60초 → 약 3초가 된다. **평소에는 부르지 않는다** — 포지션이 사라지는 건 하루
    // 몇 번뿐이라 60초 타이머보다 오히려 덜 돈다 (겹칠 위험이 늘지 않는 이유)
    //
    // ⚠ 60초 타이머는 **그대로 둔다.** 이건 빠르게 하는 장치지 대체재가 아니다 —
    //   조회가 실패해 lastSides를 못 갱신한 사이에 닫히면 이 경로가 놓친다
    if (lastSides && ((lastSides.long && !hasLong) || (lastSides.short && !hasShort))) {
      const gone = [lastSides.long && !hasLong && "LONG", lastSides.short && !hasShort && "SHORT"].filter(Boolean).join("+");
      console.log(`[ACCOUNT] ${gone} 포지션 사라짐 → 뒷정리 즉시 실행`);
      reconcileWithBinance().catch(e => console.warn("[ACCOUNT] reconcile 실패:", e.message));
    }
    lastSides = { long: hasLong, short: hasShort };
  } catch (e) {
    console.warn("[ACCOUNT] 감시 실패:", e.response?.data?.msg || e.message);
  }
}

function accountStatus() { return { ...acct, intervalMs: ACCOUNT_WATCH_MS }; }

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
  // userDataWS = new WebSocket(`wss://demo-fstream.binance.com/ws/${listenKey}`);

  userDataWS.on("open", () => {
    stopPolling();
    reconnectDelay = 5000;
    uds.connectedAt = Date.now();
    console.log("[UDS] User Data Stream 연결됨");
    // ⚠ **연결된 순간 화면을 한 번 갱신시킨다** (2026-08-23).
    //   UDS가 끊겨 있던 동안의 체결은 **아무도 안 잡는다** — `pollForFills`는 store에
    //   있는 주문만 보므로 **밖에서 낸 주문은 백엔드 폴링으로도 안 걸린다.**
    //   그 사이 바이낸스에서 직접 매매하면 프론트 30초 폴링까지 화면이 옛 상태다
    //   (서버를 재시작할 때마다 그 창이 생긴다 — 실제로 "늦게 뜬다"는 보고가 있었다)
    push.pushUpdate(["position", "balance", "tpsl"]);
  });

  userDataWS.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw);
      uds.events++;
      uds.lastEventAt = Date.now();
      uds.lastEvent   = msg.e;
      if (msg.e !== "ORDER_TRADE_UPDATE") return;
      const o = msg.o;
      // ⚠ **store에 없는 주문(= 바이낸스 앱·웹에서 낸 것)도 화면 갱신은 시킨다**
      //   (2026-08-23). 예전엔 여기서 그냥 return이라, 밖에서 낸 주문이 체결·취소돼도
      //   화면은 다음 폴링(30초)까지 옛 상태였다. 이제 정체 판정이 store와 무관하므로
      //   (`utils/orderKind.js`) 다시 조회하기만 하면 맞게 그려진다.
      //   store 항목이 필요한 뒷처리(TP/SL 등록 등)는 아래 분기가 그대로 맡는다
      if (!store.has(o.i)) {
        if (o.X === "FILLED" || o.X === "CANCELED" || o.X === "EXPIRED") {
          console.log(`[UDS] 외부 주문 ${o.i} ${o.X} → 화면 갱신`);
          push.pushUpdate(["position", "balance", "tpsl"]);
        }
        return;
      }

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
        await dropPreset(o.i);
        store.delete(o.i);
        push.pushUpdate(["position"]);
      }
    } catch (e) {
      console.error("[UDS] 메시지 처리 오류:", e.message);
    }
  });

  userDataWS.on("close", () => {
    uds.reconnects++;
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

  // ⚠ UDS 성공 여부와 **무관하게** 켠다 — "연결됐는데 조용한" 경우가 실제로 있다
  if (accountWatchTimer) clearInterval(accountWatchTimer);
  accountWatchTimer = setInterval(watchAccount, ACCOUNT_WATCH_MS);
  watchAccount();
}

function stop() {
  if (reconnectTimer)  { clearTimeout(reconnectTimer);   reconnectTimer  = null; }
  if (listenKeyTimer)  { clearInterval(listenKeyTimer);  listenKeyTimer  = null; }
  if (reconcileTimer)  { clearInterval(reconcileTimer);  reconcileTimer  = null; }
  if (userDataWS)      { try { userDataWS.terminate(); } catch {} userDataWS = null; }
  stopPolling();
}

module.exports = { startUserDataStream, stop, onFilled, verifyImmediateFill, resolveOrphans, udsStatus, accountStatus };
