const WebSocket    = require("ws");
const { binance, cancelOrder, placeTPSL, checkExistingTPSL, cancelPresetTPSL } = require("./binanceClient");
const { isStopOrder, isFullClose, coversPosition, orderQtyOf, triggerPriceOf,
  isLiveLimit, isEntryDir, isCloseDir, TPSL_TYPES } = require("../utils/orderKind");
const store          = require("../store/pendingOrders");
const push           = require("./pushService");
const { log, errOf } = require("../store/logStore");
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
// 사이드 -> { msg, at } — **띄운 문구를 그대로 들고 있는다.**
// 배너를 거둘 때 문구를 다시 만들면 안 된다: 상황(없음 / 일부만)에 따라 문구가 달라지는데
// 거둘 때는 상황이 이미 바뀐 뒤라 다른 문구가 나온다 -> 프론트가 목록에서 못 찾아 배너가 안 닫힌다
// (pushService.pushAlertClear 주석: "문구가 키다")
const nakedWarned = new Map();

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
//
// ⚠ **"없다"와 "일부만 덮는다"를 나눈다** (2026-08-24). 예전엔 어떤 경우든 `SL이 없습니다`
//   였는데, 부분 손절(수량 지정)이 생기면 **틀린 말이 된다** — 실측(2026-08-24 경보 테스트):
//   포지션 0.173 중 0.172(99.4%)에 손절이 걸려 있는데도 `SL이 없습니다`라고 떴다.
//   수량까지 적어야 "얼마가 비어 있는지"가 화면에서 바로 읽힌다
const fmtQty = q => Number(q).toFixed(3);
const nakedMsg = (side, partialQty = 0, posAmt = null) =>
  partialQty > 0 && posAmt
    ? `⚠ ${side} 손절이 포지션의 일부만 덮습니다 (${fmtQty(partialQty)} / ${fmtQty(posAmt)})`
    : `⚠ ${side} 포지션에 SL이 없습니다`;

