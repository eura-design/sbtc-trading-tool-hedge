// 실시간 미실현 손익 / 총자산 (순수 함수, **import 없음**)
//
// pivotLevels.js·fib.js·splitTp.js와 같은 이유로 의존성 0 — node에서 바로 검산한다.
//
// ⚠ **이 파일이 유일한 계산처다.** 예전엔 PositionCard가 같은 식을 인라인으로 갖고 있었고
//   (2026-08-22 이곳으로 옮김), 잔고 카드에 총자산을 붙이면서 식이 둘이 됐다.
//   한 화면에 나란히 뜨는 두 숫자라 조금만 어긋나도 바로 보인다 —
//   포지션 카드의 `미실현`과 잔고 카드의 `총자산`은 **같은 값에서 나와야 한다**.

// 마크 가격이 아니라 **체결가(차트 종가)** 기준이다.
//   ⚠ 바이낸스 앱이 보여주는 미실현은 **마크 가격** 기준이라 몇 달러 어긋난다.
//     그래도 이 값을 쓰는 이유: 화면이 보여주는 게 캔들(체결가)이고,
//     마크 가격은 폴링으로만 들어와 **틱마다 움직이지 않는다**.
//     "포지션이 있으면 실시간으로 변한다"가 이 표시의 존재 이유다
//     (TP/SL 트리거를 CONTRACT_PRICE로 통일한 것과 같은 판단)
export function unrealizedFor(posData, price, isLong) {
  if (!posData) return 0;
  if (!price) return posData.unrealizedPnl ?? 0;   // 가격을 아직 모르면 서버 값
  const diff = isLong ? price - posData.entryPrice : posData.entryPrice - price;
  return diff * posData.size;
}

// 롱·숏을 합친 미실현. 헷지모드라 양쪽이 동시에 있을 수 있다
export function totalUnrealized(position, price) {
  return unrealizedFor(position?.long, price, true)
       + unrealizedFor(position?.short, price, false);
}

// 총자산 = 지갑 잔고 + 미실현
//   지갑 잔고는 **실현된 것만** 담고 있어 포지션이 없으면 움직이지 않는다.
//   그래서 포지션이 없을 때 이 값은 가만히 있고, 있을 때만 틱을 따라 움직인다
//   ⚠ 가용 잔고(availableBalance)와 더하지 말 것 — 저건 총자산에서 증거금을 **뺀** 값이라
//     더하면 증거금이 두 번 계산된다
export function totalEquity(walletBalance, position, price) {
  const wb = Number.isFinite(walletBalance) ? walletBalance : 0;
  return wb + totalUnrealized(position, price);
}
