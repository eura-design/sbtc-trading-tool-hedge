// 스케일 플랜 — 진입가부터 손절가까지 층을 나눠 들어가는 계획의 계산
//
// ⚠ **`.js` 확장자를 빼지 말 것** — `tests/scalePlan.test.js`가 node로 직접 읽는다
//   (`utils/calc.js` 머리 주석과 같은 이유).
//
// 사용자가 정한 규칙 (2026-09-27) — **판단만으로 바꾸지 말 것**:
//   ① 층은 **진입가에서 시작해 손절가 직전까지** 놓는다. 손절선 자리는 비운다 —
//      거기 층을 놓으면 그 층은 **사자마자 손절된다** (같은 가격에서 지정가 진입과
//      손절 트리거가 만난다). 수수료만 두 번 나간다
//   ② 수량은 **층마다 균등**하다. 아래 층을 크게 하는 배분(리스크 균등)은 계산이
//      정교해지는 대신 "왜 이 수량인지"가 눈으로 읽히지 않는다
//   ③ 총수량은 **전부 체결됐을 때의 평단**으로 리스크 %를 맞춘다. 그래서 단일 진입보다
//      수량이 많다 — 평단이 손절선에 가까워 1개당 손실이 작기 때문이고, **손절 시 손실은
//      단일 진입과 같다**. 대신 잡는 금액(명목)과 증거금이 늘어난다
//
// ⚠ 일부만 체결되면 리스크는 **줄어드는** 방향이다 (수량이 적고 평단이 유리하다).
//   반대로 손절에 닿으려면 모든 층을 지나쳐야 하므로, **손절을 맞을 때는 거의 항상
//   전부 체결된 상태**다. 손실은 늘 계획대로이고 이익은 부분일 수 있다 — 이 비대칭을
//   화면이 보여주도록 `scalePreview()`가 "전부 체결 / 절반 체결" 두 줄을 만든다.
import { calcPosition } from "./calc.js";
import { floorQty } from "./qty.js";

// 층 개수의 상한. 거래소 최소 금액 때문에 실제 상한은 이보다 낮을 수 있다
// (`maxScaleLayers`가 계산한다). 이 값은 "화면에서 다룰 만한 수"의 한계다
export const SCALE_LAYER_CAP = 10;
export const DEFAULT_SCALE_LAYERS = 4;

/** 가격을 호가 단위에 맞춘다 (반올림 — 가격은 반올림, 수량은 내림) */
const roundTick = (p, tick) => {
  if (!(tick > 0)) return p;
  const dec = (String(tick).split(".")[1] || "").length;
  return parseFloat((Math.round(p / tick) * tick).toFixed(dec));
};

/**
 * 층 가격들. **진입가를 포함하고 손절가는 제외한다.**
 *
 * 롱이면 위(진입가)에서 아래로, 숏이면 아래(진입가)에서 위로 내려간다.
 * 간격은 `|진입가 − 손절가| / 층수`라, 마지막 층이 손절선에서 딱 한 칸 떨어진다.
 *
 * ⚠ 호가 단위에 맞추면 **층이 겹칠 수 있다** (구간이 좁고 단위가 클 때).
 *   겹친 것은 버리고, 손절선에 닿거나 넘은 것도 버린다 — 그래서 돌려주는 개수가
 *   요청한 개수보다 **적을 수 있다.** 부르는 쪽이 길이를 봐야 한다
 */
export function scaleLayerPrices({ entry, sl, count, tick = 0, isLong }) {
  const n = Math.floor(count);
  if (!(n >= 1) || !(entry > 0) || !(sl > 0)) return [];
  if (isLong ? !(entry > sl) : !(entry < sl)) return [];
  const gap = Math.abs(entry - sl) / n;
  const dir = isLong ? -1 : 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = roundTick(entry + dir * gap * i, tick);
    // 손절선에 닿거나 넘은 층은 버린다 (사자마자 손절되는 자리다)
    if (isLong ? !(p > sl) : !(p < sl)) continue;
    if (out.includes(p)) continue;   // 호가 단위 때문에 겹친 층
    out.push(p);
  }
  return out;
}