// 경보 해소 — 래치를 풀고, 이미 띄운 배너가 있으면 거둔다
// (안 거두면 20ms 만에 해결된 경보가 몇 시간씩 화면에 남는다 — 그게 08-22 신고였다)
//
// ⚠ **해제될 때 화면에는 아무것도 띄우지 않는다** (2026-08-24 사용자 확정).
//   한때 금색 토스트로 `✅ 손절 복구됨`을 알렸다. 그걸 넣은 이유는 "배너가 소리 없이
//   사라져서 해결된 건지 오작동이었는지 알 수 없다"였는데, 같은 날 배너를 **15초 유예
//   뒤에만** 띄우도록 바꾸면서 그 상황 자체가 없어졌다 — 이제 배너는 진짜 문제일 때만
//   뜨고, 사라졌다는 건 해결됐다는 뜻이다. 알림을 둘로 두면 그 뜻이 흐려진다.
//   되살리려면 `pushService.pushNotice`와 프론트 `useRealtimeData`의 `notice` 처리가
//   함께 필요하다 (같이 지웠다)
//
// ⚠ 대신 **로그에는 남긴다**(`NAKED_RESOLVED`) — 화면에 안 띄우는 것과 기록을 안 남기는 것은
//   다르다. "그때 몇 초나 없었나"는 나중에 돌아볼 값이다
//
// ⚠ **없어진 원인은 적지 않는다** (2026-08-24 사용자 확정). 이 환경에서는 계정 스트림이
//   이벤트를 한 건도 안 보내서(health의 `uds.events: 0`) 누가 취소했는지 알 근거가 없다.
//   바이낸스 앱에서 지운 것과 우리 화면에서 지운 것을 구분할 수 없으므로 **관측한 사실만** 적는다
function resolveNaked(side, reason = "sl", detail = {}) {
  const warned = nakedWarned.get(side);
  if (!warned) return;
  nakedWarned.delete(side);
  push.pushAlertClear(warned.msg);

  const seconds = Math.max(0, Math.round((Date.now() - warned.at) / 1000));
  log("NAKED_RESOLVED", { posSide: side, reason, seconds, price: detail.price ?? null });
  console.log(`[안전망] ${side} 경보 해제 (${reason === "closed" ? "포지션 종료" : "손절 복구"}` +
    `${detail.price ? " @" + detail.price : ""}, 없던 시간 ${seconds}초)`);
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
  log("ENTRY_FILLED", { orderId, orderSide: info.side, posSide: sideToPosition(info.side),
    orderType: "LIMIT", qty: info.qty, price: fillPrice, tp: info.tp, sl: info.sl });

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
    log("TPSL_PARTIAL", { level: "error", orderId, orderSide: info.side,
      posSide: sideToPosition(info.side), failed: tpsl.failed.map(f => f.type),
      errors: tpsl.failed.map(f => ({ type: f.type, msg: f.error })), tp: info.tp, sl: info.sl });

    if (slFailed) {
      const msg = `⚠ SL 등록 5회 실패 (orderId=${orderId})`;
      console.error(`[긴급] ${msg}`);
      push.pushAlert("critical", msg);
    }
    if (tpFailed) {
      // notice = 금색 토스트 — SL은 걸렸고 익절만 빠진 상태다 (pushService 참고).
      // 바로 위 SL 실패는 critical이라 빨간 배너로 남는다
      push.pushAlert("notice", `TP 등록 실패 (orderId=${orderId}) — 수동 설정 필요`);
    }
  } else {
    console.log(`[UDS] TP/SL 등록 완료 orderId=${orderId}`);
    store.set(orderId, { ...info, status: "TPSL_PLACED", tpsl });
    log("TPSL_PLACED", { orderId, posSide: sideToPosition(info.side), tp: info.tp, sl: info.sl });
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
      // ⚠ **서버 시작 직후와 진짜 새 진입을 구분해서 찍는다** (2026-08-23).
      //   prevHasLong/Short는 시작 시 null이라 이 분기는 **켤 때마다 한 번은 반드시**
      //   지나간다. 예전엔 둘 다 "포지션 진입 감지"로 찍혀서, 매매를 안 했는데도
      //   방금 진입한 것처럼 보였다 (사용자 신고)
      //
      // ⚠ 시각은 참고용이다. store에 filledAt이 없으면 positionRisk의 updateTime으로
      //   떨어지는데, 그건 **펀딩비를 뗄 때도 갱신된다**(한국시간 9/17/1시 정각).
      //   실제로 매매를 안 한 날 "오후 5시 00분 00초"가 찍혀 오해를 샀다.
      //   차트 진입선이 이 값을 쓰지 않는 이유와 같다 (services/entryTime.js 참고)
      const firstObservation = prevHasLong === null && prevHasShort === null;
      console.log(firstObservation
        ? `[RECONCILE] 시작 시점 포지션 확인 (새 진입 아님) — 기준시각 ${new Date(currentEntryFilledAt).toLocaleString("ko-KR")}`
        : `[RECONCILE] 포지션 진입 감지, filledAt=${currentEntryFilledAt}`);
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

    // ── 주인 없는 부분 청산 트리거 정리 (2026-08-24, ETHUSDT 실측으로 확인) ──
    //
    // ⚠ **수량을 지정한 트리거는 포지션이 0이 돼도 바이낸스가 지우지 않는다.**
    //   실측(2026-08-24, ETH 0.01 롱에 둘을 걸고 시장가 청산):
    //     · `closePosition:true` STOP_MARKET → 청산 **2초 뒤 사라짐** (거래소가 지운다)
    //     · `quantity` 지정 STOP_MARKET      → **18초 뒤에도 status=NEW**
    //   ※ CLAUDE.md의 "조건부 트리거 주문은 포지션이 0이 돼도 자동 취소되지 않는다"는
    //     기술은 **너무 넓었다** — 그 실측(2026-08-23)은 사전 등록분을 본 것이고,
    //     그건 수량 지정 방식이다. `closePosition`은 거래소가 알아서 치운다
    //
    // 그래서 **분할 SL**은 포지션이 손절·익절로 닫히면 거래소에 남는다.
    // 그대로 두면 나중에 같은 사이드에 새 포지션이 생겼을 때 **옛 가격에 발동한다**.
    // (`청산` 버튼으로 닫을 때는 close.js가 같이 취소하므로 이 경로가 필요 없다 —
    //  문제는 거래소가 알아서 닫는 경우다: 손절 발동·익절 발동·강제청산)
    //
    // ⚠ 판정은 **주문 자체 + 그 사이드 상태**로 한다 (store 기록 없음):
    //     청산 방향 · 수량 지정 · 그 사이드 포지션 없음 · 그 사이드 미체결 진입 없음
    //   마지막 조건이 **사전 등록분(preplaceTPSL)을 지켜준다** — 그건 진입 주문에 딸린
    //   것이라 진입이 살아 있는 동안은 걸리지 않는다. 진입이 사라지면 위의 preset 정리가
    //   id로 먼저 치운다
    //
    // ⚠ 헷지모드라 청산 방향(SELL/LONG·BUY/SHORT)은 **새 포지션을 열 수 없다.**
    //   포지션도 진입 주문도 없으면 그 주문은 아무 일도 할 수 없는 상태다 —
    //   그래서 우리가 만든 것이 아니어도(바이낸스 앱에서 건 것이어도) 치우는 게 맞다
    //
    // ⚠ 알고 주문 조회는 **치울 사이드가 있을 때만** 한다 — 평소엔 호출이 늘지 않는다
    const emptySides = ["LONG", "SHORT"].filter(sd => !(sd === "LONG" ? hasLong : hasShort));
    if (emptySides.length) {
      // ⚠ **이번 사이클에 어차피 취소될 물타기 주문은 "진입 대기"로 세지 않는다**
      //   (2026-08-24). 아래 SCALE_IN 정리 블록이 이 함수 **뒤쪽**에 있어서, 그걸
      //   진입 대기로 세면 찌꺼기 정리가 **한 사이클(60초) 늦는다.**
      //   그 조합이 하필 위험하다 — 남은 물타기가 체결되면 새 포지션이 생기고,
      //   거기에 옛 분할 SL이 **엉뚱한 가격으로 붙는다**
      //   (블록 순서를 바꾸는 대신 판정만 고쳤다 — reconcile의 실행 순서를 건드리는
      //    쪽보다 범위가 좁다)
      // ※ 밖에서 낸 물타기는 store에 없어 여전히 "진입 대기"로 센다 — 그건 우리가
      //   치우지 못하는 주문이라 근거 없이 손대지 않는 쪽이 맞다 (기타/주의사항.txt 1번)
      const entrySides = new Set(openOrders
        .filter(o => isLiveLimit(o) && isEntryDir(o))
        .filter(o => store.get(String(o.orderId))?.status !== "SCALE_IN")
        .map(o => o.positionSide));
      const targets = emptySides.filter(sd => !entrySides.has(sd));
      if (targets.length) {
        const algoRaw = await binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" })
          .then(r => r.data)
          .catch(e => { console.warn("[RECONCILE] 알고주문 조회 실패 → 찌꺼기 정리 스킵:",
            e.response?.data?.msg || e.message); return null; });
        if (algoRaw) {
          const algos = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);
          const stale = [
            ...openOrders.filter(o => TPSL_TYPES.includes(o.type)).map(o => ({ o, id: o.orderId, isAlgo: false })),
            ...algos.filter(o => TPSL_TYPES.includes(o.orderType)).map(o => ({ o, id: o.algoId, isAlgo: true })),
          ].filter(({ o }) => o.positionSide && targets.includes(o.positionSide)
            && isCloseDir(o) && !isFullClose(o));
          for (const { o, id, isAlgo } of stale) {
            console.warn(`[RECONCILE] 주인 없는 부분 청산 트리거 → 취소 ${o.positionSide} ` +
              `${orderQtyOf(o)}@${triggerPriceOf(o)} id=${id}`);
            await cancelOrder({ orderId: id, algoId: id, isAlgo })
              .catch(e => console.warn("[RECONCILE] 취소 실패:", e.response?.data?.msg || e.message));
          }
          if (stale.length) push.pushUpdate(["tpsl"]);
        }
      }
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
              log("TPSL_RETRY_FAILED", { level: "error", orderId,
                failed: tpsl.failed.map(f => f.type),
                errors: tpsl.failed.map(f => ({ type: f.type, msg: f.error })) });
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
      if (!open) { resolveNaked(side, "closed"); continue; }
      const first = await checkExistingTPSL(side);
      if (first.hasSL) { resolveNaked(side, "sl", { price: first.slPrice }); continue; }
      // 위 retryable이 이번 사이클에 고칠 예정이면 중복 경보를 내지 않는다
      const willRetry = retryable.some(([, o]) => closeToPosition(o.closeSide) === side);
      // ⚠ **3초 감시가 이 사이드를 이미 세고 있으면 양보한다** (2026-08-24).
      //   안 그러면 유예(15초)를 두는 의미가 없다 — 이 60초 점검이 도중에 끼어들어
      //   자기 규칙(5초 재확인)대로 먼저 배너를 띄운다.
      //   감시가 죽어 있으면 `nakedStrikes`가 안 늘어나므로 여기가 예전처럼 맡는다
      if (willRetry || nakedWarned.has(side) || nakedStrikes.has(side)) continue;

      // ── 재확인 (NAKED_RECHECK_MS 주석 참고) ────────────────────────────
      //   5초 뒤 **포지션과 SL을 같이** 다시 본다. 포지션까지 보는 이유는 그새 청산될
      //   수 있어서다 — 닫힌 포지션에 "SL이 없다"고 알리면 그것도 오경보다
      await sleep(NAKED_RECHECK_MS);
      const [second, posRes] = await Promise.all([
        checkExistingTPSL(side),
        binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" }).catch(() => null),
      ]);
      if (second.hasSL) { resolveNaked(side, "sl", { price: second.slPrice }); continue; }
      if (posRes) {
        const amt = parseFloat(posRes.data.find(p => p.positionSide === side)?.positionAmt ?? 0);
        if (amt === 0) { resolveNaked(side, "closed"); continue; }   // 그새 닫혔다
      }
      // ⚠ **"없다"와 "못 물어봤다"를 구분한다** — 조회가 실패했으면 침묵하고 다음
      //   사이클(60초)에 다시 본다. 통신이 한 번 튄 것을 SL 사고로 알리면 안 된다
      //   (binanceClient.checkExistingTPSL의 `ok` 주석)
      if (!second.ok) {
        console.warn(`[안전망] ${side} SL 확인 실패 → 경보 보류 (다음 사이클에 재확인)`);
        continue;
      }

      const msg = nakedMsg(side, second.slPartialQty, second.posAmt);
      nakedWarned.set(side, { msg, at: Date.now() });
      console.error(`[안전망] ${msg}`);
      log("NAKED_POSITION", { level: "error", posSide: side, detectedBy: "reconcile",
        slPartialQty: second.slPartialQty ?? 0, posAmt: second.posAmt ?? null });
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

    // ⚠ **sig 비교보다 먼저 부른다.** 변화가 없는 회차에도 봐야 "연속 2회"가 성립하고,
    //   첫 관측(기준선만 잡고 return)에서도 판정은 해야 한다 — 서버를 켰을 때 이미
    //   무방비인 상태가 가장 위험하다
    checkNakedFast(posR.value.data, ordR.value.data, algos);

    if (lastAccountSig === null) { lastAccountSig = sig; lastSides = { long: hasLong, short: hasShort }; return; }  // 첫 관측은 기준선만
    if (sig === lastAccountSig) return;
    lastAccountSig = sig;
    acct.changes++; acct.lastChangeAt = Date.now();
    console.log("[ACCOUNT] 변화 감지 → 화면 갱신 + 체결 확인");

    // ── 상태 스냅샷 (2026-08-25) ──────────────────────────────────────────────
    // ⚠ **사건 기록만으로는 "언제부터 이랬나"를 못 짚는다.** "무엇을 했다"는 줄만
    //   있으면 그 사이의 상태를 되짚을 수 없다 — 특히 밖에서 낸 주문이나 서버가
    //   꺼져 있던 구간은 사건 자체가 안 남는다.
    //   이 감시는 어차피 3초마다 포지션·미체결을 읽고 있으므로, **바뀔 때만** 한 줄
    //   남기면 거의 공짜로 "그 시점의 계좌"가 기록된다
    // ⚠ 원본 응답을 통째로 넣지 말 것 — 한 줄이 수 KB가 되어 읽을 수 없다.
    //   포지션·주문 **요약**만 넣는다 (자족적이되 짧게)
    try {
      const posSummary = posR.value.data
        .filter(p => parseFloat(p.positionAmt) !== 0)
        .map(p => ({ posSide: p.positionSide, qty: Math.abs(parseFloat(p.positionAmt)),
                     entry: parseFloat(p.entryPrice), lev: parseInt(p.leverage) || null,
                     liq: parseFloat(p.liquidationPrice) || null }));
      const ordSummary = ordR.value.data.map(o => ({
        orderId: String(o.orderId), type: o.type, orderSide: o.side,
        posSide: o.positionSide, price: parseFloat(o.price) || null,
        stop: parseFloat(o.stopPrice) || null, qty: parseFloat(o.origQty) || null,
      }));
      const algoSummary = algos.map(o => ({
        orderId: String(o.algoId), type: o.orderType, orderSide: o.side,
        posSide: o.positionSide, stop: parseFloat(o.triggerPrice) || null,
        qty: parseFloat(o.quantity) || null,
      }));
      log("ACCOUNT_STATE", { positions: posSummary, orders: ordSummary, algos: algoSummary });
    } catch { /* 스냅샷 실패가 감시를 멈추면 안 된다 */ }
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
      // 손익을 **바로** 로그에 남긴다 — 안 그러면 10분 주기까지 기다린다.
      // 거래소가 정산할 시간을 조금 준다 (밖에서 낸 청산도 여기서 잡힌다)
      setTimeout(() => {
        require("./incomeLogger").pollIncome().catch(() => {});
      }, 3000);
    }
    lastSides = { long: hasLong, short: hasShort };
  } catch (e) {
    console.warn("[ACCOUNT] 감시 실패:", e.response?.data?.msg || e.message);
  }
}

