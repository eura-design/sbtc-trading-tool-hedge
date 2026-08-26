const axios  = require("axios");
const crypto = require("crypto");
const { closeToPosition } = require("../utils/side");
const { isFullClose, isStopOrder, isTpOrder, coversPosition, orderQtyOf, triggerPriceOf,
  TPSL_TYPES, STOP_TYPES } = require("../utils/orderKind");
const store = require("../store/pendingOrders");
const { log, errOf } = require("../store/logStore");

const BASE = "https://fapi.binance.com";
// const BASE = "https://demo-fapi.binance.com";

let _timeOffset  = 0;   // 로컬 시간 - 바이낸스 서버 시간 (ms)
let _bannedUntil = 0;   // IP 밴 해제 시각 (ms, 0 = 밴 없음)

// ── 요청 가중치 (2026-08-25) ─────────────────────────────────────────────────
// 바이낸스는 응답 헤더에 1분 누적 가중치를 실어 준다. 한도(2400)에 다가가면
// 밴이 나는데, 그전에는 **밴이 난 뒤에야** 알 수 있었다.
// ⚠ 매 요청마다 남기면 로그가 이것으로 뒤덮인다 → **한도의 절반을 넘었을 때만**,
//   그것도 1분에 한 번만 남긴다
const WEIGHT_LIMIT   = 2400;
const WEIGHT_WARN_AT = WEIGHT_LIMIT / 2;
let _lastWeight     = 0;
let _lastWeightLogAt = 0;

function checkBan() {
  if (_bannedUntil > Date.now()) {
    const sec = Math.ceil((_bannedUntil - Date.now()) / 1000);
    throw new Error(`[BANNED] Binance IP 밴 — ${sec}초 후 해제`);
  }
}

function parseBan(e) {
  const msg = e?.response?.data?.msg ?? e?.message ?? "";
  const m = msg.match(/banned until (\d+)/);
  if (m) {
    _bannedUntil = Number(m[1]);
    // ⚠ 밴은 **콘솔 문장이 아니라 이벤트로** 남긴다 (2026-08-25) — 문장이면 몇 번
    //   당했는지 셀 수가 없다. 밴은 원인(요청 가중치)과 결과(그 사이 주문이 전부 실패)가
    //   둘 다 중요해서 나중에 반드시 되짚게 된다
    log("API_BANNED", { level: "error", until: _bannedUntil,
      seconds: Math.ceil((_bannedUntil - Date.now()) / 1000), weight: _lastWeight });
  }
}

async function syncServerTime() {
  try {
    const { data } = await axios.get(`${BASE}/fapi/v1/time`);
    const prev = _timeOffset;
    _timeOffset = data.serverTime - Date.now();
    // ⚠ 시계 오차는 **트리거가 안 맞을 때 첫 용의자다.** 오차가 recvWindow(5초)에
    //   가까워지면 요청이 통째로 거절되기 시작한다 — 그 전에 기록이 있어야 원인을 짚는다
    log("CLOCK_SYNC", { offsetMs: _timeOffset, prevOffsetMs: prev,
      level: Math.abs(_timeOffset) > 2000 ? "warn" : "info" });
  } catch (e) {
    log("CLOCK_SYNC_FAILED", { level: "warn", err: errOf(e) });
  }
}

function serverNow() {
  return Date.now() + _timeOffset;
}

function sign(params) {
  const query = new URLSearchParams(params).toString();
  return crypto
    .createHmac("sha256", process.env.BINANCE_API_SECRET)
    .update(query)
    .digest("hex");
}

async function binance(method, path, params = {}) {
  checkBan();
  const p = { ...params };   // 원본 객체 변조 방지 (H4)
  p.timestamp  = serverNow();
  p.recvWindow = 5000;
  p.signature  = sign(p);
  try {
    const res = await axios({
      method,
      url: `${BASE}${path}`,
      ...(method === "GET" ? { params: p } : { data: new URLSearchParams(p).toString() }),
      headers: {
        "X-MBX-APIKEY": process.env.BINANCE_API_KEY,
        ...(method !== "GET" && { "Content-Type": "application/x-www-form-urlencoded" }),
      },
    });
    noteWeight(res);
    return res;
  } catch (e) {
    parseBan(e);
    throw e;
  }
}

