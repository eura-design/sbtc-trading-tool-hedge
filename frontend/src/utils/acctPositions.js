// 계정 전체 포지션 목록 → 사이드바의 **하늘색 카드** 목록 (순수 함수, import 없음)
//
// 하늘색 카드 = "다른 코인에 포지션이 있다"만 알려주는 읽기 전용 카드다. 누르면
// 그 코인 차트로 옮겨 가고, 그때부터 기존 카드(초록·빨강)가 주문까지 맡는다.
//
// ⚠ **지금 보는 심볼은 뺀다.** 그건 `GET /api/position`을 받는 기존 카드가 이미 그린다.
//   안 빼면 같은 포지션이 두 줄로 보이고, 하늘색 쪽은 주문이 안 되니 사용자는
//   "왜 어떤 건 되고 어떤 건 안 되나"를 화면에서 알 수 없다.
//
// ⚠ **정렬은 심볼 이름 순**이다. 미실현 손익 순으로 바꾸지 말 것 — 가격이 움직일 때마다
//   카드가 자리를 바꿔서 누르려던 `차트 보기` 버튼이 손 아래에서 도망간다.
//   같은 코인 안에서는 롱을 위에 둔다 (기존 카드·차트 라벨 ▲/▼와 같은 순서).

/**
 * @param items `GET /api/positions`의 items — `[{ symbol, side, posData, tpsl, rules }]`
 * @param currentSymbol 지금 화면이 보고 있는 심볼
 * @returns 같은 모양의 배열 (지금 심볼 제외, 심볼 이름 순 → 롱 먼저)
 */
export function otherPositionCards(items, currentSymbol) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(it => it?.symbol && it.symbol !== currentSymbol && it.posData?.size > 0)
    .sort((a, b) => a.symbol.localeCompare(b.symbol)
      || (a.side === b.side ? 0 : a.side === "LONG" ? -1 : 1));
}

/**
 * **지금 초록·빨강 카드가 보여주고 있는 코인**은 무엇인가.
 *
 * ⚠ 화면 심볼과 다를 수 있다. 코인을 바꾸면 `symbol`은 즉시 바뀌지만 `GET /api/position`
 *   응답은 나중에 온다 — 그 사이 초록·빨강 카드에는 **옛 코인의 수량·평단**이 들어 있다.
 *   그래서 두 곳이 이 함수에게 물어본다 (둘 다 2026-09-27에 잡은 들썩임이다):
 *     ① 하늘색 목록에서 **어느 코인을 뺄지** — 화면 심볼로 빼면, 옛 코인이 초록 카드와
 *        하늘색 카드에 **동시에** 떠서 카드 수가 1 → 2 → 1로 움직인다
 *     ② 잔고·포지션 카드에 **살아 있는 가격을 붙일지** — 옛 코인의 포지션에 새 코인의
 *        가격을 곱하면(BTC 진입가 90,000 × ETH 가격 3,000) 총자산이 엉뚱한 자릿수가 되고,
 *        `BalanceCard.amountSize`가 글자 크기를 한 단계 줄였다 되돌려 줄이 들썩인다
 *
 * ⚠ 응답에 `symbol`이 **없으면 화면 심볼로 본다.** 연습(리플레이)의 페이퍼 스냅샷에는
 *   그 필드가 없다 — 없는 것을 "다른 코인"으로 읽으면 연습 중 미실현이 총자산에서 빠진다.
 *
 * @param position `GET /api/position` 응답 (또는 페이퍼 스냅샷). null이면 화면 심볼
 * @param screenSymbol 화면이 지금 보고 있는 심볼
 */
export function shownSymbol(position, screenSymbol) {
  return position?.symbol ?? screenSymbol;
}

/**
 * 미실현을 계산할 때 쓸 **살아 있는 가격**. 어긋나 있으면 null을 답한다.
 *
 * ⚠ 코인을 바꾸면 값 셋이 **각자 다른 시점에** 새 코인 것으로 바뀐다. 짝이 안 맞는 조합으로
 *   미실현을 계산하면 총자산이 엉뚱한 자릿수가 되고, `BalanceCard.amountSize`가 글자 크기를
 *   한 단계 줄였다 되돌려 **잔고 줄이 들썩인다** (2026-09-27 사용자 신고, 두 방향 다 겪었다):
 *     · 포지션이 늦게 오는 경우 — 옛 코인 포지션(BTC 진입가 90,000) × 새 코인 가격(3,000)
 *     · 가격이 늦게 오는 경우  — 새 코인 포지션(ETH 진입가 3,000) × 옛 코인 가격(90,000)
 *
 *   ⚠ 두 번째가 더 흔하다. 포지션은 `setSymbol`이 즉시 다시 받아오는데(`_refetchPos`),
 *     가격은 `useCandles`가 캔들 1500개를 **두 번** 받은 뒤에야 바뀐다.
 *
 * null을 답하면 `utils/equity.js`가 **거래소가 준 미실현**을 쓴다 — 그 포지션의 제 값이라
 * 숫자가 튀지 않고, 응답이 도착하면 저절로 새 코인 값으로 바뀐다.
 *
 * ⚠ `candlePrice`(마지막 캔들의 종가)는 심볼을 따로 확인하지 않는다 — `useCandles`가
 *   심볼이 바뀌는 순간 캔들을 통째로 비우므로 **언제나 지금 심볼의 것이거나 없다.**
 *   대신 그 값은 봉이 바뀔 때만 움직인다 — 틱마다 움직이는 값은 `liveClose`뿐이다.
 *
 * @param screenSymbol 화면이 보고 있는 심볼
 * @param position `GET /api/position` 응답 (또는 페이퍼 스냅샷)
 * @param liveClose 틱마다 오는 현재가 · @param liveCloseSymbol 그 값이 어느 코인의 것인지
 * @param candlePrice 마지막 캔들의 종가 (없으면 undefined)
 */
export function livePriceFor({ screenSymbol, position, liveClose, liveCloseSymbol, candlePrice }) {
  if (shownSymbol(position, screenSymbol) !== screenSymbol) return null;
  const ticking = liveCloseSymbol === screenSymbol ? liveClose : null;
  return ticking ?? candlePrice ?? null;
}

/**
 * 카드 하나를 그리는 데 쓸 호가·수량 단위.
 *
 * ⚠ 백엔드가 그 코인의 규칙을 못 주면(exchangeInfo를 아직 못 받았을 때) **지금 보는
 *   심볼의 단위로 떨어진다.** 그 경우 자릿수가 그 코인과 다를 수 있다 — 대신 카드가
 *   통째로 사라지지는 않는다. 어차피 이 값으로 주문을 만들지 않는다 (읽기 전용 카드다).
 *
 * @param rules  응답의 `rules` — `{ base, tick, step }` 또는 null
 * @param fallback 스토어의 `symbolFilters`
 */
export function cardFilters(rules, fallback) {
  if (!rules) return fallback;
  return { ...fallback, base: rules.base, tick: rules.tick, step: rules.step };
}
