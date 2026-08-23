const axios  = require("axios");
const crypto = require("crypto");
const { closeToPosition } = require("../utils/side");

const BASE = "https://fapi.binance.com";
// const BASE = "https://demo-fapi.binance.com";

let _timeOffset  = 0;   // 로컬 시간 - 바이낸스 서버 시간 (ms)
let _bannedUntil = 0;   // IP 밴 해제 시각 (ms, 0 = 밴 없음)

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
    console.error(`[BAN] Binance IP 밴 — ${new Date(_bannedUntil).toLocaleTimeString()} 해제`);
  }
}

async function syncServerTime() {
  try {
    const { data } = await axios.get(`${BASE}/fapi/v1/time`);
    _timeOffset = data.serverTime - Date.now();
    console.log(`[시간동기화] 오프셋: ${_timeOffset}ms`);
  } catch (e) {
    console.warn("[시간동기화] 실패 (오프셋 0 유지):", e.message);
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
    return await axios({
      method,
      url: `${BASE}${path}`,
      ...(method === "GET" ? { params: p } : { data: new URLSearchParams(p).toString() }),
      headers: {
        "X-MBX-APIKEY": process.env.BINANCE_API_KEY,
        ...(method !== "GET" && { "Content-Type": "application/x-www-form-urlencoded" }),
      },
    });
  } catch (e) {
    parseBan(e);
    throw e;
  }
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
    const toCancel = algo.filter(o =>
      ["TAKE_PROFIT_MARKET", "STOP_MARKET"].includes(o.orderType) && o.positionSide === positionSide
    );
    await Promise.allSettled(toCancel.map(o => cancelOrder({ algoId: o.algoId, isAlgo: true })));
    if (toCancel.length > 0) console.log(`[TPSL] 기존 알고리즘 TP/SL ${toCancel.length}건 취소 완료 (${positionSide})`);
  } catch (e) {
    console.warn("[TPSL] 기존 알고리즘 TP/SL 조회/취소 실패:", e.message);
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
        console.error(`${type} 등록 시도 ${i+1}/${RETRY} 실패: ${msg}`);
        if (i < RETRY - 1) await new Promise(r => setTimeout(r, delay));
        else return { error: msg };
      }
    }
  }

  const positionSide = closeToPosition(closeSide);
  await cancelExistingAlgoTPSL(positionSide);

  // 1) SL 먼저 등록 — 손절 안전판이 최우선
  const slResult = await tryPlace("SL", {
    algoType: "CONDITIONAL", symbol: "BTCUSDT", side: closeSide, positionSide,
    type: "STOP_MARKET", triggerPrice: roundPrice(sl),
    closePosition: "true", workingType: "CONTRACT_PRICE",
  });
  if (slResult && !slResult.error) {
    results.sl = slResult;
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
  if (tpResult && !tpResult.error) results.tp = tpResult;
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
      return { orderId: r.data.algoId, status: r.data.algoStatus };
    } catch (e) {
      const msg = e.response?.data?.msg || e.message;
      console.error(`[사전 TPSL] ${label} 등록 실패: ${msg}`);
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
  console.log(`[사전 TPSL] 취소 ${ok}/${ids.length}건`);
  return ok;
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
      console.warn(`[TPSL조회] 일부 실패 → 결과 신뢰 불가 (${positionSide || "전체"}): ${why}`);
    }

    // 헤지 모드: positionSide 지정 시 해당 방향 주문만 확인
    const closeSide = positionSide === "LONG" ? "SELL" : positionSide === "SHORT" ? "BUY" : null;
    const matchReg  = o => !positionSide || o.positionSide === positionSide;
    const matchAlgo = o => !positionSide ||
      o.positionSide === positionSide ||
      (!o.positionSide && closeSide && o.side === closeSide);

    const hasTP = regular.filter(matchReg).some(o => o.type === "TAKE_PROFIT_MARKET") ||
                  algo.filter(matchAlgo).some(o => o.orderType === "TAKE_PROFIT_MARKET");
    const hasSL = regular.filter(matchReg).some(o => o.type === "STOP_MARKET") ||
                  algo.filter(matchAlgo).some(o => o.orderType === "STOP_MARKET");
    return { hasTP, hasSL, ok };
  } catch (e) {
    console.warn("[TPSL조회] 실패 → 결과 신뢰 불가:", e.response?.data?.msg || e.message);
    return { hasTP: false, hasSL: false, ok: false };
  }
}

module.exports = { binance, roundPrice, cancelOrder, placeTPSL, preplaceTPSL, cancelPresetTPSL,
  checkExistingTPSL, syncServerTime };
