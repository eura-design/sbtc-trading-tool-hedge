// 진입 기록(`pending_orders.json`의 한 줄)을 **심볼·방향으로 찾아 고치는** 자리.
//
// ⚠ 왜 따로 모았나 (2026-09-06): "사용자가 손절을 일부러 지웠다"는 표시(`slRemovedAt`)를
//   **적는 쪽과 읽는 쪽이 다른 파일**이다.
//     · 적는다  — `routes/tpsl.js`의 `DELETE /api/tpsl` (차트의 × 버튼)
//     · 거둔다  — `routes/tpsl.js`의 `PUT /api/tpsl` (손절을 다시 걸었다)
//     · 읽는다  — `services/orderWatcher.js` (표시가 있으면 무방비 배너를 띄우지 않는다)
//     · 거둔다  — `services/orderWatcher.js`의 `resolveNaked`
//                 (포지션이 닫혔거나 손절이 다시 보이면)
//   규칙이 두 벌이 되면 한쪽은 표시를 붙이고 다른 쪽은 그 표시를 못 찾는다.
//   그러면 배너가 영영 조용하거나, 일부러 지운 손절을 프로그램이 되살린다.

const store = require("./pendingOrders");
const { sideToPosition } = require("../utils/side");

// 진입 주문의 기록만 고친다 — 분할 TP(`SPLIT_TP`)·추가 진입(`SCALE_IN`) 기록에는 손대지 않는다
const ENTRY_STATUS = new Set(["WATCHING", "FILLED", "TPSL_PLACED", "TPSL_PARTIAL", "TPSL_MISSING"]);

/** 그 심볼·그 사이드의 진입 기록만 골라 `[orderId, info]`로 돌려준다 */
function entryRecordsOf(symbol, positionSide) {
  const out = [];
  for (const [orderId, info] of store.entries()) {
    if (store.symbolOf(orderId) !== symbol) continue;
    if (!ENTRY_STATUS.has(info.status)) continue;
    if (sideToPosition(info.side) !== positionSide) continue;
    out.push([orderId, info]);
  }
  return out;
}

/**
 * 그 심볼·그 사이드의 **진입 기록**을 고친다. `patch(info)`가 `null`을 돌려주면
 * 그 기록은 건너뛴다 (바꿀 것이 없다는 뜻).
 * @returns {number} 실제로 고친 기록 수
 */
function patchEntryRecords(symbol, positionSide, patch) {
  let n = 0;
  for (const [orderId, info] of entryRecordsOf(symbol, positionSide)) {
    const next = patch(info);
    if (!next) continue;
    store.set(String(orderId), next);
    n++;
  }
  return n;
}

/**
 * "사용자가 손절을 일부러 지웠다"는 표시를 붙이거나 거둔다.
 *
 * 이 표시가 막는 것 (2026-09-04):
 *   · `utils/recoverMatch.js`   — 재시작 3단계 안전망이 손절을 대신 거는 것
 *   · `orderWatcher`의 retryable — 60초 정합이 손절을 다시 거는 것
 * 이 표시가 막는 것 (2026-09-06에 추가):
 *   · `orderWatcher`의 무방비 배너 — 내가 지운 손절을 두고 빨간 줄이 뜨는 것
 *
 * @returns {number} 표시가 실제로 바뀐 기록 수
 */
function markSlRemoved(symbol, positionSide, removed) {
  return patchEntryRecords(symbol, positionSide, (info) => {
    if (removed ? !!info.slRemovedAt : !info.slRemovedAt) return null;   // 이미 그 상태
    const next = { ...info };
    if (removed) next.slRemovedAt = Date.now(); else delete next.slRemovedAt;
    return next;
  });
}

/**
 * 그 심볼·그 사이드에 "일부러 지웠다"는 표시가 하나라도 있나.
 *
 * ⚠ 하나라도 있으면 참이다 — 같은 방향에 진입 기록이 여럿일 수 있는데(추가 진입 뒤
 *   남은 기록 등), 그 방향의 손절은 포지션 하나에 걸리는 것이라 방향 단위로 판정한다.
 */
function isSlRemoved(symbol, positionSide) {
  return entryRecordsOf(symbol, positionSide).some(([, info]) => !!info.slRemovedAt);
}

module.exports = { ENTRY_STATUS, entryRecordsOf, patchEntryRecords, markSlRemoved, isSlRemoved };
