// SL 등록 실패 배너의 문구 — **한 곳에서만 만든다** (순수 함수, import 없음)
//
// ── 왜 모았나 (2026-09-03 감사) ────────────────────────────────────────────
// "SL이 안 걸렸다"는 빨간 배너가 **세 곳**에서 뜨는데(진입 직후 · 재시도 소진 ·
// reconcile 재등록), **거두는 곳이 하나도 없었다.** 그래서 나중에 reconcile이
// 성공해도 화면에는 `SL 등록 실패`가 그대로 남았다.
//
// 무방비 경보(`⚠ SYMBOL SIDE 포지션에 SL이 없습니다`)는 복구되면 거둬진다
// (`resolveNaked`). 그래서 실제로 손절이 없으면 배너가 **둘** 뜨고,
// 복구되면 **하나만** 사라졌다 — 남은 하나가 거짓말을 한다.
// 2026-08-22에 무방비 경보에서 똑같은 문제를 이미 고쳤다(df0b30a).
//
// ⚠ **띄울 때와 거둘 때의 글자가 정확히 같아야 한다** — 프론트가 문구를 키로 지운다
//   (services/pushService.js의 `pushAlertClear` 주석). 그래서 문구를 여기 모았다:
//   양쪽이 각자 문자열을 만들면 한 글자만 달라도 배너가 안 닫힌다.

/** 진입 직후 TP/SL을 걸다 SL이 실패했다 (routes/order.js) */
const marketFilled = (orderId) => `⚠ 시장가 체결됐으나 SL 등록 실패 (orderId=${orderId})`;

/** 체결 감지 뒤 재시도를 다 써서 실패했다 (services/orderWatcher.js의 onFilled) */
const retryExhausted = (orderId) => `⚠ SL 등록 5회 실패 (orderId=${orderId})`;

/** 60초 정합이 다시 걸어 보다 실패했다 (services/orderWatcher.js의 reconcile) */
const reRegisterFailed = (orderId) => `⚠ SL 재등록 실패 (orderId=${orderId})`;

/**
 * 그 주문에 대해 떠 있을 수 있는 **모든** SL 실패 배너의 문구.
 *
 * ⚠ 셋 다 거둔다 — 어느 경로로 떴는지는 거두는 쪽이 알 수 없다.
 *   안 떠 있는 문구를 거두는 것은 무해하다(프론트가 목록에서 못 찾고 넘어간다).
 */
const allFor = (orderId) => [marketFilled(orderId), retryExhausted(orderId), reRegisterFailed(orderId)];

module.exports = { marketFilled, retryExhausted, reRegisterFailed, allFor };
