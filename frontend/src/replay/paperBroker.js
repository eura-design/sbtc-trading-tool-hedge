// 페이퍼 트레이딩 브로커 — 리플레이에서 가짜 돈으로 매매를 체결한다
//
// ── 왜 백엔드와 같은 모양을 내는가 ───────────────────────────────────────
// 스냅샷 3종(position / tpsl / balance)을 **백엔드 라우트와 글자 그대로 같은 형태**로
// 낸다. 그러면 사이드바·차트 오버레이·드래그 핸들이 리플레이인지 모른 채 그대로 돈다.
// 캔들을 useReplay가 useCandles와 같은 계약으로 낸 것과 같은 이유다.
// 필드를 하나라도 바꾸면 그 화면만 조용히 비어 보인다.
//
// ── 체결 판정: 구동 봉 하나씩 ────────────────────────────────────────────
// 엔진이 구동 봉(1h 리플레이면 5m)을 하나씩 밀어 넣고, 그 봉의 고가/저가에
// 주문 가격이 닿았는지로 체결을 정한다. 표시 봉(1h) 통째로 판정하는 것보다
// 12배 촘촘하다 — 이게 하위 TF 구동을 고른 이유다 (timeframes.js 실측 참고).
//
// ⚠ **구동 봉 안에서 TP와 SL이 둘 다 닿으면 SL을 먼저 체결한다.**
//   봉 하나 안의 순서는 OHLC만으로는 알 수 없다. 실측상 이런 봉은 0.5%뿐이고,
//   모를 때 유리한 쪽을 고르면 연습 성적이 실제보다 좋게 나온다.
//   과대평가보다 과소평가가 낫다는 판단이다 (timeframes.js에 같은 내용).
//
// ── 모델링한 것 / 안 한 것 ───────────────────────────────────────────────
// 한 것: 지정가·시장가 진입, TP/SL 자동 등록, 분할 TP, 추가 진입, 부분 청산,
//        수수료(메이커/테이커), 펀딩비, 청산(강제 종료), 갭 슬리피지
// 안 한 것: 호가창 깊이(대량 주문의 시장 충격), 부분 체결, 지정가 대기열 순서.
//        전부 "내 주문이 시장을 움직이지 않는다"는 가정이고, 개인 규모에서는 무난하다.

const TAKER_FEE = 0.0004;   // 시장가·SL·청산 (바이낸스 선물 기본)
const MAKER_FEE = 0.0002;   // 지정가·TP

const CLOSE_SIDE = { LONG: "SELL", SHORT: "BUY" };
const ENTRY_SIDE = { LONG: "BUY",  SHORT: "SELL" };

/** 유지증거금률 — 바이낸스 BTCUSDT 1구간(≤50k 명목) 근사값 */
const MAINT_MARGIN_RATE = 0.004;

export class PaperBroker {
  constructor({ startBalance = 10_000, fundingRates = [] } = {}) {
    this.startBalance = startBalance;
    this.balance = startBalance;        // 지갑 잔고 (실현손익·수수료 반영)
    this.fundingRates = fundingRates;   // [{ time, rate }] 오름차순
    this._fundIdx = 0;
    this._id = 1;

    this.pos     = { LONG: null, SHORT: null };  // { size, entryPrice, leverage }
    this.pending = { LONG: null, SHORT: null };
    this.tpsl    = { LONG: blankTpsl(), SHORT: blankTpsl() };
    this.scaleIns = [];                 // { orderId, positionSide, price, qty }

    this.trades = [];                   // 체결 로그 (5단계 통계용)
    this.events = [];                   // 마지막 onBar에서 일어난 일 (토스트용)
    this.lastPrice = null;
    this.lastTime = null;
  }

  nextId() { return String(this._id++); }

  // ── 주문 (orderSlice가 부른다) ─────────────────────────────────────────

