// 포지션이 사라진 곳 찾기 (순수 함수, **import 없음**)
//
// ── 왜 따로 뺐나 ───────────────────────────────────────────────────────────
// 이 판정이 틀리면 **남은 추가 진입 주문을 아무도 치우지 않는다.** 그 사이 가격이
// 그 자리에 닿으면 손절 없는 새 포지션이 혼자 열린다 (기타/주의사항.txt의 "최악").
// 실제로 2026-09-02에 틀려 있었다 — ETH 0.009를 청산했는데 `POSITION_GONE`이
// 안 찍혔다. 그래서 실제 값으로 검산할 수 있게 뺐다.
//
// ── ⚠ 직전 관측을 돌아야 한다 ─────────────────────────────────────────────
// 감시는 "포지션이 있는 심볼"만 조회하므로(orderWatcher.watchedSymbols),
// **포지션이 닫히는 순간 그 심볼은 이번 관측에서 통째로 빠진다.**
// 이번 관측을 돌면 사라진 심볼을 만날 방법이 없다 — 그게 위 버그였다.

const NONE = { long: false, short: false };

/**
 * 직전 관측에는 있었는데 지금은 없는 포지션.
 *
 * @param last  Map<symbol, { long, short }> | null — 직전 관측 (첫 회차면 null)
 * @param now   Map<symbol, { long, short }>        — 이번 관측
 * @returns [{ symbol, gone }] — gone은 `"LONG"` / `"SHORT"` / `"LONG+SHORT"`
 */
function goneSides(last, now) {
  if (!last) return [];               // 첫 관측은 기준선만 — 사라진 것이 있을 수 없다
  const out = [];
  for (const [symbol, was] of last) {
    const cur = now?.get(symbol) ?? NONE;
    const gone = [was.long  && !cur.long  && "LONG",
                  was.short && !cur.short && "SHORT"].filter(Boolean).join("+");
    if (gone) out.push({ symbol, gone });
  }
  return out;
}

module.exports = { goneSides };