/** 응답 헤더의 1분 누적 가중치를 읽어 둔다 — 한도에 다가갈 때만 기록 */
function noteWeight(res) {
  try {
    const w = Number(res?.headers?.["x-mbx-used-weight-1m"]);
    if (!Number.isFinite(w)) return;
    _lastWeight = w;
    const now = Date.now();
    if (w >= WEIGHT_WARN_AT && now - _lastWeightLogAt > 60_000) {
      _lastWeightLogAt = now;
      log("API_WEIGHT_HIGH", { level: "warn", weight: w, limit: WEIGHT_LIMIT,
        pct: Math.round(w / WEIGHT_LIMIT * 100) });
    }
  } catch {}
}

function roundPrice(p) {
  return (Math.round(parseFloat(p) * 10) / 10).toFixed(1);
}

// 일반 주문/알고 주문 취소 공통 헬퍼
// 사용처: routes/order, routes/tpsl, routes/close, services/orderWatcher 등
function cancelOrder({ orderId, algoId, isAlgo }) {
  return isAlgo
    ? binance("DELETE", "/fapi/v1/algoOrder", { symbol: "BTCUSDT", algoId: algoId ?? orderId })
    : binance("DELETE", "/fapi/v1/order",     { symbol: "BTCUSDT", orderId });
}

// TP/SL 등록 전 해당 방향의 기존 알고 TP/SL을 모두 취소
// 이전 포지션의 찌꺼기 주문이 새 TP/SL 등록을 막는 -4130 에러 방지
async function cancelExistingAlgoTPSL(positionSide) {
  try {
    const { data: algoRaw } = await binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" });
    const algo = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);
    // ⚠ **지정가형(`STOP`/`TAKE_PROFIT`)도 대상이다** (2026-08-23 감사).
    //   `GET /api/tpsl`은 지정가형도 TP/SL로 읽는데 여기서만 빼면, 바이낸스 웹에서
    //   지정가형으로 걸어 둔 TP/SL 위에 우리가 새 TP/SL을 얹어 **둘이 공존**하게 된다.
    //   화면엔 하나만 보이고 나머지는 유령이 된다
    // ⚠ **부분 청산 트리거(수량 지정)는 남긴다** (2026-08-24).
    //   이 함수는 `placeTPSL`이 TP/SL을 **갈아끼우기 전에** 부르는 청소기다. 예전엔 그 사이드의
    //   조건부 주문을 **전부** 지웠는데, 그때는 후보가 우리가 건 전량 TP/SL과 사전 등록분뿐이라
    //   맞는 동작이었다. 부분 손절(예: "평단까지 내려오면 절반")이 생기면 **그것까지 빨려 들어간다.**
    //   진입이 체결될 때마다 도는 경로라 **추가 진입 한 번이면 사라진다** — 조용히, 흔적 없이.
    //
    // ⚠ 그렇다고 `closePosition:false`를 통째로 빼면 안 된다. **사전 등록분(preset)도 수량
    //   지정이라 같은 그물에 걸린다** — 그건 여기서 지워지는 것이 의도된 동작이다
    //   (`placeTPSL` 주석: "이 호출이 사전 등록분도 함께 지운다 — 그래서 체결 경로에서는
    //   preset을 따로 지울 필요가 없다"). 안 지우면 트리거만 거래소에 남아 유령이 된다.
    //   → 그래서 **전량 청산분 + store가 아는 사전 등록분 id**만 지운다.
    //     store에 없는 수량 지정 주문(= 부분 손절, 우리 것이든 바이낸스 앱에서 건 것이든)은 남긴다
    //
    // ※ -4130(같은 사이드에 전량 STOP_MARKET 둘) 걱정은 그대로 해결된다 — 전량분은 여전히
    //   전부 지우기 때문이다. 수량 지정분은 전량분과 공존 가능하다 (2026-08-24 실계좌 실측)
    const presetIds = new Set();
    for (const [, info] of store.entries()) {
      for (const k of ["tp", "sl"]) {
        const id = info?.presetTpsl?.[k]?.orderId;
        if (id) presetIds.add(String(id));
      }
    }
    const toCancel = algo.filter(o =>
      ["TAKE_PROFIT_MARKET", "STOP_MARKET", "TAKE_PROFIT", "STOP"].includes(o.orderType) &&
      o.positionSide === positionSide &&
      (isFullClose(o) || presetIds.has(String(o.algoId)))
    );
    const kept = algo.filter(o =>
      ["TAKE_PROFIT_MARKET", "STOP_MARKET", "TAKE_PROFIT", "STOP"].includes(o.orderType) &&
      o.positionSide === positionSide && !toCancel.includes(o)
    );
    if (kept.length > 0) {
      log("PARTIAL_TRIGGER_KEPT", { posSide: positionSide, count: kept.length,
        orders: kept.map(o => ({ type: o.orderType, qty: o.quantity,
          price: o.triggerPrice, orderId: o.algoId })) });
    }
    await Promise.allSettled(toCancel.map(o => cancelOrder({ algoId: o.algoId, isAlgo: true })));
    if (toCancel.length > 0) {
      log("ORDER_CANCELED", { kindOf: "TPSL_ALGO", posSide: positionSide,
        orderIds: toCancel.map(o => String(o.algoId)), count: toCancel.length,
        ctx: "replaceTpsl" });
    }
  } catch (e) {
    log("ORDER_CANCEL_FAILED", { level: "warn", kindOf: "TPSL_ALGO", ctx: "cancelExistingAlgo",
      posSide: positionSide, err: errOf(e) });
  }
}

