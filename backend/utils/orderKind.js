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
const STOP_TYPES = ["STOP_MARKET", "STOP"];                 // 손절 쪽
const TP_TYPES   = ["TAKE_PROFIT_MARKET", "TAKE_PROFIT"];   // 익절 쪽

// ── 전량 청산 주문인가, 부분 청산 주문인가 ────────────────────────────────
//
// 바이낸스는 조건부 주문(TP/SL)에 두 가지를 허용한다:
//   · `closePosition: true` → 수량을 적지 않는다. **"발동 시점에 남아 있는 전부"**라는 뜻
//   · `quantity` 지정        → 그만큼만 청산한다 (헷지모드 청산 방향이라 `reduceOnly`가 자동으로 붙어
//                              포지션보다 많이는 못 판다 — 2026-08-24 실측)
//
// 우리 시스템이 거는 TP/SL은 **늘 전자**다(`placeTPSL`). 후자는 두 가지뿐이다:
//   ① 지정가 진입에 미리 걸어 두는 사전 TP/SL (`preplaceTPSL` — 포지션이 없어 closePosition을 못 쓴다)
//   ② 부분 손절 (예: "평단까지 내려오면 절반만 청산")
//
// ⚠ **판정 근거를 store에 두지 않는다.** 주문 자체에 찍혀 있으므로 거래소가 원본이다
//   ("주문의 정체는 바이낸스가 정한다" 절과 같은 원칙). 그래서 **바이낸스 앱에서 직접 건
//   부분 손절도 똑같이 인식된다** — store에 이름표를 달았다면 그건 못 알아봤다
//
// ⚠ 일반 주문(`openOrders`)과 알고 주문(`openAlgoOrders`)은 **필드 이름이 다르다.**
//   한쪽만 읽으면 바이낸스 웹이 지정가형(`STOP`)으로 걸어 둔 것을 놓친다
const orderTypeOf = o => o.type   ?? o.orderType;
const orderQtyOf  = o => parseFloat(o.origQty ?? o.quantity ?? 0) || 0;

// closePosition은 응답 경로에 따라 boolean으로도 문자열로도 온다
const isFullClose = o => o.closePosition === true || o.closePosition === "true";

const isTpslOrder = o => TPSL_TYPES.includes(orderTypeOf(o));
const isStopOrder = o => STOP_TYPES.includes(orderTypeOf(o));
const isTpOrder   = o => TP_TYPES.includes(orderTypeOf(o));

// 이 트리거 주문 목록이 **포지션 전부를 덮는가** (순수 함수 — node에서 바로 검산한다)
//
//   true  = 덮는다        · false = 못 덮는다        · null = **판단 불가**
//
// ⚠ `null`을 `false`로 뭉개지 말 것. "손절이 없다"와 "포지션 수량을 못 물어봤다"는 다르다 —
//   후자를 경보로 올리면 통신이 튈 때마다 가짜 경보가 뜬다 (`checkExistingTPSL`의 `ok` 주석)
// ⚠ 합계로 판정한다 — 절반짜리 손절 **두 개**면 덮인 것이 맞다
function coversPosition(orders, posAmt) {
  if (orders.some(isFullClose)) return true;          // "남은 전부" → 수량과 무관하게 덮인다
  const qty = orders.filter(o => !isFullClose(o))
    .reduce((sum, o) => sum + orderQtyOf(o), 0);
  if (qty <= 0) return false;                          // 아무것도 없다
  if (posAmt == null) return null;                     // 부분 주문뿐 → 포지션 수량이 있어야 안다
  if (!(posAmt > 0)) return false;
  return qty + 1e-8 >= posAmt;                         // 부동소수점 여유
}

module.exports = { isLiveLimit, isCloseDir, isEntryDir, limitKind, coversPosition,
  TPSL_TYPES, STOP_TYPES, TP_TYPES,
  orderTypeOf, orderQtyOf, isFullClose, isTpslOrder, isStopOrder, isTpOrder };
