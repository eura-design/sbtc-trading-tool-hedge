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

  // 1) SL 먼저 등록 — 손절 안전판이 최우선
  const slResult = await tryPlace("SL", {
    algoType: "CONDITIONAL", symbol: "BTCUSDT", side: closeSide, positionSide,
    type: "STOP_MARKET", triggerPrice: roundPrice(sl),
    closePosition: "true", workingType: "MARK_PRICE",
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
    closePosition: "true", workingType: "MARK_PRICE",
  });
  if (tpResult && !tpResult.error) results.tp = tpResult;
  else results.failed.push({ type: "TP", error: tpResult?.error || "실패" });

  return results;
}

async function checkExistingTPSL(positionSide) {
  try {
    const [regularRes, algoRes] = await Promise.allSettled([
      binance("GET", "/fapi/v1/openOrders",     { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" }),
    ]);
    const regular = regularRes.status === "fulfilled" ? regularRes.value.data : [];
    const algoRaw = algoRes.status  === "fulfilled" ? algoRes.value.data  : [];
    const algo    = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);

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
    return hasTP || hasSL;
  } catch { return false; }
}

module.exports = { binance, roundPrice, cancelOrder, placeTPSL, checkExistingTPSL, syncServerTime };