// TP/SL 등록 (SL 우선, exponential backoff, 부분 실패 허용)
// SL이 실패하면 TP는 시도하지 않음 — SL 없는 포지션 노출 시간을 최소화하기 위함
async function placeTPSL({ closeSide, tp, sl }) {

  const results = { tp: null, sl: null, failed: [] };
  const RETRY = 5;

  async function tryPlace(type, params) {
    for (let i = 0; i < RETRY; i++) {
      try {
        const r = await binance("POST", "/fapi/v1/algoOrder", params);
        return { orderId: r.data.algoId, status: r.data.algoStatus };
      } catch (e) {
        const msg = e.response?.data?.msg || e.message;
        const delay = 1000 * Math.pow(2, i); // 1s, 2s, 4s, 8s, 16s
        log("TPSL_PLACE_FAILED", { level: "error", type, attempt: i + 1, attempts: RETRY,
          posSide: positionSide, nextRetryMs: i < RETRY - 1 ? delay : null, err: errOf(e) });
        if (i < RETRY - 1) await new Promise(r => setTimeout(r, delay));
        else return { error: msg };
      }
    }
  }

  const positionSide = closeToPosition(closeSide);
  // ⚠ 이 호출이 **사전 등록분(preset)도 함께 지운다** — 같은 사이드의 알고 TP/SL을
  //   전부 취소하기 때문이다. 그래서 체결 경로에서는 preset을 따로 지울 필요가 없다
  await cancelExistingAlgoTPSL(positionSide);

  // 1) SL 먼저 등록 — 손절 안전판이 최우선
  const slResult = await tryPlace("SL", {
    algoType: "CONDITIONAL", symbol: "BTCUSDT", side: closeSide, positionSide,
    type: "STOP_MARKET", triggerPrice: roundPrice(sl),
    closePosition: "true", workingType: "CONTRACT_PRICE",
  });
  if (slResult && !slResult.error) {
    // ⚠ **주문 종류를 결과에 실어 보낸다** (2026-08-25). 로그가 "이름으로 미루어
    //   짐작"하게 두면, 나중에 이 규칙을 바꿨을 때 **과거 로그가 조용히 틀린 뜻**이
    //   된다. `event` 이름을 식별자로 고정한 것과 같은 이유다
    results.sl = { ...slResult, orderType: "STOP_MARKET", closePosition: true };
  } else {
    // SL 실패 시 TP는 시도하지 않음 — 포지션은 무방비 상태로 노출
    // (caller가 pushAlert("critical")로 사용자에게 즉시 알림)
    results.failed.push({ type: "SL", error: slResult?.error || "실패" });
    results.failed.push({ type: "TP", error: "SL 실패로 등록 스킵" });
    return results;
  }

  // 2) SL 성공 후에만 TP 등록
  const tpResult = await tryPlace("TP", {
    algoType: "CONDITIONAL", symbol: "BTCUSDT", side: closeSide, positionSide,
    type: "TAKE_PROFIT_MARKET", triggerPrice: roundPrice(tp),
    closePosition: "true", workingType: "CONTRACT_PRICE",
  });
  if (tpResult && !tpResult.error) results.tp = { ...tpResult, orderType: "TAKE_PROFIT_MARKET", closePosition: true };
  else results.failed.push({ type: "TP", error: tpResult?.error || "실패" });

  return results;
}

