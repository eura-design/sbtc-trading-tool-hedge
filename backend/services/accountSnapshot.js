// 계정 전체 관측을 담아 두는 곳 — 사이드바의 **하늘색 포지션 카드**가 읽는다
//
// ⚠ **거래소를 새로 부르지 않는 것이 이 파일의 존재 이유다.**
//   `orderWatcher.watchAccount`가 이미 3초마다 계정 전체의 포지션·미체결·알고 주문을
//   받아 무방비 판정에 쓰고 **버린다.** 그 마지막 관측을 여기 담아 두면
//   `GET /api/positions`가 호출 하나 없이 답한다 (`statsCache.js`와 같은 방식).
//
// ⚠ **`set`은 회차를 다 본 뒤에만 부른다.** watchAccount는 어느 심볼 조회가 하나라도
//   실패하면 그 회차를 통째로 건너뛰는데(빈 값을 "포지션 없음"으로 오해하지 않기 위해서),
//   그 전에 담으면 반쪽짜리 관측이 화면에 간다 — 있는 포지션이 사라져 보인다.
//
// ⚠ 낡은 값도 지우지 않는다. 통신이 튀어 몇 회차를 건너뛰어도 **직전 관측을 그대로
//   내준다** — 카드가 사라지면 사용자는 포지션이 닫힌 것으로 읽는다.
//   대신 `at`(관측 시각)을 같이 주어, 얼마나 낡았는지는 화면이 판단한다.
let snap = null;

/**
 * @param groups `[{ symbol, positions, orders, algos }]` — watchAccount가 뜬 심볼별 한 벌
 */
function set(groups) {
  snap = { at: Date.now(), groups };
}

/** @returns {{at: number, groups: object[]} | null} 아직 한 번도 못 봤으면 null */
function get() {
  return snap;
}

module.exports = { set, get };
