// 호가·수량 단위 맞추기 (순수 함수, **import 없음**)
//
// utils/splitTp.js·splitLevels.js와 같은 이유로 의존성 0 — 여기서 나온 문자열이
// 그대로 거래소로 나간다. 어긋나면 주문이 통째로 거절되거나(`-1111 Precision`),
// 더 나쁘게는 **의도한 것과 다른 가격에 걸린다.**
//
// ── 왜 심볼마다 달라야 하나 ────────────────────────────────────────────────
// 2026-09-02 이전에는 `roundPrice`가 **0.1 고정**, 수량이 **toFixed(3) 고정**이었다.
// 그건 BTCUSDT의 값이다. 다른 코인은 전부 다르다:
//
//   BTCUSDT   tick 0.1      step 0.001
//   ETHUSDT   tick 0.01     step 0.001
//   DOGEUSDT  tick 0.00001  step 1
//
// DOGE에 0.1 단위를 쓰면 가격이 통째로 뭉개지고, step 1짜리에 0.001을 보내면 거절된다.
// 그래서 이 값들은 **바이낸스 exchangeInfo에서 받아온다** (services/symbolInfo.js).
// 여기는 그 값을 받아 계산만 한다.
//
// ⚠ **가격은 반올림, 수량은 내림이다.** 수량을 올리면 없는 물량을 주문하게 된다 —
//   `splitLevels.js`의 "모자라는 건 두고, 넘치지 않게 한다"와 같은 원칙이다.

/**
 * 단위 문자열의 유효 소수 자릿수. 바이낸스는 `"0.00100000"`처럼 0을 채워 보낸다.
 *
 * ⚠ **뒤의 0을 떼고 센다.** `"0.10"`을 2자리로 읽으면 `pricePrecision`이 1인 심볼에
 *   소수 2자리를 보내게 되고 거래소가 거절한다.
 */
function decimalsOf(step) {
  const s = String(step);
  // 1e-5 같은 지수 표기 방어 (바이낸스는 안 쓰지만, 우리 쪽에서 숫자로 넘길 수 있다)
  if (/e/i.test(s)) {
    const n = Number(s);
    return n > 0 && n < 1 ? Math.max(0, -Math.floor(Math.log10(n))) : 0;
  }
  const dot = s.indexOf(".");
  if (dot < 0) return 0;
  return s.slice(dot + 1).replace(/0+$/, "").length;
}

/**
 * 가격을 호가 단위(tickSize)의 배수로 **반올림**해 문자열로 돌려준다.
 *
 * 문자열인 이유: `0.1 * 3 = 0.30000000000000004`를 그대로 보내면 거절된다.
 * 자릿수는 tickSize가 정하므로 결과는 언제나 tick의 배수다.
 */
function roundToTick(value, tickSize) {
  const tick = Number(tickSize);
  const v    = Number(value);
  if (!(tick > 0))          throw new Error(`roundToTick: 잘못된 tickSize (${tickSize})`);
  if (!Number.isFinite(v))  throw new Error(`roundToTick: 잘못된 값 (${value})`);

  // ⚠ **`v / tick`으로 나누지 말 것.** tick이 작을수록 오차가 커진다:
  //   785.15 / 0.1 = 7851.499999999999 → 785.1 (785.2가 맞다).
  //   자릿수만큼 곱해 **정수 단위로** 옮긴 뒤 세면 그 오차가 없다.
  //   (옛 roundPrice가 `p * 10`으로 하던 것과 같은 계산이다 — BTCUSDT 동작이 그대로 유지된다)
  const d     = decimalsOf(tickSize);
  const scale = 10 ** d;
  const units = Math.round(v * scale / Math.round(tick * scale));
  return (units * Math.round(tick * scale) / scale).toFixed(d);
}

/**
 * 수량을 최소 단위(stepSize)의 배수로 **내림**해 문자열로 돌려준다.
 *
 * ⚠ 반올림이 아니다 — 올림이 섞이면 보유량보다 많이 청산하려 들거나
 *   가용 증거금을 넘는 주문이 나간다.
 *
 * `1e-9`은 부동소수 오차 흡수용이다 (`splitLevels.unitsOf`와 같은 규칙) —
 * 0.003을 0.001로 나누면 2.9999999999999996이 나오는 일이 있다.
 */
function floorToStep(qty, stepSize) {
  const step = Number(stepSize);
  const q    = Number(qty);
  if (!(step > 0))          throw new Error(`floorToStep: 잘못된 stepSize (${stepSize})`);
  if (!Number.isFinite(q))  throw new Error(`floorToStep: 잘못된 수량 (${qty})`);
  // roundToTick과 같은 이유로 정수 단위에서 센다
  const d     = decimalsOf(stepSize);
  const scale = 10 ** d;
  const su    = Math.round(step * scale);
  const units = Math.floor(Math.max(0, q) * scale / su + 1e-9);
  return (units * su / scale).toFixed(d);
}

module.exports = { decimalsOf, roundToTick, floorToStep };
