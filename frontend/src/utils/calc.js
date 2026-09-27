// ⚠ `.js` 확장자를 뺀 채로 되돌리지 말 것 — 그러면 node가 이 파일을 못 읽어
//   `frontend/tests/calc.test.js`가 통째로 죽는다. Vite는 둘 다 해석하므로 화면은 그대로다.
//   (`replay/`가 같은 이유로 상대 import에 확장자를 붙인다 — CLAUDE.md 참고)
import { MIN_QTY, QTY_STEP } from "../constants.js";

// 자릿수 규칙은 `utils/decimals.js` 하나뿐이다 (2026-09-03 통합 — 일곱 벌이 갈렸다)
import { decimalsOf as decimalsOfStep } from "./decimals.js";

// 유지증거금률을 **모를 때** 쓰는 보수적 기본값 (2026-09-27).
// ⚠ 예전엔 이 자리에 `0.05`가 "BTC 유지증거금률 (~5%)"라는 이름으로 **모든 코인에** 쓰였다.
//   실제 BTC 1구간은 **0.004**이고, 코인별 실제 값은 0.004 ~ 0.1667로 40배 넘게 차이 난다
//   (exchangeInfo·leverageBracket 실측). 그래서 BTC는 필요 이상으로 좁고, 유지증거금률이
//   높은 코인은 반대로 **너무 넓게** 잡혔다. 지금은 부르는 쪽이 그 심볼의 값을 넘긴다
//   (`symbolFilters.maintRate`) — 이 값은 그걸 못 받았을 때만 쓴다
const DEFAULT_MAINT_RATE = 0.05;

/**
 * 거래소가 받아 주는 **가장 작은 주문 수량**.
 *
 * ⚠ 최소 수량과 최소 금액은 **별개이고 거래소는 둘 다 본다.** 그래서 둘 중 큰 쪽이다.
 *   실측(2026-09-27 시세): BTC는 minQty 0.001이 이미 $84라 그대로 최소지만,
 *   ETH는 0.001이 $2.7뿐이라 최소 금액 $20에 걸려 **0.008**로 올라가고,
 *   DOGE는 1개가 $0.2뿐이라 최소 금액 $5에 걸려 **25개**가 된다.
 * ⚠ 금액을 수량으로 환산할 때는 단위의 배수로 **올린다** — 내리면 미달이라 거절된다.
 * ⚠ `price`는 **그 주문이 체결될 가격**이다: 지정가면 그 지정가, 시장가면 **현재가**다.
 *   시장가인데 박스의 진입선으로 재면, 박스가 현재가에서 멀 때 최소 금액이 틀린다.
 */
export function minEntryQty({ price, step = QTY_STEP, minQty = MIN_QTY, minNotional = 0 }) {
  const notionalMin = minNotional > 0 && price > 0
    ? Math.ceil((minNotional / price) / step - 1e-9) * step : 0;
  const q = Math.max(minQty, notionalMin);
  // 단위 자릿수로 정리한다 (0.001 × 8 = 0.008000000000000002 같은 잡음을 턴다)
  return parseFloat(q.toFixed(decimalsOfStep(step)));
}
/**
 * @param step  이 심볼의 수량 단위 (LOT_SIZE stepSize). **심볼마다 다르다** —
 *   SOL은 0.01, DOGE는 **1**이다. 안 넘기면 BTCUSDT 값으로 떨어지는데,
 *   그러면 DOGE 화면에 "0.001 DOGE"처럼 **낼 수 없는 수량**이 뜬다.
 *   값은 `useSymbolFilters()`가 서버에서 받아 준다 (원본은 바이낸스 exchangeInfo)
 * @param minQty 이 심볼의 최소 주문 수량
 * @param minNotional 이 심볼의 **최소 주문 금액**(수량 × 가격). ⚠ `minQty`와 별개다 —
 *   거래소는 **둘 다** 통과해야 받는다. 실측: DOGE는 minQty 1(=$0.2)인데 최소 금액이 $5라
 *   **진짜 최소는 25개**다. (BTC는 2026-09-06 실측 최소 금액이 $50이라 minQty 0.001로도
 *   통과한다 — 거래소가 바꾸는 값이라 숫자를 믿지 말고 `exchangeInfo`를 볼 것.)
 *   안 넘기면 0 — 그때는 minQty만 본다(이 인자가 생기기 전 동작)
 *
 * ⚠ `riskPerUnit < 0.1` 가드는 **BTC 기준의 낡은 값이다.** 호가 단위가 0.00001인
 *   코인에서는 0.1이 어마어마하게 큰 거리라 정상 주문까지 막는다 →
 *   그래서 "손절이 최소 한 칸(step 아니라 tick)은 떨어져 있는가"로 바꿨다.
 *   tick을 안 넘기면 예전 그대로 0.1이다
 */
export function calcPosition(capital, riskPct, entry, sl, leverage = 1,
                             step = QTY_STEP, minQty = MIN_QTY, tick = 0.1,
                             minNotional = 0, maintRate = DEFAULT_MAINT_RATE) {
  const riskPerUnit = Math.abs(entry - sl);
  if (riskPerUnit < tick || capital <= 0) return null;
  const idealQty         = (capital * riskPct) / riskPerUnit;
  // 레버리지 한도 — **증거금에 유지증거금까지 더해도 자본을 넘지 않는** 크기까지다.
  //   필요 자본 = 명목 × (1/레버리지 + 유지증거금률)
  //   → 명목 상한 = 자본 × 레버리지 ÷ (1 + 유지증거금률 × 레버리지)
  // ⚠ 유지증거금률은 **그 심볼의 값**이다 (위 DEFAULT_MAINT_RATE 주석 — 코인마다 40배 차이)
  const mmr              = Number(maintRate) > 0 ? Number(maintRate) : DEFAULT_MAINT_RATE;
  const maxQty           = (capital * leverage) / (entry * (1 + mmr * leverage));
  const cappedQty        = Math.min(idealQty, maxQty);
  // ⚠ 자릿수는 step이 정한다. `toFixed(3)` 고정이면 DOGE(step 1)에서 소수가 남고
  //   SOL(step 0.01)에서는 없는 자리가 생긴다
  const dec              = decimalsOfStep(step);
  const rawQty           = Math.ceil(cappedQty / step - 1e-9) * step;
  // ⚠ 하한은 **수량과 금액 둘 다**를 넘겨야 한다 (거래소가 둘 다 본다).
  //   계산은 `minEntryQty` 하나가 한다 — 플랜 카드의 `최소 수량으로 진입`도 그 함수를 쓴다
  const floorQ           = minEntryQty({ price: entry, step, minQty, minNotional });
  const qty              = parseFloat(Math.max(rawQty, floorQ).toFixed(dec));
  const idealRiskPct     = (idealQty * riskPerUnit / capital) * 100;
  const actualRiskPct    = (qty * riskPerUnit / capital) * 100;
  const isLeverageCapped = cappedQty < idealQty * 0.999;
  const isMinCapped      = floorQ > cappedQty; // 하한이 실제로 바인딩된 경우만
  // 수량이 아니라 **금액** 때문에 올라갔는가 — 화면 문구를 나눌 때 쓴다.
  //   `floorQ > minQty`면 최소 금액 쪽이 이겼다는 뜻이다 (minEntryQty가 둘 중 큰 쪽을 준다)
  const isNotionalCapped = floorQ > minQty && floorQ > cappedQty;
  
  return { idealQty, actualQty: qty, idealRiskPct, actualRiskPct,
           isMinCapped, isNotionalCapped, isLeverageCapped };
}