// ── 무방비 감시를 3초 주기로 끌어올린다 (2026-08-24 사용자 요청) ──────────────
//
// 예전엔 판정이 60초짜리 reconcile 안에만 있어서 **경보가 최대 65초 늦었고, 해제는 더
// 늦었다**(실측: 손절 복구 55초 뒤에야 배너가 사라졌다). `watchAccount`가 이미 3초마다
// 포지션·미체결·조건부 주문 셋을 다 받아오는데 — **그게 판정에 필요한 재료 전부다** —
// 쓰지 않고 있었다. 그래서 **추가 조회 없이** 여기에 얹는다.
//
// ⚠ **60초 reconcile의 판정은 그대로 둔다.** 빠르게 하는 장치지 대체재가 아니다 —
//   watchAccount는 조회가 하나라도 실패하면 그 회차를 통째로 건너뛴다 (포지션 사라짐
//   즉시 뒷정리와 같은 이유)
//
// ⚠ **연속 2회 봐야 울린다.** 한 번 보고 울리면 오경보가 난다: 차트에서 손절선을 끌면
//   `PUT /api/tpsl`이 취소 → 등록 순서로 처리해 그 사이 **69ms** 동안 진짜로 SL이 없다
//   (2026-08-22 실측). 3초 간격 두 번이 그 틈에 다 걸릴 수는 없다.
//   reconcile 쪽의 5초 재확인과 목적이 같다
//
// ⚠ **해제는 재확인 없이 즉시** 한다 — 좋은 소식이라 빨라서 손해 볼 게 없다
// ⚠ **수리 시도와 경보를 나눈다** (2026-08-24 사용자 요청).
//   예전엔 6초에 배너를 띄우고 동시에 수리를 시작해서, 수리가 성공하면 **3초 만에
//   배너가 사라졌다** — 배너는 클릭해야 닫히는 것이라 깜빡임으로 보였고, 보고 있지
//   않으면 무슨 일이 있었는지도 모른다.
//   지금은 **조용히 먼저 고쳐 보고, 그래도 안 되면 그때 알린다.**
//   해결되면 배너도 토스트도 안 뜬다 (`resolveNaked`는 배너가 떴을 때만 토스트를 낸다)
const NAKED_STRIKES       = 2;   // ~6초  — 여기서 조용히 수리를 시도한다
const NAKED_ALARM_STRIKES = 5;   // ~15초 — 그래도 안 덮였으면 배너
// side -> { n, since } — n은 연속으로 "안 덮임"을 본 횟수, since는 **처음 본 시각**.
// ⚠ 경보의 시작 시각으로 `since`를 쓴다 (경보를 띄운 시각이 아니라). 그래야 해제될 때
//   찍는 `없던 시간`이 실제와 맞는다 — 안 그러면 2회 확인에 걸린 3초가 통째로 빠진다
const nakedStrikes = new Map();

