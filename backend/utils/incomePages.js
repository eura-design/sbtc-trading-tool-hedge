// `/fapi/v1/income`을 **끝까지** 받는다 — 페이지 경계에서 기록을 흘리지 않게
//
// ⚠ **두 곳이 이 함수를 같이 쓴다** (2026-09-27에 모았다):
//   · `routes/stats.js`        — 거래 통계 (수수료·펀딩비·순손익)
//   · `services/trackerAuto.js` — 월별 결산 자동 기록
//   복사하지 말 것. 둘이 갈리면 통계와 결산이 같은 기간에 다른 금액을 말한다.
//
// ── 왜 따로 만들었나 (고친 버그) ────────────────────────────────────────────
// 예전 방식은 다음 페이지를 **"마지막 기록 시각 + 1ms"부터** 받았다. 그런데 같은 시각에
// 기록이 여럿 있는 일이 흔하다 — 펀딩비는 모든 코인에 **같은 시각**으로 붙는다
// (실측 31일: 같은 시각에 2건씩 몰린 경우가 7번). 1000건 경계가 그 한가운데 걸리면
// 경계 뒤쪽의 같은 시각 기록은 **건너뛰어져 합계에서 빠졌다.** 에러도 나지 않는다.
//   → 다음 페이지를 **마지막 시각부터(포함해서)** 다시 받고, 겹친 기록은 버린다.
//
// ⚠ 중복 판정 키는 **`tranId + incomeType`**이다 — `tranId` 하나로는 유일하지 않다
//   (CLAUDE.md "로그" 절, `incomeLogger`가 같은 키를 쓴다).
// ⚠ 한 시각에 몰린 기록이 **한 페이지를 통째로 채우면** 그 시각을 +1ms 넘어간다 —
//   안 넘어가면 같은 페이지만 되풀이해 그 뒤 기록을 못 받는다 (아래 루프 주석).

/** 중복 판정 키. `tranId`가 없는 기록은 내용 전체로 가른다 (그런 일은 없지만 뭉치지 않게) */
const keyOf = (r) => (r?.tranId != null
  ? `${r.tranId}|${r.incomeType}`
  : `${r?.time}|${r?.incomeType}|${r?.income}|${r?.symbol}|${r?.asset}`);

/**
 * @param fetchPage `(from) => Promise<rows[]>` — 한 페이지(`startTime: from`)를 받아 준다
 * @param startTime 처음 시각 (ms)
 * @returns 시간순 기록 (겹침 없음)
 */
async function fetchIncomePages(fetchPage, startTime, { limit = 1000, maxPages = 40 } = {}) {
  const out = [];
  const seen = new Set();
  let from = startTime;
  for (let page = 0; page < maxPages; page++) {
    const data = await fetchPage(from);
    if (!Array.isArray(data) || data.length === 0) break;
    let fresh = 0;
    for (const r of data) {
      const k = keyOf(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
      fresh++;
    }
    if (data.length < limit) break;
    const last = Math.max(...data.map(r => Number(r.time)));
    // ⚠ **페이지가 통째로 한 시각이면 그 시각을 넘어간다** (+1ms). 안 넘어가면 같은 페이지를
    //   영원히 다시 받아 **그 뒤 기록을 하나도 못 받는다** (테스트가 잡았다).
    //   그 시각에 한 페이지를 넘게 몰린 나머지는 못 받는다 — startTime은 1ms보다 잘게
    //   나눌 수 없어서다. 1000건이 같은 1ms에 몰리는 일은 이 계정 규모에서 없다
    if (data.every(r => Number(r.time) === last)) { from = last + 1; continue; }
    if (fresh === 0) break;                              // 안전장치 — 진전이 없다
    from = last;                                         // ⚠ +1 하지 않는다 (위 설명)
  }
  return out;
}

module.exports = { fetchIncomePages, keyOf };