// ── 지정가 진입 주문과 **함께** 거는 TP/SL (2026-08-23 사용자 요청) ──────────
//
// 목적: **백엔드가 꺼진 사이에 지정가가 체결돼도 손절이 걸려 있게** 한다.
//   예전엔 체결을 감지한 뒤에야 등록해서, 그 순간 서버가 꺼져 있으면 다시 켤 때까지
//   무방비였다 (recoveryService가 뒤늦게 채우지만 24시간 이내 주문만).
//
// ⚠ **`closePosition:true`를 쓸 수 없다 — 포지션이 없으면 바이낸스가 거절한다:**
//     `Time in Force (TIF) GTE can only be used with open positions`
//   (2026-08-23 실측. ETHUSDT 포지션 0인 상태에서 closePosition ❌ / quantity ✅.
//    BTCUSDT로 먼저 해본 테스트는 그때 SHORT 0.001이 열려 있어 **무효였다** —
//    "포지션 없음"을 검증할 땐 그 사이드에 정말 아무것도 없는지 먼저 확인할 것)
//   → 그래서 **수량을 직접 적는다**. 진입 수량과 같은 값이다
//
// ⚠ 수량 고정의 단점(추가 진입 시 미커버)은 **체결 후 저절로 사라진다** —
//   `onFilled` → `placeTPSL`이 기존 알고 TP/SL을 취소하고 `closePosition` 방식으로
//   다시 걸기 때문이다. 즉 **꺼져 있으면 거래소가, 켜져 있으면 앱이** 맡는다
//
// ⚠ **재시도하지 않는다**(placeTPSL은 5회 31초). 여긴 아직 체결 전이라 급하지 않고,
//   주문 응답을 30초씩 붙들면 화면이 멈춘 것처럼 보인다. 실패해도 진입 주문은 살린다
async function preplaceTPSL({ closeSide, tp, sl, qty }) {
  const positionSide = closeToPosition(closeSide);
  const quantity     = parseFloat(qty).toFixed(3);
  const out = { tp: null, sl: null, failed: [] };

  const place = async (label, type, price) => {
    try {
      const r = await binance("POST", "/fapi/v1/algoOrder", {
        algoType: "CONDITIONAL", symbol: "BTCUSDT", side: closeSide, positionSide,
        type, triggerPrice: roundPrice(price), quantity, workingType: "CONTRACT_PRICE",
      });
      return { orderId: r.data.algoId, status: r.data.algoStatus,
        orderType: type, closePosition: false, qty: parseFloat(quantity) };
    } catch (e) {
      const msg = e.response?.data?.msg || e.message;
      log("TPSL_PRESET_FAILED", { level: "error", type: label, posSide: positionSide,
        price, qty: quantity, err: errOf(e) });
      out.failed.push({ type: label, error: msg });
      return null;
    }
  };

  // SL 먼저 — 손절이 존재 이유다. TP가 실패해도 SL은 남긴다
  out.sl = await place("SL", "STOP_MARKET", sl);
  // ⚠ TP는 **자주 거절된다**: 진입가가 현재가보다 아래면(롱) TP가 이미 지나온 자리일 수
  //   있고, 그러면 "즉시 발동할 주문"이라며 -2021로 막힌다. 그때도 SL은 그대로 둔다
  out.tp = await place("TP", "TAKE_PROFIT_MARKET", tp);
  return out;
}