  /** 진입. LIMIT은 pending으로 남고, MARKET은 즉시 체결된다 */
  placeEntry({ positionSide, orderType, entry, tp, sl, qty, leverage }) {
    if (!qty || qty <= 0) throw new Error("수량이 0입니다");
    if (this.pending[positionSide]) throw new Error("이미 미체결 진입 주문이 있습니다");

    if (orderType === "MARKET") {
      const price = this.lastPrice;
      if (price == null) throw new Error("아직 가격이 없습니다 — 재생을 한 틱 진행하세요");
      this._openPosition(positionSide, qty, price, leverage, TAKER_FEE, "MARKET 진입");
      this._setTpslFor(positionSide, tp, sl);
      return { orderId: this.nextId(), filled: true };
    }

    const orderId = this.nextId();
    this.pending[positionSide] = {
      orderId, side: ENTRY_SIDE[positionSide], price: entry, qty,
      status: "NEW", drawing: null, tp: tp ?? null, sl: sl ?? null,
      source: "system", leverage,
      // 체결 방향은 **걸 때의 시세** 기준으로 고정한다 — 나중에 시세가 반대편으로
      // 넘어가도 주문이 원래 어느 쪽에서 채워질 것이었는지는 변하지 않는다
      dir: limitDir(entry, this.lastPrice),
    };
    return { orderId, filled: false };
  }

  cancelPending(positionSide) {
    this.pending[positionSide] = null;
  }

  /** 포지션의 TP/SL 수정 (둘 중 준 것만 바꾼다) */
  setTpsl(positionSide, { tp, sl }) {
    const t = this.tpsl[positionSide];
    if (tp) t.tp = { orderId: this.nextId(), price: tp, isAlgo: false };
    if (sl) t.sl = { orderId: this.nextId(), price: sl, isAlgo: false };
    return { tp: t.tp, sl: t.sl };
  }

  addScaleIn({ positionSide, orderType, price, qty }) {
    if (!qty || qty <= 0) throw new Error("수량이 0입니다");
    if (orderType === "MARKET") {
      const p = this.lastPrice;
      if (p == null) throw new Error("아직 가격이 없습니다");
      const lev = this.pos[positionSide]?.leverage ?? 1;
      this._openPosition(positionSide, qty, p, lev, TAKER_FEE, "MARKET 추가 진입");
      return;
    }
    this.scaleIns.push({
      orderId: this.nextId(), positionSide, price, qty,
      dir: limitDir(price, this.lastPrice),
    });
    this.scaleIns.sort((a, b) => b.price - a.price);
  }

  cancelScaleIn(orderId) {
    this.scaleIns = this.scaleIns.filter(o => o.orderId !== orderId);
  }

  addSplitTp({ positionSide, price, qty, pct }) {
    const t = this.tpsl[positionSide];
    t.splitTps.push({ orderId: this.nextId(), price, qty, pct: pct ?? null, side: CLOSE_SIDE[positionSide] });
    t.splitTps.sort((a, b) => b.price - a.price);
    // 실거래와 동일: 분할 TP를 걸면 전량 TP는 내린다 (수량이 겹친다)
    t.tp = null;
  }

  cancelSplitTp(orderId) {
    for (const side of ["LONG", "SHORT"]) {
      this.tpsl[side].splitTps = this.tpsl[side].splitTps.filter(o => o.orderId !== orderId);
    }
  }

