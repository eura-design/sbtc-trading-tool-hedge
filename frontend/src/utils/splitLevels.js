// 분할 주문의 **가격 배분 · 수량 배분** (순수 함수, **import 없음**)
//
// pivotLevels.js·backend/utils/splitTp.js와 같은 이유로 의존성 0 —
// 여기서 나온 숫자가 그대로 거래소로 나가므로 node에서 실제 값으로 검산한다.
//
// ⚠ 수량 규칙은 backend/utils/splitTp.js와 **같은 원칙**이다:
//   **모자라는 건 두고, 넘치지 않게 한다.** 남는 쪽으로 몰면 시키지 않은 물량이
//   주문으로 나가고, 체결된 뒤에야 알게 된다

const DEFAULT_STEP = 0.001;   // BTCUSDT 최소 수량 단위 (constants.QTY_STEP와 같은 값)

const round3 = (v) => Math.round(v * 1000) / 1000;

/** 최소 단위의 배수로 **내림** — 부동소수 오차(0.095999…)를 흡수한다 */
function unitsOf(total, step) {
  return Math.floor(total / step + 1e-9);
}

/**
 * 총 수량을 n등분했을 때 한 조각이 최소 단위 이상이 되는 **최대 분할 개수**.
 *
 * ⚠ 이 값이 곧 개수 슬라이더의 상한이다. 안 묶으면 0.002 BTC를 5분할하는 설정을
 *   만들 수 있고, 그때 뒤쪽 세 개는 수량 0이라 **조용히 빠진다** —
 *   화면엔 5개라고 적혀 있는데 실제로는 2개만 나간다
 */
export function maxSplitCount(total, cap = 10, step = DEFAULT_STEP) {
  if (!(total > 0)) return 1;
  return Math.max(1, Math.min(cap, unitsOf(total, step)));
}

/**
 * p1 → p2 구간에 n개를 균등 배치한다. **양 끝을 포함한다.**
 *
 * ⚠ n === 1이면 **p2 하나**다 — 클릭(1개)은 드래그 시작점 없이 놓은 자리 하나이고,
 *   드래그를 1개로 줄였을 때도 "손을 뗀 자리"가 직관에 맞는다
 * ⚠ 정렬하지 않는다 — 부르는 쪽이 준 순서(위→아래인지 아래→위인지)를 그대로 둔다.
 *   수량 배분이 이 순서를 따르므로 여기서 뒤집으면 어느 가격에 얼마가 걸릴지 달라진다
 */
export function splitPrices(p1, p2, n) {
  if (!(n > 1)) return [p2];
  const step = (p2 - p1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(p1 + step * i);
  return out;
}

/**
 * 총 수량을 n조각으로 나눈다 — 최소 단위의 정수배로만.
 *
 * 균등하게 나누고 **남는 한 칸씩을 앞에서부터** 얹는다.
 * 합계는 총 수량을 **절대 넘지 않는다** (넘으면 시키지 않은 물량이다).
 *
 * ⚠ n이 최대 개수보다 크면 **개수를 줄여서** 돌려준다 — 수량 0짜리를 끼워
 *   돌려주면 부르는 쪽이 그걸 그대로 주문으로 보낸다
 */
export function splitQtys(total, n, step = DEFAULT_STEP) {
  const units = unitsOf(total > 0 ? total : 0, step);
  if (!(n > 0) || units <= 0) return [];
  const cnt   = Math.min(n, units);
  const base  = Math.floor(units / cnt);
  const extra = units - base * cnt;
  const out = [];
  for (let i = 0; i < cnt; i++) out.push(round3((base + (i < extra ? 1 : 0)) * step));
  return out;
}

/**
 * 가격·수량을 짝지어 돌려준다 — 화면 미리보기와 실제 주문이 **같은 함수**를 본다.
 *
 * ⚠ 각자 계산하면 미리보기에 뜬 것과 실제로 나가는 것이 어긋난다.
 *   그 어긋남은 체결된 뒤에야 보인다
 */
export function splitOrders(p1, p2, n, total, step = DEFAULT_STEP) {
  const qtys   = splitQtys(total, n, step);
  const prices = splitPrices(p1, p2, qtys.length);
  return qtys.map((qty, i) => ({ price: prices[i], qty }));
}

/**
 * 큰 조각이 **위쪽 끝**으로 가는가? — 기준가에서 **먼 쪽**이 큰 조각을 받는다.
 *
 * 2026-08-27 사용자 확정. 네 경우가 전부 한 규칙으로 떨어진다:
 *
 * | | 주문이 놓이는 곳 | 먼 쪽 = 큰 조각 |
 * |---|---|---|
 * | 추가 진입 · 롱   | 현재가 **아래** | 아래 (더 싼 값에 더 많이) |
 * | 추가 진입 · 숏   | 현재가 **위**   | 위   (더 비싼 값에 더 많이) |
 * | 분할 TP · 롱     | 진입가 **위**   | 위   (먼 목표에 더 많이) |
 * | 분할 TP · 숏     | 진입가 **아래** | 아래 (먼 목표에 더 많이) |
 * | 분할 SL · 롱/숏  | 손절 방향       | 먼 쪽 (아래 절 참고) |
 *
 * ⚠ **분할 SL은 사용자가 지정하지 않았다** — 나머지 셋과 같은 규칙을 따르게 둔 것이다.
 *   뜻은 "가까운 손절에선 조금만 자르고 깊이 갈수록 많이 자른다"가 된다.
 *   반대가 좋으면 여기만 뒤집으면 되고, 그때 분할 SL만 예외라는 것을 적어 둘 것
 *
 * ⚠ 판정에 **가격을 쓰지 않는다** — 사이드와 종류만 본다. 가격으로 정하려 들면
 *   기준가(현재가/진입가)를 이 순수 함수까지 끌고 와야 하고, 그 값은 틱마다 바뀐다
 */
export function bigPieceAtHigh(isLong, kind) {
  return isLong === (kind === "split_tp");
}

/**
 * 실제로 걸 주문 목록 — **끄는 방향과 무관하게** 사이드·종류가 배분을 정한다.
 *
 * ⚠ `splitOrders`를 직접 부르지 말 것. 그건 "준 순서대로" 배분하므로,
 *   **드래그를 어느 끝에서 시작했느냐로 큰 조각이 갈렸다** (2026-08-27에 고친 버그).
 *   같은 구간을 같은 값으로 걸어도 손을 아래에서 시작하면 아래가 많고
 *   위에서 시작하면 위가 많았다 — 화면 어디에도 그 차이가 드러나지 않았다
 * ⚠ **차트 미리보기(OrderPickPreview)와 실제 주문(placeSplitOrders)이 이것 하나를 쓴다.**
 *   한쪽만 정규화하면 화면에 뜬 배분과 나가는 배분이 어긋난다
 */
export function splitPlan(p1, p2, n, total, isLong, kind, step = DEFAULT_STEP) {
  const lo = Math.min(p1, p2), hi = Math.max(p1, p2);
  const bigHigh = bigPieceAtHigh(isLong, kind);
  return splitOrders(bigHigh ? hi : lo, bigHigh ? lo : hi, n, total, step);
}
