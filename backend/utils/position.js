// 거래소 포지션 행(positionRisk)을 읽는 판정 — **여기 하나다** (2026-09-27에 모았다)
//
// 예전엔 "이 방향 포지션이 있나"를 여덟 곳이 손으로 적었고, **기준이 갈려 있었다** —
// 어떤 곳은 `positionAmt > 0`(롱)·`< 0`(숏), 어떤 곳은 `!== 0`이었다. 헷지 모드에서는
// 롱이 늘 양수·숏이 늘 음수라 지금은 같은 답이 나오지만, 한 곳을 고칠 때 나머지가 따라가지
// 않으면 같은 계좌를 두고 화면·감시·복구가 다른 답을 낸다.
//   → **부호에 기대지 않는 `!== 0`** 하나로 정했다 (헷지 모드 전제가 깨져도 "있다/없다"는 맞다).
// ⚠ 새로 판정을 쓸 때 `parseFloat(p.positionAmt) > 0` 같은 식을 다시 적지 말 것.

/** 수량 (부호 포함). 못 읽으면 0 */
const amtOf = (p) => parseFloat(p?.positionAmt) || 0;

/** 열린 포지션 행인가 */
const isOpen = (p) => amtOf(p) !== 0;

/** 그 방향(`"LONG"`|`"SHORT"`)의 열린 행. 없으면 null */
const openRow = (rows, positionSide) =>
  (Array.isArray(rows) ? rows : []).find(p => p?.positionSide === positionSide && isOpen(p)) ?? null;

/** 그 방향에 열린 포지션이 있나 */
const hasOpen = (rows, positionSide) => openRow(rows, positionSide) !== null;

module.exports = { amtOf, isOpen, openRow, hasOpen };
