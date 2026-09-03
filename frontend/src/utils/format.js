/**
 * R:R 비율 계산 (공유 유틸).
 * SL이 이익 구간에 있으면 "∞", SL이 너무 가까우면 "—".
 */
/**
 * @param tick 이 심볼의 호가 단위. ⚠ **0.1 고정이면 저가 코인에서 R:R이 항상 `—`가 된다** —
 *   DOGE는 진입과 손절 차이가 0.005 같은 값이라 0.1을 넘을 일이 없다 (2026-09-02).
 *   손절이 "한 칸도 안 떨어졌는가"를 보려는 것이므로 기준은 호가 단위가 맞다
 */
export function calcRR(entry, tp, sl, isLong, tick = 0.1) {
  const r = Math.abs(sl - entry);
  if (r < tick) return "—";
  const slInProfit = isLong ? sl >= entry : sl <= entry;
  if (slInProfit) return "∞";
  return (Math.abs(tp - entry) / r).toFixed(2);
}
