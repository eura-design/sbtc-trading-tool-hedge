// 가격 차이 최소 0.05% (BTC 기준 ~$50) — 미체결과 동시에 즉시 TP 체결되는 비정상 케이스 방지
const MIN_PRICE_DIFF_RATIO = 0.0005;
// 단일 주문 수량 상한 — 클라이언트 버그/오타로 큰 값이 들어가는 사고 방지
const MAX_QUANTITY = 100; // 100 BTC = 충분히 보수적인 상한

function validateOrder(req, res, next) {
  const { side, orderType, entry, tp, sl, quantity } = req.body;

  if (!["BUY", "SELL"].includes(side))
    return res.status(400).json({ error: "잘못된 side (BUY|SELL)" });

  if (!["LIMIT", "MARKET"].includes(orderType))
    return res.status(400).json({ error: "잘못된 orderType (LIMIT|MARKET)" });

  const e = parseFloat(entry), t = parseFloat(tp), s = parseFloat(sl), q = parseFloat(quantity);

  if (isNaN(e) || e <= 0) return res.status(400).json({ error: "잘못된 entry 가격" });
  if (isNaN(t) || t <= 0) return res.status(400).json({ error: "잘못된 tp 가격" });
  if (isNaN(s) || s <= 0) return res.status(400).json({ error: "잘못된 sl 가격" });
  if (isNaN(q) || q <= 0) return res.status(400).json({ error: "잘못된 quantity" });
  if (q > MAX_QUANTITY)   return res.status(400).json({ error: `quantity 상한 초과 (${MAX_QUANTITY} BTC)` });

  // 가격 방향 검증: LONG(BUY) → tp > entry > sl, SHORT(SELL) → sl > entry > tp
  if (side === "BUY"  && (t <= e || s >= e))
    return res.status(400).json({ error: "LONG 가격 관계 오류: tp > entry > sl 이어야 합니다" });
  if (side === "SELL" && (t >= e || s <= e))
    return res.status(400).json({ error: "SHORT 가격 관계 오류: sl > entry > tp 이어야 합니다" });

  // 최소 가격 차이 검증 — entry 대비 0.05% 미만이면 거부
  const minDiff = e * MIN_PRICE_DIFF_RATIO;
  if (Math.abs(t - e) < minDiff)
    return res.status(400).json({ error: `tp와 entry의 차이가 너무 작습니다 (최소 ${minDiff.toFixed(2)})` });
  if (Math.abs(e - s) < minDiff)
    return res.status(400).json({ error: `entry와 sl의 차이가 너무 작습니다 (최소 ${minDiff.toFixed(2)})` });

  next();
}

module.exports = { validateOrder };