// 사전 등록해 둔 TP/SL 취소 — 진입 주문이 취소·소멸될 때 같이 내린다.
//
// ⚠ **`cancelExistingAlgoTPSL`을 쓰면 안 된다.** 그건 그 사이드의 알고 TP/SL을 전부
//   지우므로, 같은 사이드에 (외부에서 생긴) 포지션의 TP/SL이 있으면 그것까지 날아간다.
//   사전 등록분은 우리가 id를 알고 있으니 **그것만** 지운다
async function cancelPresetTPSL(preset) {
  const ids = [preset?.sl?.orderId, preset?.tp?.orderId].filter(Boolean);
  if (!ids.length) return 0;
  const r = await Promise.allSettled(ids.map(id => cancelOrder({ algoId: id, isAlgo: true })));
  const ok = r.filter(x => x.status === "fulfilled").length;
  log("PRESET_TPSL_CANCELED", { ok, total: ids.length,
    level: ok < ids.length ? "warn" : "info" });
  return ok;
}

// 취소하기 전에 **그 주문이 정말 그 종류인지** 확인한다 (2026-08-23 감사).
//
// ⚠ `DELETE /api/tpsl` · `/api/tpsl/split` · `/api/scale-in`은 부르는 쪽이 준 orderId를
//   **그대로** 취소했다. 프론트는 우리 API 응답의 id만 쓰므로 실사용 위험은 낮지만,
//   id 하나가 어긋나면 **엉뚱한 주문이 조용히 사라진다** — 특히 `/api/tpsl`은 종류를
//   전혀 안 봐서 분할 TP든 진입 주문이든 다 지울 수 있었다.
//
// kind: "TPSL" | "SPLIT_TP" | "SCALE_IN"
// ※ 목록에서 못 찾으면 **막지 않는다** — 이미 체결·취소된 주문일 수 있고,
//   그때는 취소 요청이 바이낸스에서 -2011로 떨어지므로 결과가 같다.
//   조회가 실패했을 때도 마찬가지다 (통신 문제로 정상 취소를 막으면 더 나쁘다)
async function assertCancelKind(orderId, kind) {
  const [regR, algoR] = await Promise.allSettled([
    binance("GET", "/fapi/v1/openOrders",     { symbol: "BTCUSDT" }),
    binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" }),
  ]);
  if (regR.status !== "fulfilled" || algoR.status !== "fulfilled") return;
  const algoRaw = algoR.value.data;
  const algo = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);
  const id = String(orderId);

  const reg = regR.value.data.find(o => String(o.orderId) === id);
  const alg = algo.find(o => String(o.algoId) === id);
  if (!reg && !alg) return;                       // 못 찾음 → 판단하지 않는다

  const o      = reg ?? alg;
  const type   = reg ? reg.type : alg.orderType;
  const side   = reg ? reg.side : alg.side;
  const posSide= reg ? reg.positionSide : alg.positionSide;
  const closing = (side === "SELL" && posSide === "LONG") || (side === "BUY" && posSide === "SHORT");
  const full    = isFullClose(o);

  // ⚠ **`TPSL`은 전량 청산분만 가리킨다** (2026-08-24). 부분 손절(수량 지정)도 같은
  //   `STOP_MARKET`이라, 안 가르면 차트 손절선 옆 `×`(= `DELETE /api/tpsl`)가
  //   **부분 손절을 지워도 이 장치가 안 막아준다.** 종류가 다르면 거절해야 한다
  const ok =
    kind === "TPSL"       ? (TPSL_TYPES.includes(type) &&  full)
  : kind === "PARTIAL_SL" ? (STOP_TYPES.includes(type) && !full && closing)
  : kind === "SPLIT_TP"   ? (type === "LIMIT" &&  closing)
  : kind === "SCALE_IN"   ? (type === "LIMIT" && !closing)
  : true;

  if (!ok) {
    const e = new Error(`취소 거부: orderId=${id}는 ${kind}가 아니다 (실제 ${type} ${side}/${posSide})`);
    e.status = 409;
    throw e;
  }
  // ⚠ 알아낸 종류를 **돌려준다** — 취소 로그가 "우리 말"(kindOf)뿐이면 나중에
  //   그 말의 뜻이 바뀌었을 때 과거 기록을 되짚을 수 없다. 거래소 종류를 같이 남긴다
  return { orderType: type, orderSide: side, posSide, fullClose: full };
}