/**
 * 스케일 플랜 한 벌. 못 만들면 null.
 *
 * @returns {{prices, perLayerQty, totalQty, avgEntry, base}}
 *   prices      — 실제로 걸 층 가격 (요청한 개수보다 적을 수 있다)
 *   perLayerQty — 층 하나의 수량 (균등)
 *   totalQty    — perLayerQty × 층수. ⚠ 내림 때문에 리스크를 **덜** 쓸 수 있다.
 *                 남는 조각을 마지막 층에 얹지 않는다 — 균등 규칙을 지키는 쪽을 택했다
 *   avgEntry    — 전부 체결됐을 때의 평단 (균등이라 단순 평균)
 *   base        — `calcPosition` 결과 그대로 (하한에 걸렸는지 등을 화면이 읽는다)
 */
export function scalePlanCalc({ capital, riskPct, entry, sl, count, isLong,
                               leverage = 1, step, minQty, tick, minNotional = 0 }) {
  const prices = scaleLayerPrices({ entry, sl, count, tick, isLong });
  if (!prices.length) return null;
  const avgEntry = prices.reduce((a, b) => a + b, 0) / prices.length;
  // ⚠ 리스크 계산은 `utils/calc.js` 하나가 한다 — 여기 식을 다시 쓰지 말 것.
  //   다른 것은 **진입가 자리에 평단을 넣는다**는 점뿐이다
  const base = calcPosition(capital, riskPct, avgEntry, sl, leverage, step, minQty, tick, minNotional);
  if (!base || !(base.actualQty > 0)) return null;
  const perLayerQty = floorQty(base.actualQty / prices.length, step);
  if (!(perLayerQty > 0)) return null;
  // 층 하나가 거래소 하한을 못 넘으면 이 층수로는 낼 수 없다.
  // ⚠ **금액도 본다** — 거래소는 최소 수량과 최소 금액을 둘 다 본다.
  //   가장 싼 층(롱이면 맨 아래)이 통과해야 전부 통과한다
  if (minQty > 0 && perLayerQty < minQty) return null;
  if (minNotional > 0) {
    const worst = isLong ? Math.min(...prices) : Math.min(...prices);
    if (perLayerQty * worst < minNotional) return null;
  }
  return { prices, perLayerQty, totalQty: perLayerQty * prices.length, avgEntry, base };
}

/**
 * 이 플랜에서 **실제로 낼 수 있는 최대 층수**.
 *
 * ⚠ `splitLevels.maxSplitCount`를 쓸 수 없다. 저건 "총수량이 정해진 뒤" 그것을 몇 조각으로
 *   쪼갤 수 있는지를 센다. 스케일 플랜은 층수가 바뀌면 **평단이 움직여 총수량 자체가
 *   달라진다** — 그래서 층수마다 다시 계산해 본다 (`cap`이 10이라 비용이 없다)
 */
export function maxScaleLayers(args, cap = SCALE_LAYER_CAP) {
  for (let n = cap; n >= 1; n--) {
    const r = scalePlanCalc({ ...args, count: n });
    if (r && r.prices.length === n) return n;
  }
  return 1;
}

/**
 * 화면에 보여줄 "전부 체결 / 절반 체결" 두 줄.
 *
 * ⚠ 절반은 **위에서부터** 센다 (롱이면 비싼 층부터). 가격이 진입가를 찍고 조금만 눌렀다
 *   올라간 경우가 그 모양이다 — 아래 층은 비어 있다.
 * ⚠ 필요 증거금은 `명목 ÷ 레버리지`다. **청산가는 내지 않는다** — 크로스 마진의 청산가는
 *   계정 전체(다른 코인 포지션까지)를 보고 거래소가 정하므로, 플랜 단계에서 정확히
 *   낼 수 없다. 틀린 숫자를 보여주는 것보다 안 보여주는 것이 맞다
 */
export function scalePreview(plan, leverage = 1) {
  if (!plan) return null;
  const { prices, perLayerQty } = plan;
  const row = (k) => {
    const used = prices.slice(0, k);
    const qty = perLayerQty * used.length;
    const avg = used.reduce((a, b) => a + b, 0) / used.length;
    const notional = qty * avg;
    return { layers: used.length, qty, avgEntry: avg, notional,
             margin: leverage > 0 ? notional / leverage : notional };
  };
  return { full: row(prices.length), half: row(Math.ceil(prices.length / 2)) };
}
