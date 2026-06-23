import { MIN_QTY, QTY_STEP } from "../constants";

// BTC 무기한 선물 유지증거금률 (~5%) — 실제 가용 자본에서 차감
const MAINT_MARGIN_RATE = 0.05;

export function calcPosition(capital, riskPct, entry, sl, leverage = 1) {
  const riskPerUnit = Math.abs(entry - sl);
  if (riskPerUnit < 0.1 || capital <= 0) return null;
  const idealQty         = (capital * riskPct) / riskPerUnit;
  const usableCapital    = capital * (1 - MAINT_MARGIN_RATE); // 유지증거금 제외
  const maxQty           = (usableCapital * leverage) / entry; // 레버리지 한도
  const cappedQty        = Math.min(idealQty, maxQty);
  const rawQty           = Math.ceil(cappedQty / QTY_STEP) * QTY_STEP;
  const qty              = parseFloat(Math.max(rawQty, MIN_QTY).toFixed(3));
  const idealRiskPct     = (idealQty * riskPerUnit / capital) * 100;
  const actualRiskPct    = (qty * riskPerUnit / capital) * 100;
  const isLeverageCapped = cappedQty < idealQty * 0.999;
  const isMinCapped      = MIN_QTY > cappedQty; // MIN_QTY가 실제로 바인딩된 경우만
  
  return { idealQty, actualQty: qty, idealRiskPct, actualRiskPct, isMinCapped, isLeverageCapped };
}
