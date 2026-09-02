// ⚠ `.js` 확장자를 뺀 채로 되돌리지 말 것 — 그러면 node가 이 파일을 못 읽어
//   `frontend/tests/calc.test.js`가 통째로 죽는다. Vite는 둘 다 해석하므로 화면은 그대로다.
//   (`replay/`가 같은 이유로 상대 import에 확장자를 붙인다 — CLAUDE.md 참고)
import { MIN_QTY, QTY_STEP } from "../constants.js";

// BTC 무기한 선물 유지증거금률 (~5%) — 실제 가용 자본에서 차감
const MAINT_MARGIN_RATE = 0.05;

export function calcPosition(capital, riskPct, entry, sl, leverage = 1) {
  const riskPerUnit = Math.abs(entry - sl);
  if (riskPerUnit < 0.1 || capital <= 0) return null;
  const idealQty         = (capital * riskPct) / riskPerUnit;
  const usableCapital    = capital * (1 - MAINT_MARGIN_RATE); // 유지증거금 제외
  const maxQty           = (usableCapital * leverage) / entry; // 레버리지 한도
  const cappedQty        = Math.min(idealQty, maxQty);
  const rawQty           = Math.ceil(cappedQty / QTY_STEP - 1e-9) * QTY_STEP;
  const qty              = parseFloat(Math.max(rawQty, MIN_QTY).toFixed(3));
  const idealRiskPct     = (idealQty * riskPerUnit / capital) * 100;
  const actualRiskPct    = (qty * riskPerUnit / capital) * 100;
  const isLeverageCapped = cappedQty < idealQty * 0.999;
  const isMinCapped      = MIN_QTY > cappedQty; // MIN_QTY가 실제로 바인딩된 경우만
  
  return { idealQty, actualQty: qty, idealRiskPct, actualRiskPct, isMinCapped, isLeverageCapped };
}
