// 미체결 LIMIT 주문의 **정체를 주문 자체로 판정한다** — store 기록이 없어도 성립한다
//
// ⚠ 예전에는 `pendingOrders` store의 status(SCALE_IN/SPLIT_TP)로만 갈랐다.
//   그래서 **바이낸스 앱·웹에서 직접 낸 주문이 화면에 제대로 나타나지 않았다**
//   (2026-08-23 사용자 요청으로 교체): 외부 분할 익절·추가 진입은 아예 안 보이고,
//   외부 진입 주문만 "외부 미체결 주문 감지" 카드로 떴다. 기록이 유실된 우리 주문도
//   같은 증상이었다.
//   → 이제 store는 **우리만 아는 부가정보**(플랜 박스·예약 TP/SL·등록 당시 비율)만 담고,
//     "이게 무슨 주문인가"는 여기서 정한다. 바이낸스가 원본이다
//
// ⚠ **헷지모드 전제다.** 판정의 근거가 `side`와 `positionSide`의 조합이고,
//   원웨이 모드에는 positionSide가 `BOTH`라 이 규칙이 성립하지 않는다

// 아직 살아 있는 지정가 주문인가
const isLiveLimit = o =>
  o.type === "LIMIT" && (o.status === "NEW" || o.status === "PARTIALLY_FILLED");

// 청산 방향인가 — LONG을 파는 것(SELL/LONG), SHORT를 되사는 것(BUY/SHORT).
// 이 방향의 지정가는 **분할 TP 말고 다른 것일 수 없다**
const isCloseDir = o =>
  (o.side === "SELL" && o.positionSide === "LONG") ||
  (o.side === "BUY"  && o.positionSide === "SHORT");

// 진입 방향인가 — 위의 반대
const isEntryDir = o => !isCloseDir(o);

// 정체 판정. hasPosFor = { LONG: bool, SHORT: bool }, stored = store 기록(선택)
//
//   청산 방향                        → SPLIT_TP
//   진입 방향 + 그 사이드 포지션 있음 → SCALE_IN  (추가 진입)
//   진입 방향 + 포지션 없음           → ENTRY     (진입 대기)
//
// ⚠ 포지션이 있는 사이드에 "진입 대기"는 존재할 수 없다 — 그 사이드엔 플랜 박스를
//   못 그리게 막혀 있어(CLAUDE.md "드래그 시스템") 우리 시스템으로는 주문을 낼 수 없고,
//   밖에서 낸 것이라면 그건 뜻 그대로 추가 진입이다
//
// ⚠ **`stored`는 포지션이 닫힌 뒤에만 쓰인다 — 이건 store를 되살린 게 아니다.**
//   포지션이 사라지면 거래소 정보만으로는 "남은 추가 진입"과 "진입 대기"를 **구분할
//   근거가 없다**(주문 생김새가 똑같다). 그건 우리만 아는 사실이라 store가 답할
//   자격이 있다 — 이 절의 원칙("거래소가 모르는 것만 store에 담는다")과 어긋나지 않는다.
//   안 쓰면 손절이 발동한 직후부터 reconcile이 치우기 전까지(최대 60초) 남은 추가 진입이
//   "진입 대기"로 보이고, 그 사이드에 플랜 박스를 못 그린다
const limitKind = (o, hasPosFor, stored) => {
  if (isCloseDir(o)) return "SPLIT_TP";
  if (hasPosFor?.[o.positionSide]) return "SCALE_IN";
  if (stored?.status === "SCALE_IN") return "SCALE_IN";
  return "ENTRY";
};

// TP/SL로 취급하는 주문 종류.
//
// ⚠ **우리는 늘 `_MARKET`으로 걸지만 바이낸스 웹·앱이 붙여 건 것은 지정가형일 수 있다**
//   (2026-08-23 실측: 지정가형도 `openAlgoOrders`에 `triggerPrice`로 나온다).
//   조회(`GET /api/tpsl`)·교체(`cancelExistingAlgoTPSL`)·청산(`routes/close.js`)이
//   **같은 목록을 봐야 한다.** 한 곳만 빠지면 그쪽에서 유령 주문이 남는다
const TPSL_TYPES = ["TAKE_PROFIT_MARKET", "STOP_MARKET", "TAKE_PROFIT", "STOP"];

module.exports = { isLiveLimit, isCloseDir, isEntryDir, limitKind, TPSL_TYPES };
