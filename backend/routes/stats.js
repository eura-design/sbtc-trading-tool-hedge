const express     = require("express");
const { binance } = require("../services/binanceClient");
const statsCache  = require("../services/statsCache");
const router      = express.Router();

const CACHE_TTL = 5 * 60 * 1000;

// BTCUSDT 무기한 선물 최초 봉 (2019-09-08). 이보다 앞선 거래는 존재할 수 없다.
// ⚠ **`startTime`을 안 주면 바이낸스가 최근 7일만 돌려준다** (2026-08-25 실측):
//   파라미터 없이 부르면 21건(8/18~), 90일을 명시하면 182건(5/29~)이 나왔다.
//   그래서 예전엔 "시작일 비움 = 전체"가 화면에는 그렇게 보이면서 실제로는
//   **최근 일주일치**였다. 기본값을 여기로 두면 진짜 전체가 된다
const FIRST_TRADE_MS = 1567900800000;

const MAX_LIMIT = 1000;   // 바이낸스 income 한 번 조회 상한
const MAX_PAGES = 20;     // 무한 루프 방지 (2만 건이면 충분하다)

/**
 * income을 **끝까지** 긁어 온다.
 *
 * ⚠ 한 번에 1000건이 상한이라, 그냥 부르면 긴 기간에서 **조용히 잘린다**
 *   (지금 이 계좌는 2019~현재가 354건이라 안 걸리지만, 늘면 걸린다.
 *    잘려도 에러가 안 나서 숫자가 틀린 줄 모른다 — 그게 위험하다)
 */
async function fetchIncome(incomeType, startTime, endTime) {
  const out = [];
  let from = startTime;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await binance("GET", "/fapi/v1/income", {
      symbol: "BTCUSDT", incomeType, startTime: from, endTime, limit: MAX_LIMIT,
    });
    if (!Array.isArray(data) || data.length === 0) break;
    out.push(...data);
    if (data.length < MAX_LIMIT) break;
    const last = Math.max(...data.map(r => r.time));
    // ⚠ 진전이 없으면 멈춘다 — 같은 밀리초에 1000건이 몰리면 영원히 돈다
    if (last <= from) break;
    from = last + 1;
  }
  return out;
}

// GET /api/stats?startTime=<unix_ms>&endTime=<unix_ms>
//
// ⚠ **기간 조회다** (2026-08-25 사용자 요청 — 그전엔 시작일만 받고 끝은 늘 현재였다).
//   둘 다 생략하면 **가능한 최대**(선물 상장일 ~ 현재)를 본다.
//   날짜 → 시각 변환은 프론트가 한다 (`hooks/useStats.js`) — 사용자가 달력에서 고른
//   날짜는 **로컬 기준**이라, 여기서 UTC로 해석하면 하루가 9시간 밀린다
router.get("/", async (req, res) => {
  try {
    const now       = Date.now();
    const hasRange  = !!(req.query.startTime || req.query.endTime);
    const startTime = req.query.startTime ? parseInt(req.query.startTime) : FIRST_TRADE_MS;
    const endTime   = req.query.endTime   ? Math.min(parseInt(req.query.endTime), now) : now;

    // 캐시는 **기본 범위(전체)만** — 기간을 지정하면 매번 다른 답이라 캐시가 의미 없다
    const { cache, cacheTime } = statsCache.getCache();
    if (!hasRange && cache && now - cacheTime < CACHE_TTL) return res.json(cache);

    // 시작이 끝보다 뒤면 빈 결과 (화면에서 막지만 직접 부를 수도 있다)
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) {
      return res.json({ totalComm: 0, totalFunding: 0, netPnl: 0, startTime, endTime, empty: true });
    }

    const [pnl, comm, funding] = await Promise.all([
      fetchIncome("REALIZED_PNL", startTime, endTime),
      fetchIncome("COMMISSION",   startTime, endTime),
      fetchIncome("FUNDING_FEE",  startTime, endTime),
    ]);

    const totalPnl     = pnl.reduce((s, r) => s + parseFloat(r.income), 0);
    const totalComm    = comm.reduce((s, r) => s + Math.abs(parseFloat(r.income)), 0);
    const totalFunding = funding.reduce((s, r) => s + parseFloat(r.income), 0);

    const result = {
      totalComm,
      totalFunding,
      netPnl: totalPnl - totalComm + totalFunding,
      // 실제로 어느 구간을 봤는지 — 화면이 "전체"라고 할 때 그게 뭔지 확인할 수 있게
      startTime, endTime,
    };

    if (!hasRange) statsCache.setCache(result, now);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
module.exports.invalidateCache = statsCache.invalidateCache;
