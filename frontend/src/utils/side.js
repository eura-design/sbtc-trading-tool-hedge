// 헷지모드 side 매핑 헬퍼
// 진입 side(BUY/SELL) → positionSide(LONG/SHORT)
export const sideToPosition  = (s) => s === "BUY"  ? "LONG"  : "SHORT";

// positionSide(LONG/SHORT) → 진입 side(BUY/SELL)
export const positionToSide  = (p) => p === "LONG" ? "BUY"   : "SELL";

// close side(SELL/BUY) → positionSide(LONG/SHORT)
//   SELL = LONG 포지션 종료,  BUY = SHORT 포지션 종료
export const closeToPosition = (s) => s === "SELL" ? "LONG"  : "SHORT";

// positionSide(LONG/SHORT) → close side(SELL/BUY)
export const positionToClose = (p) => p === "LONG" ? "SELL"  : "BUY";

// isLong(boolean) → positionSide(LONG/SHORT)
export const isLongToPosition = (b) => b ? "LONG" : "SHORT";

// isLong(boolean) → 진입 side(BUY/SELL)
export const isLongToSide     = (b) => b ? "BUY"  : "SELL";
