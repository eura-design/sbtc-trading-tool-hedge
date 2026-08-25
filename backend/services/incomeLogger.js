const fs   = require("fs");
const path = require("path");
const { binance } = require("./binanceClient");
const { log, errOf } = require("../store/logStore");

/**
 * 돈이 오간 내역을 로그에 남긴다 (2026-08-25).
 *
 * 이걸로 **로그 하나만 보고 수익 곡선·승률·수수료·펀딩비를 만들 수 있다.**
 * 그전에는 체결 사실만 남고 "얼마 벌었나"가 없어서, 그래프를 그리려면 매번
 * 거래소 API를 다시 불러야 했다.
 *
 * ⚠ **왜 주문 응답에서 안 가져오나**: 바이낸스 주문 응답에는 실현손익이 없다.
 *   그게 오는 통로인 UDS는 **이 환경에서 이벤트를 한 건도 안 보낸다**
 *   (health의 `uds.events: 0` — orderWatcher 주석 참고). 그래서 income API를
 *   주기적으로 훑는다. `/api/stats`가 쓰는 것과 **같은 출처**라 숫자가 어긋날 일이 없다
 *
 * ⚠ **세 종류를 한 통로로 모은다** — REALIZED_PNL(손익) / COMMISSION(수수료) /
 *   FUNDING_FEE(펀딩비). 펀딩비는 주문과 무관하게 8시간마다 빠지므로
 *   주문 경로에 붙일 수가 없다. 셋을 따로 만들면 규칙이 셋이 된다
 *
 * ⚠ **중복을 막는 열쇠는 `tranId` 하나가 아니라 `tranId + incomeType`이다.**
 *   실측(2026-08-25, 109건): **한 거래가 REALIZED_PNL과 COMMISSION 두 줄을 같은
 *   `tranId`로 낸다.** tranId만으로 세면 109건 중 88건으로 줄어든다 —
 *   즉 수수료가 손익에 밀려 통째로 유실된다.
 *   ⚠ 로그를 **읽는 쪽도 마찬가지다** — `tranId`로 group by 하지 말 것
 *
 * ⚠ 시각(`time`)만으로 자르면 같은 밀리초의 건을 놓치거나 겹친다 → 경계 시각의
 *   키 목록을 따로 들고 있는다. 커서는 파일에 남긴다 — 메모리에만 두면
 *   재시작할 때마다 최근 7일치가 통째로 다시 쌓인다 (실측으로 재시작 후 0건 확인)
 */

const CURSOR_FILE = path.join(__dirname, "../logs/.income_cursor.json");
const POLL_MS     = 10 * 60 * 1000;   // 10분 — 펀딩비는 8시간마다라 이보다 자주 볼 이유가 없다
const BACKFILL_MS = 7 * 24 * 3600_000; // 커서가 없을 때 훑을 범위

let timer   = null;
let cursor  = { time: 0, ids: [] };   // ids = 마지막 시각에 이미 본 tranId (경계 중복 방지)

function loadCursor() {
  try {
    const raw = JSON.parse(fs.readFileSync(CURSOR_FILE, "utf-8"));
    if (raw && typeof raw.time === "number") cursor = { time: raw.time, ids: raw.ids || [] };
  } catch { /* 없으면 아래 백필로 시작한다 */ }
}

function saveCursor() {
  try {
    fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true });
    fs.writeFileSync(CURSOR_FILE, JSON.stringify(cursor));
  } catch { /* 커서를 못 써도 매매는 굴러가야 한다 — 다음에 조금 겹칠 뿐이다 */ }
}

