// 연습 계좌의 일일 손실 한도 — 실거래(`backend/routes/dailyloss.js`)와 같은 규칙
//
// ── 왜 리플레이에도 필요한가 ─────────────────────────────────────────────
// 이 한도는 이 앱의 핵심 리스크 규칙이다(당일 시작 자본의 4%, UTC 0시 리셋).
// 연습에 그게 없으면 실전에서 막히는 매매를 연습에서는 계속 할 수 있게 되어,
// 정작 옮겨가야 할 습관이 안 생긴다. 그래서 페이퍼 계좌에도 똑같이 건다.
//
// ⚠ 기준 시각은 **재생 시각**이다. 벽시계로 하루를 끊으면 2024년을 재생하는 중에
//   오늘 자정마다 한도가 리셋된다.
//
// ── 실거래와 맞춘 부분 / 다른 부분 ───────────────────────────────────────
// `todayPnl`은 실현손익만 센다 — 백엔드가 Binance income의 REALIZED_PNL만 합산하기
// 때문이다(수수료·펀딩비는 별도 incomeType이라 빠진다). 숫자의 뜻이 두 모드에서
// 같아야 연습이 실전으로 옮겨가므로 일부러 맞췄다.
// 대신 당일 시작 자본은 로그로 정확히 계산한다(실거래는 잔고−손익이라 근사값이다).

export const DAILY_LOSS_PCT = 0.04;

export const utcDayStart = (ms) => {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * @returns { walletBalance, todayPnl, limit, remaining } — 실거래 응답과 같은 모양이라
 *   사이드바가 분기 없이 그대로 그린다
 */
export function computePaperDailyLoss(trades = [], startBalance = 0, balance = 0, nowMs = null) {
  if (nowMs == null) return null;
  const dayStart = utcDayStart(nowMs);

  let startOfDay = startBalance;   // 당일 0시 시점 잔고
  let todayPnl = 0;

  for (const r of trades) {
    if (r.t == null) continue;
    if (r.t < dayStart) {
      // 그날 이전의 모든 변동을 더해 당일 시작 잔고를 만든다
      if (r.kind === "close")        startOfDay += r.pnl - r.fee;
      else if (r.kind === "open")    startOfDay -= r.fee;
      else if (r.kind === "funding") startOfDay -= r.pay;
    } else if (r.kind === "close") {
      todayPnl += r.pnl;
    }
  }

  const limit = Math.max(0, startOfDay) * DAILY_LOSS_PCT;
  return {
    walletBalance: balance,
    todayPnl,
    limit,
    remaining: limit + todayPnl,   // todayPnl이 음수일 때 줄어든다
  };
}
