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
// ── ⚠ "거래 1건" = **포지션 1개**다 (2026-08-19 변경) ───────────────────
// 진입해서 **전량 청산될 때까지**가 한 건이다. 그 안의 분할 TP·부분 청산은
// 몇 번이 되든 승패를 하나만 만든다. 청산 횟수는 `fills`에 따로 남는다.
//
// ⚠ **되돌리지 말 것 — 청산 단위로 세면 승률이 매매 실력이 아니라 "주문을 몇 조각으로
//   쪼갰는가"를 잰다.** 분할 TP는 여러 개 걸 수 있는데 SL은 하나뿐이라 비대칭이다.
//   실측(수정 전 코드):
//     LONG 4 BTC · 분할TP 100.5/101/101.5 각 1개 · SL 97 → 분할 3개 체결 후 나머지 SL
//     → 거래 4건 · 승 3 · 패 1 · **승률 75.0%** · 순손익 **−$0.26**
//   돈을 잃은 한 번의 매매가 75% 승률로 찍혔다. 5분할이면 같은 매매가 83%가 된다.
//
// ※ 예전 근거("포지션 단위로 묶으면 절반 익절 + 절반 손절이 뭉개진다")도 맞는 말이라
//   버리지 않았다 — 그 정보는 `fills`(청산 건수)가 들고 있고, 사이드바에도 나온다.
//   승/패만 포지션 단위로 옮긴 것이다.
//
// ── 포지션 하나의 순손익에 무엇이 들어가나 ───────────────────────────────
// 그 포지션이 살아 있던 동안의 **청산 손익 − 청산 수수료 − 진입 수수료 − 펀딩비**.
// 진입 수수료와 펀딩비까지 넣는 이유는 위 "수수료를 뺀 뒤" 규칙의 연장이다 —
// 오래 들고 있어 펀딩비로 까먹은 거래를 "승"이라 부르면 안 된다.

export function computeTradeStats(trades = [], startBalance = 0) {
  const s = {
    trades: 0,        // 완결된 포지션 수 (= 승 + 패)
    fills: 0,         // 청산 체결 건수 — 분할 TP·부분 청산을 몇 번 했는지
    open: 0,          // 아직 안 닫힌 포지션 수 (승패에 안 들어간다)
    wins: 0, losses: 0, winRate: null,
    grossPnl: 0, totalFee: 0, totalFunding: 0, netPnl: 0,
    avgWin: 0, avgLoss: 0, profitFactor: null,
    maxDrawdown: 0, maxDrawdownPct: null,
    bestTrade: null, worstTrade: null,
    liquidations: 0,
  };

  let equity = startBalance;
  let peak = startBalance;
  let winSum = 0, lossSum = 0;

  // 사이드별로 "지금 열려 있는 포지션"을 하나씩 들고 간다.
  // size가 0 → 양수가 되면 새 포지션이 시작되고, 0으로 돌아오면 끝난다.
  // (추가 진입·부분 청산은 같은 포지션 안의 사건이다)
  const live = { LONG: null, SHORT: null };
  const startPos = () => ({ size: 0, net: 0, liq: false });

  const finish = (side) => {
    const p = live[side];
    if (!p) return;
    live[side] = null;
    s.trades++;
    if (p.net > 0) { s.wins++; winSum += p.net; }
    else { s.losses++; lossSum += p.net; }
    if (s.bestTrade  === null || p.net > s.bestTrade)  s.bestTrade  = p.net;
    if (s.worstTrade === null || p.net < s.worstTrade) s.worstTrade = p.net;
    if (p.liq) s.liquidations++;
  };

  for (const r of trades) {
    if (r.kind === "funding") {
      s.totalFunding += r.pay;
      equity -= r.pay;
      // 펀딩비는 포지션이 있을 때만 기록되므로 살아 있는 쪽에 붙는다
      if (live[r.side]) live[r.side].net -= r.pay;

    } else if (r.kind === "open") {
      s.totalFee += r.fee;
      equity -= r.fee;
      if (!live[r.side]) live[r.side] = startPos();
      live[r.side].size += r.qty;
      live[r.side].net  -= r.fee;

    } else if (r.kind === "close") {
      const net = r.pnl - r.fee;
      s.fills++;
      s.grossPnl += r.pnl;
      s.totalFee += r.fee;
      equity += net;

      // 진입 기록 없이 청산만 있는 로그(옛 세션 복원 등)는 그 청산 하나를
      // 포지션 하나로 본다 — 통째로 버리면 성적이 조용히 줄어든다
      if (!live[r.side]) live[r.side] = startPos();
      const p = live[r.side];
      p.size -= r.qty;
      p.net  += net;
      if (r.reason === "강제 청산") p.liq = true;
      if (p.size <= 1e-9) finish(r.side);
    }

    // 자본 곡선의 고점 대비 낙폭 — 청산·수수료·펀딩비를 전부 반영한 뒤에 잰다
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > s.maxDrawdown) {
      s.maxDrawdown = dd;
      s.maxDrawdownPct = peak > 0 ? (dd / peak) * 100 : null;
    }
  }

  // ⚠ 아직 안 닫힌 포지션은 **승패에 넣지 않는다.** 미실현은 확정된 결과가 아니라
  //   재생을 한 틱만 더 돌려도 부호가 바뀐다. 대신 몇 개가 열려 있는지는 알려준다
  for (const side of ["LONG", "SHORT"]) if (live[side]) s.open++;

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
