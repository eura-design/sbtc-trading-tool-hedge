/**
 * R:R 비율 계산 (공유 유틸).
 * SL이 이익 구간에 있으면 "∞", SL이 너무 가까우면 "—".
 */
export function calcRR(entry, tp, sl, isLong) {
  const r = Math.abs(sl - entry);
  if (r < 0.1) return "—";
  const slInProfit = isLong ? sl >= entry : sl <= entry;
  if (slInProfit) return "∞";
  return (Math.abs(tp - entry) / r).toFixed(2);
}
