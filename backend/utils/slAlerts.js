// 손절이 모자란 상태를 알리는 **빨간 배너의 문구** — 한 곳에서만 만든다 (순수 함수, import 없음)
//
// ── 왜 한 문장으로 합쳤나 (2026-09-06 사용자 요청) ─────────────────────────
// 전에는 같은 사실을 말하는 문구가 **다섯 벌**이었다:
//   ① 시장가 체결 직후 SL 등록 실패      (routes/order.js)
//   ② 체결 뒤 재시도 5회 소진            (orderWatcher.onFilled)
//   ③ 60초 정합의 재등록 실패            (orderWatcher.reconcile)
//   ④ 체결됐는데 걸어둘 가격이 없음      (orderWatcher.onFilled)
//   ⑤ 무방비 포지션 감시                 (orderWatcher.checkNakedFast / reconcile)
// 사용자가 할 일은 다섯 다 **"손절을 직접 걸어라"** 하나인데 글자가 달라서 다른 사고처럼
// 읽혔고, 손절이 정말 없으면 ①~④ 중 하나와 ⑤가 **동시에** 떠서 빨간 줄이 두 개였다.
// 이제 코인·방향마다 **한 줄**이다. 어느 경로로 실패했는지는 화면이 아니라 로그가 답한다
// (`TPSL_PARTIAL` · `TPSL_RETRY_FAILED` · `TPSL_MISSING_INFO` · `NAKED_POSITION`).
//
// ⚠ **문구가 곧 배너의 키다** (services/pushService.js의 `pushAlertClear` 주석).
//   띄우는 쪽과 거두는 쪽이 글자 그대로 같아야 배너가 닫힌다 — 그래서 여기 모았다.
// ⚠ **코인과 방향이 문구에 들어간다** (2026-09-02). 없으면 ETH 배너를 거두는 순간
//   BTC 배너까지 같이 사라진다.
// ⚠ **주문번호는 넣지 않는다** (2026-09-04 사용자 요청). 19자리라 읽을 수 없고,
//   로그에 이미 남는다.
// ⚠ 수량은 **이미 반올림된 문자열**을 받는다 — 자릿수는 심볼마다 다르고(DOGE는 1),
//   그 규칙은 `services/symbolInfo`가 안다. 이 파일은 import 없이 두려고 부르는 쪽에 맡긴다.

/**
 * 손절이 모자란 상태를 알리는 문구.
 *
 * @param symbol      "BTCUSDT"
 * @param posSide     "LONG" | "SHORT"
 * @param coveredText 손절이 덮는 수량(반올림된 문자열). 없거나 0이면 "손절이 없다"는 문구가 된다
 * @param posText     포지션 수량(반올림된 문자열)
 */
const naked = (symbol, posSide, coveredText = null, posText = null) =>
  coveredText && posText
    ? `⚠ ${symbol} ${posSide} 손절(SL)이 포지션의 일부만 덮습니다 (${coveredText} / ${posText}) — 부족한 만큼 더 걸어 주세요`
    : `⚠ ${symbol} ${posSide} 포지션에 손절(SL)이 없습니다 — 직접 걸어 주세요`;

module.exports = { naked };