  /** 시장가 청산. qty를 주면 부분 청산 */
  close(positionSide, qty) {
    const p = this.pos[positionSide];
    if (!p) return;
    const price = this.lastPrice ?? p.entryPrice;
    const originalSize = p.size;
    const amount = Math.min(qty ?? originalSize, originalSize);
    const partial = amount < originalSize;
    this._closePosition(positionSide, amount, price, TAKER_FEE, "수동 청산");

    // ⚠ 부분 청산이면 **분할 TP를 잔여 비율로 다시 건다** — 실거래와 같다
    //   (backend/routes/close.js의 재등록 로직). 안 맞추면 절반을 손으로 닫은 뒤에도
    //   분할 TP가 원래 수량 그대로 남아, 합이 잔여 포지션보다 커진다. 그러면 첫 분할이
    //   포지션을 통째로 먹고 나머지가 조용히 증발해 **연습에서만 다르게 체결된다**.
    //   ※ 분할 TP가 스스로 체결됐을 때는 재조정하지 않는다 — 그쪽은 실거래에서도
    //     남은 주문을 건드리지 않는다 (reduceOnly끼리는 서로 모른다)
    if (!partial) return;
    const rest = this.pos[positionSide];
    const t = this.tpsl[positionSide];
    if (!rest || !t.splitTps.length) return;
    const ratio = rest.size / originalSize;
    let sum = 0;
    const scaled = [];
    t.splitTps.forEach((sp, i) => {
      // 마지막 항목은 반올림 오차가 쌓이지 않게 잔여에서 역산한다 (백엔드와 같은 규칙)
      const raw = i === t.splitTps.length - 1 ? Math.max(0, rest.size - sum) : sp.qty * ratio;
      const q = Math.round(raw * 1000) / 1000;
      if (q < 0.001) return;
      sum += q;
      scaled.push({ ...sp, qty: q, pct: Math.round((q / rest.size) * 100) });
    });
    t.splitTps = scaled;
  }

  // ── 시간 진행 ──────────────────────────────────────────────────────────

  /**
   * 구동 봉 하나를 처리한다. 순서가 중요하다:
   *   ① 펀딩비 ② 진입 체결 ③ 청산가 ④ 종료 주문(SL → TP)
   * 진입을 먼저 보는 이유는, 같은 봉에서 들어갔다가 바로 손절되는 일이
   * 실제로 일어나기 때문이다. 뒤로 미루면 그 손실이 사라진다.
   */
  onBar(bar) {
    this.events = [];
    // ⚠ **시각은 봉을 처리하기 전에 올린다.** 예전엔 맨 끝에서 올렸는데, 그러면 이 봉에서
    //   체결된 진입이 전부 **직전 봉의 시각**으로 기록된다. 두 가지가 깨졌다:
    //   ① 진입선 계단(entrySteps)이 구동봉 하나만큼 앞에서 시작한다
    //   ② 직전 계단과 시각이 같아져 `steps[last].t === lastTime` 병합 규칙에 걸려
    //      **추가 진입 계단이 통째로 사라졌다** (실측: 시장가 진입 100 → 98에 추가 두 번
    //      후 entrySteps가 `[{t:0, avg:98}]` 한 칸 — 진입가 100짜리 첫 칸이 덮였다)
    this.lastTime = bar.t;
    this._applyFunding(bar.t);
    this._fillEntries(bar);
    this._checkLiquidation(bar);
    this._fillExits(bar);
    this.lastPrice = bar.c;
    return this.events;
  }

  _applyFunding(barTime) {
    while (this._fundIdx < this.fundingRates.length
           && this.fundingRates[this._fundIdx].time <= barTime) {
      const { rate } = this.fundingRates[this._fundIdx++];
      for (const side of ["LONG", "SHORT"]) {
        const p = this.pos[side];
        if (!p) continue;
        // 롱은 rate>0일 때 지불, 숏은 반대
        const notional = p.size * (this.lastPrice ?? p.entryPrice);
        const pay = notional * rate * (side === "LONG" ? 1 : -1);
        this.balance -= pay;
        // 통계가 자본 곡선을 그리려면 **시간순 로그 하나**여야 한다.
        // 펀딩비만 따로 배열에 담으면 체결과 병합 정렬을 다시 해야 한다
        this.trades.push({ t: barTime, side, kind: "funding", pay, reason: "펀딩비" });
      }
    }
  }

