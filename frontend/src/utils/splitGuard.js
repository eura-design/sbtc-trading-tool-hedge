// 분할 주문의 **가격 방향 검증** (순수 함수, import 없음)
//
// ── 왜 따로 뺐나 ───────────────────────────────────────────────────────────
// 여기가 틀리면 **잘못된 쪽에 주문이 조용히 나간다.** 추가 진입·분할 SL은 방향이
// 반대면 거래소가 `-2021`로 거절하거나(트리거) **즉시 체결되고**(지정가),
// 분할 TP는 진입가 반대편이면 애초에 익절이 아니다.
//
// `orderSlice.placeSplitOrders` 안에 묻혀 있어 실제 값으로 검산할 수 없었다.
// `splitTp.js`·`splitLevels.js`와 같은 이유로 의존성 0으로 뺀다.
//
// ── 기준이 종류마다 다르다 ─────────────────────────────────────────────────
// | 종류 | 기준 | 롱 | 숏 |
// |---|---|---|---|
// | 추가 진입 | **현재가** | 아래 | 위 |
// | 분할 SL   | **현재가** | 아래 | 위 |
// | 분할 TP   | **진입가** | 위   | 아래 |
//
// ⚠ **판정은 주문을 내는 시점의 값으로 한다.** 차트에서 미리 재면 버튼을 누른 시점과
//   손을 뗀 시점 사이에 가격이 움직인다.

const KIND_LABEL = { scale_in: "추가 진입", split_tp: "분할 TP", partial_sl: "분할 SL" };

/**
 * @param orders     `[{ price, qty }]` — splitPlan이 낸 목록
 * @param kind       `"scale_in"` | `"split_tp"` | `"partial_sl"`
 * @param isLong     포지션 방향
 * @param mark       살아 있는 현재가 (추가 진입·분할 SL의 기준)
 * @param entryPrice 포지션 진입가 (분할 TP의 기준)
 * @returns `null`이면 통과. 막을 때는 `{ reason, msg }`
 *
 * ⚠ **기준값이 없으면 판정을 건너뛰지 말고 거절한다.** 0으로 두면 롱은
 *   "0보다 크다"가 늘 참이라 전부 걸러지고(사유가 엉뚱하다), 숏은 반대로
 *   **전부 통과해서 잘못된 쪽에 주문이 나간다** — 조용히 나가는 쪽이 훨씬 나쁘다
 */
export function validateSplitPrices({ orders, kind, isLong, mark, entryPrice }) {
  const label = KIND_LABEL[kind] ?? kind;
  const usesEntry = kind === "split_tp";
  const ref = usesEntry ? entryPrice : mark;

  if (!(ref > 0)) {
    return { reason: "no-reference",
             msg: `${label} — ${usesEntry ? "진입가" : "현재가"}를 아직 못 읽었습니다` };
  }

  const bad = (orders ?? []).find(o => usesEntry
    ? (isLong ? o.price <= ref : o.price >= ref)
    : (isLong ? o.price >= ref : o.price <= ref));

  if (!bad) return null;

  const where = usesEntry
    ? (isLong ? "진입가보다 높은" : "진입가보다 낮은")
    : (isLong ? "현재가보다 낮은" : "현재가보다 높은");
  return { reason: "wrong-side", price: bad.price,
           msg: `${label}는 ${where} 쪽에만 걸 수 있습니다` };
}

export { KIND_LABEL };
