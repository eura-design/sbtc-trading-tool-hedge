// 수량 표시·보정 (순수 함수, **import 없음**)
//
// ── 왜 생겼나 ──────────────────────────────────────────────────────────────
// 2026-09-02 이전에는 화면 여덟 곳이 각자 `toFixed(3)`과 `"BTC"` 문자열을 들고 있었다.
// 그건 BTCUSDT의 값이다 — SOL은 0.01, **DOGE는 1**이라 `123.000 BTC`처럼 자릿수도
// 이름도 틀린 문구가 뜬다.
//
// ⚠ **거래소로 나가는 수량은 백엔드가 다시 맞춘다**(`backend/utils/round.js`).
//   여기는 화면 표시와 미리보기 계산용이다. 다만 규칙은 **같아야** 한다 —
//   화면에 0.05로 떠 있는데 실제로 0.04가 나가면 그건 체결된 뒤에야 보인다.
// ⚠ 그래서 내림도 백엔드와 같다: **올리지 않는다.**

// 자릿수 규칙은 `utils/decimals.js` 하나뿐이다 (2026-09-03 통합 — 일곱 벌로 늘어나
// 그중 둘이 갈렸다). 이름만 이 파일의 것으로 다시 내보낸다
import { decimalsOf as qtyDecimals } from "./decimals.js";
export { qtyDecimals };

/** 수량을 그 심볼의 단위로 **내린다** (숫자). 백엔드 floorToStep과 같은 결과 */
export function floorQty(q, step = 0.001) {
  const s = Number(step) || 0.001;
  const d = qtyDecimals(s);
  const scale = 10 ** d;
  const su = Math.round(s * scale);
  const units = Math.floor(Math.max(0, Number(q) || 0) * scale / su + 1e-9);
  return Number((units * su / scale).toFixed(d));
}

/** 화면용 문자열 — 그 심볼의 자릿수로 */
export function fmtQty(q, step = 0.001) {
  return (Number(q) || 0).toFixed(qtyDecimals(step));
}

/** `0.164 BTC` 같은 라벨. base를 모르면 수량만 */
export function qtyLabel(q, step = 0.001, base = "") {
  return base ? `${fmtQty(q, step)} ${base}` : fmtQty(q, step);
}