  _fillEntries(bar) {
    for (const side of ["LONG", "SHORT"]) {
      const o = this.pending[side];
      if (o && reached(bar, o.price, o.dir)) {
        this.pending[side] = null;
        // 갭으로 지나쳤으면 시가에 체결된다 (지정가는 더 유리한 쪽으로 채워진다)
        const fill = o.dir === "down" ? Math.min(o.price, bar.o) : Math.max(o.price, bar.o);
        this._openPosition(side, o.qty, fill, o.leverage, MAKER_FEE, "지정가 진입 체결");
        this._setTpslFor(side, o.tp, o.sl);
      }
    }
    const remain = [];
    for (const s of this.scaleIns) {
      if (this.pos[s.positionSide] && reached(bar, s.price, s.dir)) {
        const lev = this.pos[s.positionSide].leverage;
        const fill = s.dir === "down" ? Math.min(s.price, bar.o) : Math.max(s.price, bar.o);
        this._openPosition(s.positionSide, s.qty, fill, lev, MAKER_FEE, "추가 진입 체결");
      } else remain.push(s);
    }
    this.scaleIns = remain;
  }

  _checkLiquidation(bar) {
    for (const side of ["LONG", "SHORT"]) {
      const p = this.pos[side];
      if (!p) continue;
      const liq = this._liqPrice(side);
      if (liq == null) continue;
      const hit = side === "LONG" ? bar.l <= liq : bar.h >= liq;
      if (!hit) continue;
      // 갭이면 청산가가 아니라 그 시가에 털린다 — SL과 같은 처리다.
      // 청산가에 그대로 체결시키면 갭 하락에서 손실이 실제보다 작게 나온다
      const fill = side === "LONG" ? Math.min(liq, bar.o) : Math.max(liq, bar.o);
      this._closePosition(side, p.size, fill, TAKER_FEE, "강제 청산");
      this.tpsl[side] = blankTpsl();
      this.events.push({ type: "liquidation", side });
    }
  }

  _fillExits(bar) {
    for (const side of ["LONG", "SHORT"]) {
      const p = this.pos[side];
      if (!p) continue;
      const t = this.tpsl[side];
      // 롱은 TP가 위·SL이 아래, 숏은 반대. 방향은 포지션이 정한다
      const tpDir = side === "LONG" ? "up" : "down";
      const slDir = side === "LONG" ? "down" : "up";

      // ⚠ SL을 먼저 본다 — 봉 하나 안의 순서를 모를 때의 보수적 선택
      if (t.sl && reached(bar, t.sl.price, slDir)) {
        // 갭: 봉이 SL 너머에서 시작하면 그 시가에 체결된다 (실제로 그렇게 밀린다)
        const fill = side === "LONG"
          ? Math.min(t.sl.price, bar.o)
          : Math.max(t.sl.price, bar.o);
        this._closePosition(side, p.size, fill, TAKER_FEE, "SL 체결");
        this.tpsl[side] = blankTpsl();
        this.events.push({ type: "sl", side, price: fill });
        continue;
      }

      if (t.tp && reached(bar, t.tp.price, tpDir)) {
        this._closePosition(side, p.size, t.tp.price, MAKER_FEE, "TP 체결");
        this.tpsl[side] = blankTpsl();
        this.events.push({ type: "tp", side, price: t.tp.price });
        continue;
      }

      const remain = [];
      for (const sp of t.splitTps) {
        const cur = this.pos[side];
        if (cur && reached(bar, sp.price, tpDir)) {
          const amount = Math.min(sp.qty, cur.size);
          this._closePosition(side, amount, sp.price, MAKER_FEE, "분할 TP 체결");
          this.events.push({ type: "split_tp", side, price: sp.price });
        } else remain.push(sp);
      }
      t.splitTps = remain;
      // 포지션이 다 닫혔으면 남은 종료 주문도 사라진다 (reduceOnly는 자동 취소된다)
      if (!this.pos[side]) this.tpsl[side] = blankTpsl();
    }
  }