// TP/SL을 **지금 거는 중인 사이드** — 체결 직후엔 포지션이 생긴 뒤 SL이 걸리기까지
// 틈이 있고, `placeTPSL`이 실패하면 재시도로 최대 31초까지 벌어진다. 그 사이를
// 무방비로 알리면 매 체결마다 오경보가 뜬다 (reconcile의 `willRetry` 스킵과 같은 목적).
// `placingTpsl`은 주문번호 기준이라 store로 사이드를 되짚는다
function sidesPlacingTpsl() {
  const out = new Set();
  for (const id of placingTpsl) {
    const cs = store.get(String(id))?.closeSide;
    if (cs) out.add(closeToPosition(cs));
  }
  return out;
}

function checkNakedFast(positions, regular, algos) {
  const busy = sidesPlacingTpsl();
  for (const side of ["LONG", "SHORT"]) {
    const amt = Math.abs(parseFloat(
      positions.find(x => x.positionSide === side)?.positionAmt ?? 0));
    if (!(amt > 0)) { nakedStrikes.delete(side); resolveNaked(side, "closed"); continue; }

    const closeSide = side === "LONG" ? "SELL" : "BUY";
    const stops = [
      ...regular.filter(o => o.positionSide === side),
      ...algos.filter(o => o.positionSide === side || (!o.positionSide && o.side === closeSide)),
    ].filter(isStopOrder);

    const covered = coversPosition(stops, amt);
    if (covered === true) {
      nakedStrikes.delete(side);
      const full = stops.find(isFullClose);
      resolveNaked(side, "sl", { price: full ? triggerPriceOf(full) : null });
      continue;
    }
    if (covered === null) { nakedStrikes.delete(side); continue; }   // 판단 불가 → 침묵

    if (busy.has(side)) { nakedStrikes.delete(side); continue; }     // 지금 거는 중이다

    const partialQty = stops.filter(o => !isFullClose(o))
      .reduce((sum, o) => sum + orderQtyOf(o), 0);
    const msg = nakedMsg(side, partialQty, amt);

    // ── 이미 알렸으면 조용히 — **단, 상태가 달라졌으면 문구를 갈아끼운다** ──────
    //
    // ⚠ 래치(중복 방지)가 **문구 갱신까지 막고 있었다** (2026-08-24 실측으로 발견).
    //   실제로 일어난 일:
    //     18:21:57  손절 0.003 / 포지션 0.004 -> "일부만 덮습니다 (0.003 / 0.004)"
    //     18:22:11  그 분할 SL 이 발동해 사라짐. 포지션 0.001 이 **하나도 안 덮인 상태**
    //               그런데 배너는 여전히 "(0.003 / 0.004)" 였다
    //   숫자를 넣은 이유가 "얼마나 비어 있는지 정확히 알리려고"인데, 그 숫자가 낡으면
    //   **"0.003 은 덮여 있구나"로 읽혀 없느니만 못하다.**
    //
    // ⚠ 문구가 **같으면 아무것도 하지 않는다** — 중복 방지는 그대로다.
    //   달라졌을 때만 옛 배너를 거두고 새로 띄운다 (프론트는 문구를 키로 지운다)
    const warned = nakedWarned.get(side);
    if (warned) {
      if (warned.msg === msg) continue;
      push.pushAlertClear(warned.msg);
      nakedWarned.set(side, { msg, at: warned.at });   // 시작 시각은 처음 그대로 둔다
      console.error(`[안전망/즉시] 문구 갱신 -> ${msg}`);
      log("NAKED_CHANGED", { level: "error", posSide: side, detectedBy: "watch",
        slPartialQty: partialQty ?? 0, posAmt: amt ?? null });
      push.pushAlert("critical", msg);
      continue;
    }

    const prev  = nakedStrikes.get(side);
    const since = prev?.since ?? Date.now();
    const n     = (prev?.n ?? 0) + 1;
    let repaired = prev?.repaired ?? false;

    // ① 확인되면 **조용히** 수리부터 시도한다 (알림 없음)
    //    흔한 원인은 체결 후 `placeTPSL` 실패고, 그걸 다시 거는 건 reconcile의
    //    retryable 경로다. 한 무방비 구간에 **한 번만** 부른다 — 3초마다 부르지 않는다
    if (n >= NAKED_STRIKES && !repaired) {
      repaired = true;
      console.log(`[안전망] ${side} 손절이 포지션을 안 덮는다 → 조용히 수리 시도`);
      reconcileWithBinance().catch(e => console.warn("[안전망] reconcile 실패:", e.message));
    }
    nakedStrikes.set(side, { n, since, repaired });

    // ② 수리로 해결되면 이 줄에 도달하지 않는다 (덮이는 순간 위에서 continue).
    //    끝까지 안 되면 그때 알린다
    if (n < NAKED_ALARM_STRIKES) continue;

    nakedWarned.set(side, { msg, at: since });   // 띄운 시각이 아니라 **처음 본 시각**
    console.error(`[안전망/즉시] ${msg}`);
    log("NAKED_POSITION", { level: "error", posSide: side, detectedBy: "watch",
      slPartialQty: partialQty ?? 0, posAmt: amt ?? null });
    push.pushAlert("critical", msg);
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
