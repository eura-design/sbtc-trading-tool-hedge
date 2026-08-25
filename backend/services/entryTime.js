// 현재 포지션의 **평단 변화 이력**을 체결 이력에서 역산한다.
// 차트 진입선을 계단식으로 그리는 데만 쓴다 (frontend PositionLines.jsx).
//
// ⚠ **positionRisk의 `updateTime`을 쓰면 안 된다** (2026-08-15, 실계좌에서 확인).
//   그건 "포지션이 마지막으로 바뀐 시각"이라 부분 청산·추가 진입 때마다 앞으로 밀린다.
//   실측: LONG 진입은 08-14 21:37인데 updateTime은 08-15 05:28(부분 청산)이었다 —
//   8시간 차이라 진입선이 엉뚱한 봉에서 시작했다("실선이 빈 공간에서 시작한다"는 신고).
//
// ⚠ **왜 시각 하나가 아니라 목록인가** (2026-08-15 사용자 지적).
//   추가 매수를 하면 entryPrice가 평단으로 바뀌어 선이 위아래로 움직인다. 그런데
//   평단은 정의상 체결가들 **사이**의 값이라, 최초 진입봉의 고가~저가 범위 밖일 수 있다
//   → 선의 왼쪽 끝이 진입 캔들이 아니라 **허공**을 가리킨다.
//   시작점을 "평단이 바뀐 봉"으로 옮겨도 마찬가지다(그 봉 기준으론 반대쪽 허공).
//   어느 한 봉을 골라도 안 되므로, **구간마다 그때의 평단**을 주고 계단으로 그린다.
//   추가 매수가 없으면 원소 1개 = 예전과 같은 직선 하나다.
//
// 계산:
//   ① userTrades를 **최신부터 거꾸로** 훑으며 그 사이드의 순수량을 누적한다.
//      LONG은 BUY가 +, SELL이 −(숏은 반대). 누적이 현재 보유 수량에 **도달하는 순간**의
//      체결이 지금 포지션을 연 첫 거래다. 중간에 음수로 내려가도 상관없다 —
//      부분 청산이 먼저 나오는 건 정상이고, 거슬러 올라가다 보면 반드시 되돌아온다.
//   ② 거기서부터 **앞으로 재생**하며 평단을 누적한다. 바이낸스 규칙 그대로:
//      진입 체결만 가중평균을 갱신하고, **청산은 평단을 바꾸지 않는다**.
//
// 실측 검산 (2026-08-15, 실계좌 — 마지막 avg가 바이낸스 entryPrice와 일치):
//   LONG  0.013 → 08-14 21:37 BUY 0.027 @62846.90 → 08-15 SELL 0.014
//     → 계단 1개, avg 62846.90 (바이낸스 62846.899999…) ✓
//   SHORT 0.046 → 08-13 13:02 SELL 0.066 부터 8건
//     → 계단 4개, 마지막 avg 63647.09 (바이낸스 63647.08566650742) ✓
const { binance } = require("./binanceClient");
const { log, errOf } = require("../store/logStore");

// 수량 비교 오차 — BTCUSDT 최소 단위가 0.001이라 이보다 훨씬 작게 잡아도 안전하다
const EPS = 1e-8;
// limit 500 이하는 weight 5, 초과하면 20. 어차피 **포지션이 바뀐 순간에만** 부른다
const TRADE_LIMIT = 500;

// 그 사이드의 포지션을 **키우는** 체결인가
const isOpening = (side, t) => (side === "LONG" ? t.side === "BUY" : t.side === "SELL");

// 사이드별 캐시 — { size, entryPrice, info }.
// 키를 (수량, 평단)으로 두는 이유: 그 둘이 그대로면 포지션이 안 바뀐 것이고,
// 바뀌었다면 어차피 다시 구해야 한다.
// ⚠ **실패(null)도 캐시한다.** 안 그러면 이력이 부족해 못 구하는 오래된 포지션에서
//   30초 폴링마다 userTrades를 계속 부른다.
const cache = { LONG: null, SHORT: null };

const hit = (c, pos) =>
  c && Math.abs(c.size - pos.size) < EPS && Math.abs(c.entryPrice - pos.entryPrice) < 1e-6;

/**
 * 한 사이드의 진입 시각 + 평단 변화 이력을 체결 목록에서 역산.
 * @returns {{time: number, steps: {t: number, avg: number}[]} | null}
 */
function scanEntry(trades, side, size) {
  // ① 지금 포지션이 시작된 체결 찾기
  let net = 0, startIdx = -1;
  for (let i = trades.length - 1; i >= 0; i--) {
    const t = trades[i];
    if (t.positionSide !== side) continue;
    net += (isOpening(side, t) ? 1 : -1) * parseFloat(t.qty);
    if (net >= size - EPS) { startIdx = i; break; }
  }
  if (startIdx < 0) return null;   // 이력 부족 → 프론트가 예전처럼 전 폭으로 긋는다

  // ② 앞으로 재생하며 평단 누적
  const steps = [];
  let held = 0, avg = 0;
  for (let i = startIdx; i < trades.length; i++) {
    const t = trades[i];
    if (t.positionSide !== side) continue;
    const qty = parseFloat(t.qty);
    if (!isOpening(side, t)) { held -= qty; continue; }   // 청산은 평단을 바꾸지 않는다
    avg = (avg * held + parseFloat(t.price) * qty) / (held + qty);
    held += qty;
    // 같은 시각의 분할 체결(한 주문이 여러 건으로 쪼개짐)은 한 계단으로 합친다.
    // 안 합치면 길이 0짜리 계단이 줄줄이 생긴다 — 실측으로 7건까지 봤다
    if (steps.length && steps[steps.length - 1].t === t.time) steps[steps.length - 1].avg = avg;
    else steps.push({ t: t.time, avg });
  }
  return steps.length ? { time: steps[0].t, steps } : null;
}

/**
 * @param {{long: object|null, short: object|null}} pos  makePos() 결과
 * @returns {Promise<{LONG: object|null, SHORT: object|null}>}  scanEntry 결과
 */
async function resolveEntryInfo(pos) {
  const want = { LONG: pos.long, SHORT: pos.short };
  const out  = { LONG: null, SHORT: null };
  let needFetch = false;

  for (const side of ["LONG", "SHORT"]) {
    if (!want[side]) { cache[side] = null; continue; }
    if (hit(cache[side], want[side])) out[side] = cache[side].info;
    else needFetch = true;
  }
  if (!needFetch) return out;

  let trades;
  try {
    ({ data: trades } = await binance("GET", "/fapi/v1/userTrades",
      { symbol: "BTCUSDT", limit: TRADE_LIMIT }));
  } catch (e) {
    // 조회 실패는 치명적이지 않다 — 진입선이 전 폭 직선으로 그려질 뿐이다.
    // 캐시에 남기지 않으므로 다음 폴링에서 다시 시도한다
    log("QUERY_FAILED", { level: "warn", what: "userTrades", ctx: "entryTime", err: errOf(e) });
    return out;
  }

  for (const side of ["LONG", "SHORT"]) {
    if (!want[side] || out[side] !== null) continue;
    const info = scanEntry(trades, side, want[side].size);
    cache[side] = { size: want[side].size, entryPrice: want[side].entryPrice, info };
    out[side] = info;
  }
  return out;
}

module.exports = { resolveEntryInfo, scanEntry };