  // ── 내부 ──────────────────────────────────────────────────────────────

  _openPosition(side, qty, price, leverage, feeRate, reason) {
    const cur = this.pos[side];
    const fee = qty * price * feeRate;
    this.balance -= fee;
    // entrySteps = [{ t, avg }] — **그 시각부터 유효했던 평단**. 차트 진입선을 계단으로
    // 긋는 데 쓴다 (PositionLines.jsx). 백엔드가 체결 이력에서 역산하는 값과 같은 모양이다
    // (services/entryTime.js) — 리플레이만 다른 모양이면 같은 화면에서 선이 달라 보인다.
    // ⚠ 진입 체결만 계단을 추가한다. **청산은 평단을 바꾸지 않으므로** _closePosition에는 없다
    if (!cur) {
      this.pos[side] = {
        size: qty, entryPrice: price, leverage: leverage || 1,
        entryTime: this.lastTime,
        entrySteps: [{ t: this.lastTime, avg: price }],
      };
    } else {
      // 평단 재계산 (entryTime은 최초 진입 그대로 둔다 — 계단의 첫 칸이 그 시각이다)
      const total = cur.size + qty;
      cur.entryPrice = (cur.entryPrice * cur.size + price * qty) / total;
      cur.size = total;
      const steps = cur.entrySteps ?? (cur.entrySteps = []);
      // 같은 시각의 분할 체결은 한 계단으로 합친다 (백엔드와 같은 규칙)
      if (steps.length && steps[steps.length - 1].t === this.lastTime) {
        steps[steps.length - 1].avg = cur.entryPrice;
      } else steps.push({ t: this.lastTime, avg: cur.entryPrice });
    }
    this.trades.push({ t: this.lastTime, side, kind: "open", qty, price, fee, reason });
  }

  _closePosition(side, qty, price, feeRate, reason) {
    const p = this.pos[side];
    if (!p) return;
    const amount = Math.min(qty, p.size);
    const pnl = (side === "LONG" ? price - p.entryPrice : p.entryPrice - price) * amount;
    const fee = amount * price * feeRate;
    this.balance += pnl - fee;
    p.size -= amount;
    this.trades.push({ t: this.lastTime, side, kind: "close", qty: amount, price, fee, pnl, reason });
    if (p.size <= 1e-9) {
      this.pos[side] = null;
      // 반대 주문들도 정리 — 실거래에서 reduceOnly가 자동 취소되는 것과 같다
      this.scaleIns = this.scaleIns.filter(s => s.positionSide !== side);
    }
  }

  _setTpslFor(side, tp, sl) {
    const t = this.tpsl[side];
    if (tp) t.tp = { orderId: this.nextId(), price: tp, isAlgo: false };
    if (sl) t.sl = { orderId: this.nextId(), price: sl, isAlgo: false };
  }

  /** 격리 근사 청산가 — 유지증거금을 뺀 나머지를 다 잃는 지점 */
  _liqPrice(side) {
    const p = this.pos[side];
    if (!p || !p.leverage) return null;
    const d = p.entryPrice * (1 / p.leverage - MAINT_MARGIN_RATE);
    const liq = side === "LONG" ? p.entryPrice - d : p.entryPrice + d;
    return liq > 0 ? liq : null;
  }

  usedMargin() {
    let m = 0;
    for (const side of ["LONG", "SHORT"]) {
      const p = this.pos[side];
      if (p) m += (p.size * p.entryPrice) / (p.leverage || 1);
    }
    return m;
  }

  unrealized(mark) {
    let u = 0;
    for (const side of ["LONG", "SHORT"]) {
      const p = this.pos[side];
      if (p) u += (side === "LONG" ? mark - p.entryPrice : p.entryPrice - mark) * p.size;
    }
    return u;
  }

  // ── 스냅샷 (백엔드 응답과 같은 모양) ───────────────────────────────────

