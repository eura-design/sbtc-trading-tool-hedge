// 무방비 포지션에 **어느 기록의 TP/SL을 복구할지** 고른다 (순수 함수, import 없음)
//
// ── 왜 따로 뺐나 ───────────────────────────────────────────────────────────
// 서버가 꺼져 있던 사이에 지정가가 체결됐는데 TP/SL을 못 걸었을 수 있다.
// 그때 재시작 3단계 안전망이 store 기록을 뒤져 손절을 대신 걸어 준다.
//
// **잘못 고르면 엉뚱한 가격에 손절이 걸린다.** 예전 포지션의 기록을 집으면
// 지금 포지션과 상관없는 자리에 손절이 붙고, 그건 사용자가 시키지 않은 주문이다.
// 그런데 이 판정이 `recoveryService` 한복판에 묻혀 있어 검산할 수 없었다.
//
// ── 고르는 규칙 ────────────────────────────────────────────────────────────
// 1. **이미 쓴 기록은 뺀다** — 한 기록으로 두 포지션을 복구할 수 없다
// 2. **tp·sl이 둘 다 있어야 한다** — 하나만 있으면 나머지를 지어내게 된다
// 3. **사이드가 같아야 한다** (진입 side 기준)
// 4. **체결가(`fillPrice`)가 있어야 한다.** 없으면 낡은 기록으로 보고 **거부한다** —
//    "언제 것인지 모르는 TP/SL"을 지금 포지션에 붙이는 것이 가장 위험하다
// 5. 그 체결가가 지금 진입가의 **±2% 안**이어야 한다
// 6. 남은 것 중 **가장 최근**(filledAt → createdAt 순)
//
// ⚠ 조건을 느슨하게 하지 말 것. 못 고르면 배너로 사람에게 넘기면 되지만,
//   잘못 고르면 조용히 틀린 손절이 걸린다.

const PRICE_TOLERANCE = 0.02;   // ±2%

/**
 * @param entries   `[[orderId, info]]` — store 전체
 * @param posSide   `"LONG"` | `"SHORT"` — 무방비 포지션의 방향
 * @param posEntry  그 포지션의 진입가
 * @param usedIds   이미 이번 복구에 쓴 orderId들 (Set 또는 배열)
 * @returns `[orderId, info]` 또는 `null`
 */
function pickRecoverable(entries, posSide, posEntry, usedIds = new Set()) {
  const used = usedIds instanceof Set ? usedIds : new Set(usedIds);
  // 진입 side — LONG은 BUY로 들어갔다
  const entrySide = posSide === "LONG" ? "BUY" : "SELL";
  if (!(posEntry > 0)) return null;

  return [...(entries ?? [])]
    .filter(([orderId, o]) => {
      if (used.has(orderId)) return false;
      if (!o?.tp || !o?.sl || o.side !== entrySide) return false;
      if (!o.fillPrice) return false;                       // 낡은 기록 — 거부
      return Math.abs(o.fillPrice - posEntry) / posEntry <= PRICE_TOLERANCE;
    })
    .sort((a, b) => (b[1].filledAt ?? b[1].createdAt ?? 0) - (a[1].filledAt ?? a[1].createdAt ?? 0))[0]
    ?? null;
}

module.exports = { pickRecoverable, PRICE_TOLERANCE };
