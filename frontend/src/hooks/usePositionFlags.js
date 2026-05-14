// position 객체에서 자주 쓰이는 파생값을 한 곳에서 계산
export function derivePositionFlags(position) {
  const hasLong  = !!position?.long;
  const hasShort = !!position?.short;
  const longPendingExists  = !!position?.pending?.long;
  const shortPendingExists = !!position?.pending?.short;
  return {
    hasLong, hasShort,
    hasPos:   hasLong || hasShort,
    hasBoth:  hasLong && hasShort,
    longPendingExists,
    shortPendingExists,
    hasPending:  longPendingExists || shortPendingExists,
    drawLocked: (hasLong || longPendingExists) && (hasShort || shortPendingExists),
  };
}