  positionSnapshot(mark) {
    const price = mark ?? this.lastPrice ?? 0;
    const makePos = (side) => {
      const p = this.pos[side];
      if (!p) return null;
      return {
        size: p.size,
        entryPrice: p.entryPrice,
        unrealizedPnl: (side === "LONG" ? price - p.entryPrice : p.entryPrice - price) * p.size,
        leverage: p.leverage,
        liquidationPrice: this._liqPrice(side),
        entryTime:  p.entryTime  ?? null,
        entrySteps: p.entrySteps ?? null,
      };
    };
    const pend = (side) => {
      const o = this.pending[side];
      if (!o) return null;
      // leverage·dir은 내부 값이라 백엔드 응답에는 없다 — 모양을 맞추려고 뺀다
      const { leverage, dir, ...rest } = o;
      void leverage; void dir;
      return rest;
    };
    const longPending = pend("LONG"), shortPending = pend("SHORT");
    return {
      long:  makePos("LONG"),
      short: makePos("SHORT"),
      pending: (longPending || shortPending) ? { long: longPending, short: shortPending } : null,
      scaleInOrders: this.scaleIns.map(s => ({
        orderId: s.orderId, price: s.price, qty: s.qty, side: ENTRY_SIDE[s.positionSide],
      })),
      funding: { rate: 0, nextFundingTime: null },
    };
  }

  tpslSnapshot() {
    const one = (side) => ({
      tp: this.tpsl[side].tp,
      sl: this.tpsl[side].sl,
      splitTps: this.tpsl[side].splitTps.map(s => ({ ...s })),
    });
    return { long: one("LONG"), short: one("SHORT") };
  }

  balanceSnapshot(mark) {
    const price = mark ?? this.lastPrice ?? 0;
    return {
      walletBalance: this.balance,
      availableBalance: Math.max(0, this.balance - this.usedMargin()),
      crossUnPnl: this.unrealized(price),
    };
  }
}

function blankTpsl() { return { tp: null, sl: null, splitTps: [] }; }

// ── 체결 판정은 **방향이 있어야 한다** ────────────────────────────────────
// "봉의 고가~저가 안에 그 가격이 있는가"로 판정하면 **갭을 통째로 놓친다.**
// 롱 SL이 90인데 다음 봉이 85에서 갭 하락해 시작하면(고가 85, 저가 75)
// `75 <= 90 <= 85`가 거짓이라 손절이 체결되지 않고 포지션이 살아남는다.
// 실제로는 갭 시가에 밀려서 체결되고, 손실은 오히려 더 크다.
//
// ⚠ 이 오류는 **연습 성적을 실제보다 좋게** 만든다 — 손절만 조용히 건너뛰므로.
//   그래서 "닿았나"가 아니라 "그 방향으로 지나갔나"로 본다.

/** 가격이 그 아래로 내려갔는가 (위에서 접근하는 주문 — 롱 SL·매수 지정가) */
function crossedDown(bar, price) { return price != null && bar.l <= price; }

/** 가격이 그 위로 올라갔는가 (아래에서 접근하는 주문 — 롱 TP·매도 지정가) */
function crossedUp(bar, price) { return price != null && bar.h >= price; }

/** 주문이 걸린 방향으로 지나갔는가. dir: "down" | "up" */
function reached(bar, price, dir) {
  return dir === "down" ? crossedDown(bar, price) : crossedUp(bar, price);
}

/**
 * 지정가 주문이 어느 방향에서 체결되는지 — 걸 때의 시세와 비교해 정한다.
 * 시세보다 아래에 걸면 값이 내려와야 체결되고, 위에 걸면 올라가야 체결된다.
 */
function limitDir(price, marketPrice) {
  if (marketPrice == null) return price != null ? "down" : "down";
  return price <= marketPrice ? "down" : "up";
}

export const _test = { crossedDown, crossedUp, reached, limitDir, TAKER_FEE, MAKER_FEE };
