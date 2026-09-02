// ⚠ `.js` 확장자를 뺀 채로 되돌리지 말 것 — 그러면 node가 이 파일을 못 읽어
//   `frontend/tests/calc.test.js`가 통째로 죽는다. Vite는 둘 다 해석하므로 화면은 그대로다.
//   (`replay/`가 같은 이유로 상대 import에 확장자를 붙인다 — CLAUDE.md 참고)
import { MIN_QTY, QTY_STEP } from "../constants.js";

// 단위 문자열/숫자의 유효 소수 자릿수 — backend/utils/round.js·useSymbolFilters와 같은 규칙
function decimalsOfStep(step) {
  const s = String(step);
  if (/e/i.test(s)) {
    const n = Number(s);
    return n > 0 && n < 1 ? Math.max(0, -Math.floor(Math.log10(n))) : 0;
  }
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.slice(dot + 1).replace(/0+$/, "").length;
}

// BTC 무기한 선물 유지증거금률 (~5%) — 실제 가용 자본에서 차감
const MAINT_MARGIN_RATE = 0.05;

/**
 * @param step  이 심볼의 수량 단위 (LOT_SIZE stepSize). **심볼마다 다르다** —
 *   SOL은 0.01, DOGE는 **1**이다. 안 넘기면 BTCUSDT 값으로 떨어지는데,
 *   그러면 DOGE 화면에 "0.001 DOGE"처럼 **낼 수 없는 수량**이 뜬다.
 *   값은 `useSymbolFilters()`가 서버에서 받아 준다 (원본은 바이낸스 exchangeInfo)
 * @param minQty 이 심볼의 최소 주문 수량
 *
 * ⚠ `riskPerUnit < 0.1` 가드는 **BTC 기준의 낡은 값이다.** 호가 단위가 0.00001인
 *   코인에서는 0.1이 어마어마하게 큰 거리라 정상 주문까지 막는다 →
 *   그래서 "손절이 최소 한 칸(step 아니라 tick)은 떨어져 있는가"로 바꿨다.
 *   tick을 안 넘기면 예전 그대로 0.1이다
 */
export function calcPosition(capital, riskPct, entry, sl, leverage = 1,
                             step = QTY_STEP, minQty = MIN_QTY, tick = 0.1) {
  const riskPerUnit = Math.abs(entry - sl);
  if (riskPerUnit < tick || capital <= 0) return null;
  const idealQty         = (capital * riskPct) / riskPerUnit;
  const usableCapital    = capital * (1 - MAINT_MARGIN_RATE); // 유지증거금 제외
  const maxQty           = (usableCapital * leverage) / entry; // 레버리지 한도
  const cappedQty        = Math.min(idealQty, maxQty);
  // ⚠ 자릿수는 step이 정한다. `toFixed(3)` 고정이면 DOGE(step 1)에서 소수가 남고
  //   SOL(step 0.01)에서는 없는 자리가 생긴다
  const dec              = decimalsOfStep(step);
  const rawQty           = Math.ceil(cappedQty / step - 1e-9) * step;
  const qty              = parseFloat(Math.max(rawQty, minQty).toFixed(dec));
  const idealRiskPct     = (idealQty * riskPerUnit / capital) * 100;
  const actualRiskPct    = (qty * riskPerUnit / capital) * 100;
  const isLeverageCapped = cappedQty < idealQty * 0.999;
  const isMinCapped      = minQty > cappedQty; // 최소 수량이 실제로 바인딩된 경우만
  
  return { idealQty, actualQty: qty, idealRiskPct, actualRiskPct, isMinCapped, isLeverageCapped };
}
