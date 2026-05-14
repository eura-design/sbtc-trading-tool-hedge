// 헷지모드 side 매핑 헬퍼
// 진입 side(BUY/SELL) → positionSide(LONG/SHORT)
const sideToPosition  = (s) => s === "BUY"  ? "LONG"  : "SHORT";

// positionSide(LONG/SHORT) → 진입 side(BUY/SELL)
const positionToSide  = (p) => p === "LONG" ? "BUY"   : "SELL";

// close side(SELL/BUY) → positionSide(LONG/SHORT)
//   SELL = LONG 포지션 종료,  BUY = SHORT 포지션 종료
const closeToPosition = (s) => s === "SELL" ? "LONG"  : "SHORT";

// positionSide(LONG/SHORT) → close side(SELL/BUY)
const positionToClose = (p) => p === "LONG" ? "SELL"  : "BUY";

module.exports = { sideToPosition, positionToSide, closeToPosition, positionToClose };
