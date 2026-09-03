import * as d3 from "d3";
import { decimalsOf } from "./decimals.js";

// 가격 표시 (2026-09-02)
//
// ── 왜 생겼나 ──────────────────────────────────────────────────────────────
// 그전에는 화면 전체가 `d3.format(",.0f")`(정수)나 `",.2f")`로 가격을 찍었다.
// BTC(70,000)에서는 맞는 선택이지만 **저가 코인에서는 통째로 뭉개진다**:
//
//   DOGE 0.20431 →  ",.0f"  = "0"      ← 가격 축·크로스헤어·현재가가 전부 `$0`
//                   ",.2f"  = "0.20"   ← 호가 단위가 0.00001인데 세 자리가 날아간다
//
// 그래서 **자릿수를 호가 단위(tickSize)가 정한다.** 값은 exchangeInfo에서 온다
// (`useSymbolFilters` → 스토어 `symbolFilters.tick`).
//
// ⚠ **돈(잔고·손익·수수료)에는 쓰지 말 것.** 저건 USDT 금액이라 두 자리가 맞고,
//   호가 단위와 아무 상관이 없다 (BalanceCard·StatsCard가 쓰는 `,.2f`가 그것이다).
//   여기 있는 건 **차트에 그려지는 값**을 위한 것이다.

// 자릿수 규칙은 `utils/decimals.js` 하나뿐이다 (2026-09-03 통합 — 일곱 벌이 갈렸다)
export const tickDecimals = (tick) => decimalsOf(tick ?? 0.1);

const _cache = new Map();   // 자릿수 → d3 포매터 (매 틱 새로 만들지 않는다)
function fmtFor(dec) {
  if (!_cache.has(dec)) _cache.set(dec, d3.format(`,.${dec}f`));
  return _cache.get(dec);
}

/**
 * 가격 문자열 (통화 기호 없음). 자릿수는 호가 단위가 정한다.
 *
 * @param maxDec 축·라벨처럼 좁은 자리에서 자릿수를 묶고 싶을 때. 기본 없음.
 *   ⚠ 묶더라도 **tick보다 굵게 자르지 않는다** — 그러면 같은 값이 두 줄에 똑같이 찍힌다
 */
export function fmtPrice(v, tick = 0.1, maxDec = null) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  let dec = tickDecimals(tick);
  if (maxDec != null) dec = Math.min(dec, maxDec);
  return fmtFor(dec)(Number(v));
}

/** `$` 붙은 가격 — 음수는 `-$1.23` 꼴 */
export function fmtPriceUsd(v, tick = 0.1, maxDec = null) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return `${n < 0 ? "-" : ""}$${fmtPrice(Math.abs(n), tick, maxDec)}`;
}