// 해당 방향에 TP / SL이 각각 걸려 있는지 확인 → { hasTP, hasSL, ok }
//
// ⚠ 예전에는 `hasTP || hasSL` 하나로 합쳐서 돌려줬다. 되돌리지 말 것 —
//   SL만 등록되고 TP가 실패한 상태에서도 "TP/SL 있음"이 되어 reconcile이
//   TPSL_PLACED로 확정해버리고, 빠진 쪽은 두 번 다시 재시도되지 않았다.
//   조회 자체가 실패하면 { hasTP: false, hasSL: false } — "없다"로 보고 재시도하는 쪽이 안전하다
//
// ⚠ **`ok`는 "물어보는 데 성공했나"다 — `hasSL:false`와 뜻이 다르다** (2026-08-22).
//   두 조회 중 **하나만 실패해도** false다: `Promise.allSettled`라 openAlgoOrders만
//   깨지면 algo가 빈 배열이 되어 **아무 에러 없이 조용히** `hasSL:false`가 나온다.
//   재등록 재시도 경로는 지금처럼 "없다"로 보고 다시 걸면 그만이지만(멱등),
//   **경보 경로는 그러면 안 된다** — 통신이 한 번 튄 것을 "SL이 없다"고 알리게 된다.
//   → 경보를 내는 쪽(orderWatcher의 안전망)은 `ok === false`면 침묵할 것
async function checkExistingTPSL(positionSide) {
  try {
    const [regularRes, algoRes] = await Promise.allSettled([
      binance("GET", "/fapi/v1/openOrders",     { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" }),
    ]);
    const regular = regularRes.status === "fulfilled" ? regularRes.value.data : [];
    const algoRaw = algoRes.status  === "fulfilled" ? algoRes.value.data  : [];
    const algo    = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);
    const ok      = regularRes.status === "fulfilled" && algoRes.status === "fulfilled";
    if (!ok) {
      const why = [
        regularRes.status === "rejected" && `openOrders: ${regularRes.reason?.response?.data?.msg || regularRes.reason?.message}`,
        algoRes.status    === "rejected" && `openAlgoOrders: ${algoRes.reason?.response?.data?.msg || algoRes.reason?.message}`,
      ].filter(Boolean).join(" / ");
      log("QUERY_FAILED", { level: "warn", what: "tpslCheck", ctx: "partial",
        posSide: positionSide || null, err: { code: null, msg: why } });
    }

    // 헤지 모드: positionSide 지정 시 해당 방향 주문만 확인
    const closeSide = positionSide === "LONG" ? "SELL" : positionSide === "SHORT" ? "BUY" : null;
    const matchReg  = o => !positionSide || o.positionSide === positionSide;
    const matchAlgo = o => !positionSide ||
      o.positionSide === positionSide ||
      (!o.positionSide && closeSide && o.side === closeSide);

    const mine = [...regular.filter(matchReg), ...algo.filter(matchAlgo)];
    const stops = mine.filter(isStopOrder);
    const tps   = mine.filter(isTpOrder);

    // ── "있나"가 아니라 **"포지션 전부를 덮고 있나"**로 판정한다 (2026-08-24) ──
    //
    // 예전에는 `STOP_MARKET`이 하나라도 있으면 `hasSL: true`였다. 그때는 맞는 말이었다 —
    // 우리가 거는 손절은 늘 `closePosition:true`(=남은 전부)라 후보가 그것 하나뿐이었다.
    //
    // ⚠ **부분 손절(수량 지정)이 생기면 그 전제가 깨진다.** 절반짜리 손절 하나만 남아도
    //   "손절 있음"으로 읽어서 ① 무방비 경보가 안 울리고 ② reconcile이 TPSL_PLACED로
    //   확정해 재등록을 건너뛰고 ③ recoveryService의 시작 시 복구도 건너뛴다.
    //   **안전장치 셋이 한꺼번에 조용히 죽는다.**
    //
    // 그래서 기준을 "덮여 있나"로 바꾼다:
    //   · `closePosition:true`가 하나라도 있으면 → 무조건 덮인다 (수량과 무관)
    //   · 아니면 부분 주문들의 **수량 합 ≥ 포지션 수량**일 때만 덮인 것으로 본다
    //
    // ⚠ 포지션 수량 조회는 **필요할 때만** 한다 — 전량 주문이 있으면 물어볼 이유가 없다.
    //   평소(우리가 건 TP/SL만 있는 상태)에는 호출이 늘지 않는다
    //
    // ⚠ **지정가형(`STOP`/`TAKE_PROFIT`)도 이제 같이 센다** (2026-08-24, 조사 중 발견).
    //   예전엔 `_MARKET`만 봐서, 바이낸스 웹이 지정가형으로 걸어 둔 손절이 있어도
    //   "손절 없음"으로 읽어 **오경보**를 냈다. `GET /api/tpsl`·`close.js`는 이미
    //   지정가형을 보고 있었는데(2026-08-23 감사) 여기만 빠져 있었다
    // 1차: 포지션 수량 없이 판정 (전량 주문이 있으면 여기서 끝난다 = 평소 경로)
    let hasSL = coversPosition(stops, null);
    let hasTP = coversPosition(tps, null);
    let coverOk = true;
    let posAmt = null;

    // 2차: 부분 주문뿐이라 판단 불가(null)일 때만 포지션 수량을 물어본다
    if (positionSide && (hasSL === null || hasTP === null)) {
      const posRes = await binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" })
        .catch(e => { log("QUERY_FAILED", { level: "warn", what: "positionRisk",
          ctx: "tpslCheck", posSide: positionSide, err: errOf(e) }); return null; });
      posAmt = posRes
        ? Math.abs(parseFloat(posRes.data.find(p => p.positionSide === positionSide)?.positionAmt ?? 0))
        : null;
      if (hasSL === null) hasSL = coversPosition(stops, posAmt);
      if (hasTP === null) hasTP = coversPosition(tps, posAmt);
    }

    // ⚠ 여기까지 와서도 null이면 **"덮였다"고 넘겨짚지 않는다.** false로 내리되 `ok:false`로
    //   알려서 경보 경로가 침묵하게 한다 (위 `ok` 주석과 같은 원칙).
    //   재등록 경로는 false여도 안전하다 — 다시 거는 건 멱등이다
    if (hasSL === null || hasTP === null) coverOk = false;

    // 경보 문구에 쓸 상세값 (2026-08-24). "SL이 없다"와 "일부만 덮는다"는 다른 상황이라
    // 같은 문구로 알리면 안 된다 — 실제로 99.4%가 걸려 있는데 "없습니다"라고 떴다
    const slFull = stops.find(isFullClose);
    return {
      hasTP: hasTP === true, hasSL: hasSL === true, ok: ok && coverOk,
      slPartialQty: stops.filter(o => !isFullClose(o)).reduce((sum, o) => sum + orderQtyOf(o), 0),
      slPrice: slFull ? triggerPriceOf(slFull) : null,
      posAmt,
    };
  } catch (e) {
    log("QUERY_FAILED", { level: "warn", what: "tpslCheck", ctx: "all",
      posSide: positionSide || null, err: errOf(e) });
    return { hasTP: false, hasSL: false, ok: false };
  }
}

module.exports = { binance, roundPrice, cancelOrder, placeTPSL, preplaceTPSL, cancelPresetTPSL,
  assertCancelKind, checkExistingTPSL, syncServerTime };
