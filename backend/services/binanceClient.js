const axios  = require("axios");
const crypto = require("crypto");

const BASE = "https://fapi.binance.com";

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

// TP/SL 등록 (각각 독립 재시도 5회, exponential backoff, 부분 실패 허용)
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

  const tpResult = await tryPlace("TP", {
    algoType: "CONDITIONAL", symbol: "BTCUSDT", side: closeSide,
    type: "TAKE_PROFIT_MARKET", triggerPrice: roundPrice(tp),
    closePosition: "true", workingType: "MARK_PRICE",
  });
  if (tpResult && !tpResult.error) results.tp = tpResult;
  else results.failed.push({ type: "TP", error: tpResult?.error || "실패" });

  const slResult = await tryPlace("SL", {
    algoType: "CONDITIONAL", symbol: "BTCUSDT", side: closeSide,
    type: "STOP_MARKET", triggerPrice: roundPrice(sl),
    closePosition: "true", workingType: "MARK_PRICE",
  });
  if (slResult && !slResult.error) results.sl = slResult;
  else results.failed.push({ type: "SL", error: slResult?.error || "실패" });

  return results;
}

async function checkExistingTPSL() {
  try {
    const [regularRes, algoRes] = await Promise.allSettled([
      binance("GET", "/fapi/v1/openOrders",     { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v1/openAlgoOrders", { symbol: "BTCUSDT" }),
    ]);
    const regular = regularRes.status === "fulfilled" ? regularRes.value.data : [];
    const algoRaw = algoRes.status  === "fulfilled" ? algoRes.value.data  : [];
    const algo    = Array.isArray(algoRaw) ? algoRaw : (algoRaw.algoOrders || []);
    const hasTP   = regular.some(o => o.type === "TAKE_PROFIT_MARKET") || algo.some(o => o.orderType === "TAKE_PROFIT_MARKET");
    const hasSL   = regular.some(o => o.type === "STOP_MARKET")        || algo.some(o => o.orderType === "STOP_MARKET");
    return hasTP || hasSL;
  } catch { return false; }
}

module.exports = { binance, roundPrice, placeTPSL, checkExistingTPSL, syncServerTime };
