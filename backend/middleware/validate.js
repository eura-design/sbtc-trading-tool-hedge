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

  // 가격 방향 검증: LONG(BUY) → tp > entry > sl, SHORT(SELL) → sl > entry > tp
  if (side === "BUY"  && (t <= e || s >= e))
    return res.status(400).json({ error: "LONG 가격 관계 오류: tp > entry > sl 이어야 합니다" });
  if (side === "SELL" && (t >= e || s <= e))
    return res.status(400).json({ error: "SHORT 가격 관계 오류: sl > entry > tp 이어야 합니다" });

  next();
}

module.exports = { validateOrder };
