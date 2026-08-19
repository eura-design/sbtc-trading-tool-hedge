// 분할 TP 잔여 비율 재계산 — 부분 청산 시 routes/close.js가 쓴다.
//
// ── ⚠ 왜 순수 함수로 뺐나 ────────────────────────────────────────────────
// 여기 계산이 틀리면 **사용자가 시키지 않은 물량이 TP 가격에서 나간다.** 눈으로는
// 안 보이고 체결된 뒤에야 안다. 그래서 실제 숫자로 검산할 수 있게 의존성 0으로 뺐다
// (chart/pivotLevels.js·chart/fib.js와 같은 이유).
//
// ── ⚠ 2026-08-19 이전의 버그 ─────────────────────────────────────────────
// 예전에는 **마지막 항목만** `잔여 - 앞의 합`으로 계산했다. 반올림 오차가 쌓여
// 합이 잔여를 넘는 걸 막으려던 장치인데, **분할 TP가 포지션을 100% 덮고 있을 때만**
// 맞는 식이었다. 안 덮은 부분이 있으면 그게 전부 마지막 항목으로 딸려 들어갔다.
//
//   실측: 진입 1.0 + 분할 TP 0.4/0.6 → 추가 진입 +0.5 (포지션 1.5, 0.5는 미커버)
//         → 50% 청산 시 기대 0.3/0.2 (합 0.5)  실제 0.3/0.45 (합 0.75)
//         → **TP 없이 끌고 가려던 0.25가 TP 가격에서 같이 나간다**
//
// 미커버는 사용자가 이상한 설정을 해야 생기는 게 아니다 — **추가 진입 한 번이면 생긴다**
// (SplitTPCard가 `⚠ N BTC 미커버 — 추매 등으로…`를 띄우는 게 그 상황이다).
//
// 지금은 **전부 같은 규칙(원래 수량 × 비율)**으로 줄이고, 반올림 때문에 합이 잔여를
// 넘을 때만 **넘친 만큼(0.001 단위)**을 뒤에서부터 깎는다. 원래 목적은 그대로 지키면서
// 비율이 망가지지 않는다.
//
// ⚠ **frontend/src/replay/paperBroker.js의 close()가 같은 규칙을 미러링한다.**
//    한쪽만 고치면 연습이 실거래와 다르게 체결된다 (그게 이 미러링의 존재 이유다).

const STEP    = 0.001;   // BTCUSDT LOT_SIZE
const MIN_QTY = 0.001;

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * 부분 청산 후 분할 TP를 잔여 포지션 비율로 다시 계산한다.
 *
 * @param {Array}  orders        취소한 분할 TP들 — `{ origQty }`를 읽는다.
 *                               **가격 내림차순으로 정렬해서 넘길 것** (부르는 쪽 책임).
 *                               반올림 초과분을 뒤에서부터 깎으므로 순서가 결과를 정한다 —
 *                               정렬하지 않으면 바이낸스 응답 순서에 따라 0.001이 왔다 갔다 하고,
 *                               페이퍼 브로커(가격 내림차순)와도 어긋난다
 * @param {number} originalSize  청산 **전** 포지션 크기
 * @param {number} closeQty      이번에 시장가로 닫는 수량
 * @returns {{ newSize: number, items: Array<{ order, qty, pct }> }}
 *          items는 최소 수량 미만을 걸러낸 뒤의 목록 (그대로 등록하면 된다)
 */
function rescaleSplitTps(orders, originalSize, closeQty) {
  const newSize = Math.max(0, r3(originalSize - closeQty));
  if (!orders?.length || !(originalSize > 0) || newSize < MIN_QTY) return { newSize, items: [] };

  const ratio = newSize / originalSize;
  const items = orders.map(o => ({ order: o, qty: r3(Number(o.origQty) * ratio) }));

  // 반올림으로 합이 잔여를 넘었을 때만, 넘친 만큼을 **뒤에서부터** 깎는다.
  // (모자라는 건 그대로 둔다 — 미커버는 정상 상태다)
  let over = r3(items.reduce((s, x) => s + x.qty, 0) - newSize);
  for (let i = items.length - 1; i >= 0 && over >= STEP / 2; i--) {
    const cut = Math.min(items[i].qty, over);
    items[i].qty = r3(items[i].qty - cut);
    over = r3(over - cut);
  }

  return {
    newSize,
    items: items
      .filter(x => x.qty >= MIN_QTY)
      .map(x => ({ ...x, pct: Math.round((x.qty / newSize) * 100) })),
  };
}

module.exports = { rescaleSplitTps, MIN_QTY };
