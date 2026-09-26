// 가격 차이 최소 0.05% (BTC 기준 ~$50) — 미체결과 동시에 즉시 TP 체결되는 비정상 케이스 방지
const MIN_PRICE_DIFF_RATIO = 0.0005;
// 단일 주문 상한 — 클라이언트 버그/오타로 큰 값이 들어가는 사고 방지
//
// ⚠ **수량이 아니라 금액으로 본다** (2026-09-02). 예전엔 `수량 > 100`이었는데
//   그건 BTC 기준이다 — DOGE는 $5어치가 이미 25개, $100어치면 500개라
//   **정상 주문이 통째로 막혔다** (수량 단위가 1인 심볼이 526개 중 392개다).
//   금액으로 보면 코인이 무엇이든 뜻이 같다.
// ⚠ 가격은 요청의 `entry`를 쓴다 — 이 검증은 주문을 보내기 전에 도는 것이라
//   여기서 시세를 다시 물어보지 않는다 (지정가는 그 가격이 곧 체결가다)
const MAX_NOTIONAL = 7_200_000;   // 100 BTC × $72,000 — 바꾸기 전과 같은 크기

// 층 개수 상한 — 프론트의 `utils/scalePlan.SCALE_LAYER_CAP`과 같은 값이어야 한다.
// ⚠ 여기 값이 더 작으면 화면에서 만든 계획이 서버에서 거절된다
const MAX_SCALE_LAYERS = 10;

/**
 * 진입 가격 규칙 — **단일 진입과 스케일 플랜이 같이 쓴다** (2026-09-27에 떼어냈다).
 *
 * ⚠ 복사하지 말 것. 이 규칙이 두 벌이 되면 한쪽 경로로만 이상한 주문이 통과한다.
 * @returns 문제가 있으면 문구, 없으면 null
 */
function priceRuleError({ side, entry, tp, sl, quantity }) {
  if (!["BUY", "SELL"].includes(side)) return "잘못된 side (BUY|SELL)";
  const e = parseFloat(entry), t = parseFloat(tp), s = parseFloat(sl), q = parseFloat(quantity);
  if (isNaN(e) || e <= 0) return "잘못된 entry 가격";
  if (isNaN(t) || t <= 0) return "잘못된 tp 가격";
  if (isNaN(s) || s <= 0) return "잘못된 sl 가격";
  if (isNaN(q) || q <= 0) return "잘못된 quantity";
  const notional = q * e;
  if (notional > MAX_NOTIONAL)
    return `주문 금액 상한 초과 ($${Math.round(notional).toLocaleString()} > $${MAX_NOTIONAL.toLocaleString()})`;
  // 가격 방향 검증: LONG(BUY) → tp > entry > sl, SHORT(SELL) → sl > entry > tp
  if (side === "BUY"  && (t <= e || s >= e))
    return "LONG 가격 관계 오류: tp > entry > sl 이어야 합니다";
  if (side === "SELL" && (t >= e || s <= e))
    return "SHORT 가격 관계 오류: sl > entry > tp 이어야 합니다";
  // 최소 가격 차이 — entry 대비 0.05% 미만이면 거부
  const minDiff = e * MIN_PRICE_DIFF_RATIO;
  if (Math.abs(t - e) < minDiff) return `tp와 entry의 차이가 너무 작습니다 (최소 ${minDiff.toFixed(2)})`;
  if (Math.abs(e - s) < minDiff) return `entry와 sl의 차이가 너무 작습니다 (최소 ${minDiff.toFixed(2)})`;
  return null;
}

/**
 * POST /api/scale-plan 검증 — 층 배열까지 본다.
 *
 * ⚠ **층 가격이 손절선을 넘으면 거절한다.** 그 자리에 층을 놓으면 사자마자 손절돼
 *   수수료만 두 번 나간다 (프론트의 `scaleLayerPrices`도 같은 자리를 버린다 —
 *   여기는 그 계산을 믿지 않고 다시 본다. 서버는 화면을 신뢰하지 않는다).
 * ⚠ 총수량은 **층 수량의 합**이다. 요청이 따로 보낸 값을 믿지 않는다 — 어긋나면
 *   금액 상한 검사가 헛돌고, 실제로 나가는 양과 검사한 양이 달라진다.
 */
function validateScalePlan(req, res, next) {
  const { side, entry, tp, sl, layers } = req.body;
  if (!Array.isArray(layers) || !layers.length)
    return res.status(400).json({ error: "layers 필요 (층 배열)" });
  if (layers.length > MAX_SCALE_LAYERS)
    return res.status(400).json({ error: `층은 최대 ${MAX_SCALE_LAYERS}개입니다 (받음: ${layers.length})` });

  const e = parseFloat(entry), s = parseFloat(sl);
  const seen = new Set();
  let total = 0;
  for (const [i, L] of layers.entries()) {
    const p = parseFloat(L?.price), q = parseFloat(L?.qty);
    const at = `${i + 1}번째 층`;
    if (isNaN(p) || p <= 0) return res.status(400).json({ error: `${at}: 잘못된 가격` });
    if (isNaN(q) || q <= 0) return res.status(400).json({ error: `${at}: 잘못된 수량` });
    if (seen.has(p)) return res.status(400).json({ error: `${at}: 가격이 겹칩니다 (${p})` });
    seen.add(p);
    // 층은 진입가와 손절가 **사이**여야 한다 (손절선 자리는 비운다)
    const ok = side === "BUY" ? (p > s && p <= e) : (p < s && p >= e);
    if (!ok) return res.status(400).json({
      error: `${at}: 가격 ${p}이 진입가(${e})와 손절가(${s}) 사이가 아닙니다`,
    });
    total += q;
  }

  const err = priceRuleError({ side, entry, tp, sl, quantity: total });
  if (err) return res.status(400).json({ error: err });
  req.scalePlan = { total };
  next();
}

function validateOrder(req, res, next) {
  const { side, orderType, entry, tp, sl, quantity } = req.body;

  if (!["LIMIT", "MARKET"].includes(orderType))
    return res.status(400).json({ error: "잘못된 orderType (LIMIT|MARKET)" });

  // ⚠ 가격·수량 규칙은 `priceRuleError` 하나가 본다 (2026-09-27에 떼어냈다).
  //   스케일 플랜도 같은 함수를 지난다 — 여기 규칙을 다시 적으면 한쪽 경로로만
  //   이상한 주문이 통과한다
  const err = priceRuleError({ side, entry, tp, sl, quantity });
  if (err) return res.status(400).json({ error: err });

  next();
}

module.exports = { validateOrder, validateScalePlan, priceRuleError, MAX_SCALE_LAYERS };
