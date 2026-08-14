// 연습 세션 성적 — paperBroker.trades[] 하나로 전부 계산한다
//
// 순수 함수라 node에서 바로 검산한다 (pivotLevels.js·fib.js와 같은 이유).
//
// ── 로그 형태 ────────────────────────────────────────────────────────────
//   { kind:"open",    t, side, qty, price, fee }
//   { kind:"close",   t, side, qty, price, fee, pnl }
//   { kind:"funding", t, side, pay }
// 시간순 한 줄이라 자본 곡선을 그대로 그릴 수 있다.
//
// ── ⚠ 승패는 **수수료를 뺀 뒤**로 가른다 ────────────────────────────────
// 총손익(pnl)만 보면 +$0.50 벌고 수수료 $4 낸 거래가 "승"으로 잡힌다.
// 실제로는 잃은 거래고, 승률이 부풀면 연습의 의미가 없다.
//
// ── ⚠ "거래 1건" = **청산 1건**이다 ─────────────────────────────────────
// 분할 TP·부분 청산이 있어서 포지션 하나가 여러 번에 나눠 닫힌다.
// 포지션 단위로 묶으면 "절반 익절 + 절반 손절"이 승/패 하나로 뭉개져
// 어느 쪽이 얼마였는지가 사라진다. 청산 단위가 더 많은 정보를 남긴다.

export function computeTradeStats(trades = [], startBalance = 0) {
  const s = {
    trades: 0, wins: 0, losses: 0, winRate: null,
    grossPnl: 0, totalFee: 0, totalFunding: 0, netPnl: 0,
    avgWin: 0, avgLoss: 0, profitFactor: null,
    maxDrawdown: 0, maxDrawdownPct: null,
    bestTrade: null, worstTrade: null,
    liquidations: 0,
  };

  let equity = startBalance;
  let peak = startBalance;
  let winSum = 0, lossSum = 0;

  for (const r of trades) {
    if (r.kind === "funding") {
      s.totalFunding += r.pay;
      equity -= r.pay;
    } else if (r.kind === "open") {
      s.totalFee += r.fee;
      equity -= r.fee;
    } else if (r.kind === "close") {
      const net = r.pnl - r.fee;
      s.trades++;
      s.grossPnl += r.pnl;
      s.totalFee += r.fee;
      equity += net;

      if (net > 0) { s.wins++; winSum += net; }
      else { s.losses++; lossSum += net; }

      if (s.bestTrade  === null || net > s.bestTrade)  s.bestTrade  = net;
      if (s.worstTrade === null || net < s.worstTrade) s.worstTrade = net;
      if (r.reason === "강제 청산") s.liquidations++;
    }

    // 자본 곡선의 고점 대비 낙폭 — 청산·수수료·펀딩비를 전부 반영한 뒤에 잰다
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > s.maxDrawdown) {
      s.maxDrawdown = dd;
      s.maxDrawdownPct = peak > 0 ? (dd / peak) * 100 : null;
    }
  }

  s.netPnl = s.grossPnl - s.totalFee - s.totalFunding;
  if (s.trades > 0) s.winRate = (s.wins / s.trades) * 100;
  if (s.wins   > 0) s.avgWin  = winSum / s.wins;
  if (s.losses > 0) s.avgLoss = lossSum / s.losses;
  // 손실이 0이면 무한대다 — 숫자로 만들지 않고 null로 둔다.
  // "∞"를 띄우면 표본 2건짜리 세션이 완벽한 전략처럼 보인다
  if (lossSum < 0) s.profitFactor = winSum / Math.abs(lossSum);

  return s;
}

/** 자본 곡선 — 스파크라인용 (지금은 미사용, 통계 검산에 쓴다) */
export function equityCurve(trades = [], startBalance = 0) {
  const out = [{ t: trades[0]?.t ?? 0, equity: startBalance }];
  let equity = startBalance;
  for (const r of trades) {
    if (r.kind === "funding") equity -= r.pay;
    else if (r.kind === "open") equity -= r.fee;
    else if (r.kind === "close") equity += r.pnl - r.fee;
    else continue;
    out.push({ t: r.t, equity });
  }
  return out;
}