async function pollIncome() {
  const startTime = cursor.time > 0 ? cursor.time : Date.now() - BACKFILL_MS;
  try {
    const { data } = await binance("GET", "/fapi/v1/income", {
      symbol: "BTCUSDT", startTime, limit: 1000,
    });
    if (!Array.isArray(data) || data.length === 0) return;

    // ⚠ 시각 오름차순으로 훑는다 — 커서가 뒤로 가면 안 된다
    const rows = data.slice().sort((a, b) => a.time - b.time);
    const seen = new Set(cursor.ids);
    let maxTime = cursor.time;
    let newIds  = cursor.ids;
    let count   = 0;

    for (const r of rows) {
      // ⚠ tranId **단독으로는 유일하지 않다** (위 머리말 실측) — incomeType까지 붙인다
      const id = `${r.tranId ?? r.time}/${r.incomeType}`;
      if (r.time < cursor.time) continue;
      if (r.time === cursor.time && seen.has(id)) continue;

      // ⚠ 종류를 `event`로 쪼개지 말고 **한 이벤트 + `incomeType` 필드**로 둔다.
      //   나중에 종류가 늘어도(예: INSURANCE_CLEAR) 파싱하는 쪽이 안 깨진다
      log("INCOME", {
        incomeType: r.incomeType,
        amount: parseFloat(r.income),
        asset:  r.asset,
        // ⚠ `tranId`는 **단독으로 유일하지 않다** — 손익과 수수료가 같은 값을 쓴다.
        //   중복을 세거나 group by 할 때는 반드시 `incomeType`과 같이 볼 것
        tranId:  String(r.tranId ?? ""),
        tradeId: r.tradeId ? String(r.tradeId) : null,
        // 거래소가 찍은 시각 — `ts`(우리가 기록한 시각)와 다르다. 집계는 이걸로 할 것
        incomeTime: r.time,
      });
      count++;

      if (r.time > maxTime) { maxTime = r.time; newIds = [id]; }
      else if (r.time === maxTime) { newIds = [...newIds, id]; }
    }

    if (count > 0) {
      cursor = { time: maxTime, ids: newIds.slice(-50) };
      saveCursor();
    }
  } catch (e) {
    // 조용히 넘어간다 — 다음 주기에 같은 구간을 다시 본다(커서를 안 옮겼으므로 유실 없음)
    log("INCOME_POLL_FAILED", { level: "warn", err: errOf(e) });
  }
}

function start() {
  if (timer) return;
  loadCursor();
  pollIncome().catch(() => {});
  timer = setInterval(() => pollIncome().catch(() => {}), POLL_MS);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * 한 주문의 체결 내역을 모아 **주문번호에 붙은 손익 한 줄**로 남긴다 (2026-08-25).
 *
 * `INCOME`만으로도 수익 곡선은 그려지지만, 거기엔 `orderId`가 없어서
 * **"이 청산이 얼마 벌었나"를 주문과 이을 수 없다**(income은 `tradeId`만 준다).
 * 청산 직후 한 번만 조회해서 그 연결을 만든다.
 *
 * ⚠ **조금 기다렸다 부른다.** 주문 응답이 온 직후에는 체결이 아직 안 잡힌다.
 * ⚠ **실패해도 조용히 넘어간다** — 손익은 `INCOME`에도 남으므로 여기가 없어도
 *   숫자는 맞는다. 여기는 "주문과 이어 보기" 편의다
 */
async function logTradesFor(orderId, ctx = {}) {
  try {
    const { data } = await binance("GET", "/fapi/v1/userTrades", {
      symbol: "BTCUSDT", orderId, limit: 100,
    });
    if (!Array.isArray(data) || data.length === 0) return;
    let qty = 0, quote = 0, pnl = 0, fee = 0;
    for (const t of data) {
      const q = parseFloat(t.qty);
      qty   += q;
      quote += q * parseFloat(t.price);
      pnl   += parseFloat(t.realizedPnl || 0);
      fee   += parseFloat(t.commission  || 0);
    }
    log("TRADE_SETTLED", {
      ...ctx,
      orderId: String(orderId),
      qty:      +qty.toFixed(6),
      avgPrice: qty > 0 ? +(quote / qty).toFixed(2) : null,
      realizedPnl: +pnl.toFixed(8),
      fee:         +fee.toFixed(8),
      feeAsset: data[0].commissionAsset || null,
      fills: data.length,
    });
  } catch (e) {
    log("TRADE_SETTLE_FAILED", { level: "warn", orderId: String(orderId), err: errOf(e) });
  }
}

module.exports = { start, stop, pollIncome, logTradesFor };
