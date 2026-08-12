// Structure Zigzag (CHoCH Style) — `기타/structure_zigzag.pine` 포팅
//
// 오른쪽 확인봉(rightBars) 없이 왼쪽 left_bars 봉만 보고 해당 봉에서 즉시 피벗 판단:
//   ph = high > highest(high[1], leftBars)   ← 꼬리(고가/저가) 기준, 종가 아님
//   pl = low  < lowest(low[1],  leftBars)
//
// ── 왜 훅이 아니라 chart/의 순수 함수인가 ──────────────────────────────────
// useCandles는 진행 중 봉의 틱을 React 상태에 반영하지 않고 candlesRef만 갱신한다.
// 진행 중 봉에서도 실시간으로 CHoCH가 뜨려면 틱 RAF가 도는 캔버스 렌더 경로에서
// candlesRef.current로 직접 계산해야 하므로 candleRenderer가 이 함수를 호출한다.
//
// ── 실시간이면서 repaint는 없는 이유 (핵심) ────────────────────────────────
// 매 틱 전체 재계산이 아니라 **상태를 누적하며 앞으로만 진행**한다(forward-only).
// 한번 기록된 CHoCH/세그먼트는 어떤 경우에도 제거하지 않는다.
//
// 전체 재계산 방식이었다면 진행 중 봉의 ATR(변동폭)이 커지면서 노이즈 필터 임계값이
// 올라가 직전 틱에 통과했던 CHoCH가 탈락 → 화면에서 사라진다. 그걸 막는 게 이 구조다.
//
// 같은 봉을 매 틱 다시 step() 해도 안전한 근거:
//   - 진행 중 봉의 고가는 단조 증가, 저가는 단조 감소 (되돌아가지 않음)
//   - 값이 그대로면 `ph > lastPointPrice`가 false → 아무 일도 일어나지 않음 (멱등)
//   - 값이 갱신됐으면 기존 꼭짓점을 "연장"할 뿐, 이미 찍힌 마크는 건드리지 않음
//
// 전체 재계산(= 기록 초기화)은 다음 경우에만 발생한다:
//   캔들 배열 교체(타임프레임 전환) / 파라미터 변경 / candles[0] 변경(버퍼 shift·재로드)

const EMPTY = { segments: [], chochs: [] };

// 장시간 세션에서 무한 증가 방지 (표시용 슬라이스와 별개인 원본 보관 한도)
const MAX_SEGMENTS = 2000;
const MAX_CHOCHS   = 500;

function resolve(params) {
  return {
    left_bars:  params.left_bars  ?? 5,
    use_filter: params.use_filter ?? true,
    atr_mult:   params.atr_mult   ?? 1.5,
    atr_period: params.atr_period ?? 14,
    scan_from:  params.scan_from  ?? 500,
  };
}

function trueRange(candles, i) {
  const c = candles[i];
  if (i === 0) return c.h - c.l;
  const pc = candles[i - 1].c;
  return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
}

// Wilder's ATR (Pine `ta.atr` = RMA of True Range, SMA 시드) — 초기 구축용 전체 계산
function wilderATR(candles, period) {
  const n   = candles.length;
  const atr = new Array(n).fill(NaN);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const tr = trueRange(candles, i);
    if (i < period) {
      sum += tr;
      if (i === period - 1) atr[i] = sum / period;
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + tr) / period;
    }
  }
  return atr;
}

// 진행 중 봉의 ATR은 직전(확정) 봉 값에서 매번 다시 구한다 — 확정 값은 훼손하지 않음
function atrAt(st, candles, i, period) {
  if (i < period) return st.atr[i] ?? NaN;
  const prev = st.atr[i - 1];
  if (Number.isNaN(prev) || prev === undefined) return NaN;
  const v = (prev * (period - 1) + trueRange(candles, i)) / period;
  st.atr[i] = v;
  return v;
}

function initState(candles, params, firstT) {
  const p = resolve(params);
  const n = candles.length;
  return {
    arr: candles, params, firstT, p,
    atr: wilderATR(candles, p.atr_period),
    i: Math.max(p.left_bars, n - p.scan_from),   // 다음에 처리할 봉

    lastPivotType:  0,      // 1 = High, -1 = Low
    lastPointPrice: NaN,
    lastPointBar:   -1,
    structHigh:     NaN, structHighBar: -1,
    structLow:      NaN, structLowBar:  -1,
    bias:           0,      // 1 = 상승, -1 = 하락
    chochInLeg:     false,
    curSeg:         null,   // Pine의 zzLine — 같은 방향 연장 시 끝점만 갱신

    segments: [],
    chochs:   [],
  };
}

function pushSegment(st, seg) {
  st.segments.push(seg);
  if (st.segments.length > MAX_SEGMENTS) st.segments.shift();
}

function pushChoch(st, ev) {
  st.chochs.push(ev);
  if (st.chochs.length > MAX_CHOCHS) st.chochs.shift();
}

// 봉 하나를 상태에 반영. 되돌리는 동작은 없음 — 기록은 추가되기만 한다.
function step(st, candles, i) {
  const p = st.p;
  const c = candles[i];

  let hh = -Infinity, ll = Infinity;
  for (let j = 1; j <= p.left_bars; j++) {
    const q = candles[i - j];
    if (q.h > hh) hh = q.h;
    if (q.l < ll) ll = q.l;
  }
  const ph = c.h > hh ? c.h : null;
  const pl = c.l < ll ? c.l : null;
  if (ph === null && pl === null) return;

  // 스윙폭이 ATR × 배수 미만이면 노이즈로 간주 (ATR 미확정 구간은 통과)
  const passes = (price) => {
    if (!p.use_filter || Number.isNaN(st.lastPointPrice)) return true;
    const a = atrAt(st, candles, i, p.atr_period);
    if (Number.isNaN(a)) return true;
    return Math.abs(price - st.lastPointPrice) >= a * p.atr_mult;
  };

  // ── High Pivot ────────────────────────────────────────────────────────────
  if (ph !== null) {
    if (st.lastPivotType !== 1) {
      if (passes(ph)) {
        if (st.lastPivotType === -1) { st.structLow = st.lastPointPrice; st.structLowBar = st.lastPointBar; }
        st.lastPivotType = 1;

        // bias는 "실제 돌파"가 있을 때만 세운다 (2026-08-12 수정, Pine 원본도 동일하게 수정).
        // 예전에는 structHigh가 NaN이라는 이유만으로 bias=1을 세웠고, 그래서
        // 고점100 → 저점90 → 고점110 같은 단순 상승에서도 첫 CHoCH가 찍혔다.
        // 하락 추세가 성립한 적이 없으므로 그건 BOS이지 CHoCH가 아니다.
        // ※ Custom Structure Zigzag(deriveStructure.js)와 같은 규칙이다 — 한쪽만 되돌리지 말 것.
        let isChoch = false;
        if (!Number.isNaN(st.structHigh) && ph > st.structHigh) {
          if (st.bias === -1) isChoch = true;
          st.bias = 1;
        }

        if (st.lastPointBar >= 0) {
          st.curSeg = { i1: st.lastPointBar, p1: st.lastPointPrice, i2: i, p2: ph };
          pushSegment(st, st.curSeg);
        }
        if (isChoch && st.structHighBar >= 0) {
          pushChoch(st, { dir: "bull", fromIdx: st.structHighBar, toIdx: i, price: st.structHigh });
        }

        st.chochInLeg     = isChoch;
        st.lastPointPrice = ph;
        st.lastPointBar   = i;
      }
    } else if (ph > st.lastPointPrice) {
      // 같은 방향(고점) 갱신 → 기존 지그재그 선 끝점만 연장
      if (st.curSeg) { st.curSeg.i2 = i; st.curSeg.p2 = ph; }

      // 돌파했으면 bias는 **항상** 갱신한다(= BOS). CHoCH 마크는 반대 추세였을 때만.
      // ※ bias 갱신을 CHoCH 조건 안에 두면, bias=0 상태에서 이 연장 분기로 구조 고점을
      //   돌파했을 때 추세가 영영 서지 않아 이후 진짜 전환도 CHoCH로 안 잡힌다.
      //   (위 메인 분기와 동일한 구조로 맞춘 것 — 한쪽만 되돌리지 말 것)
      if (!Number.isNaN(st.structHigh) && ph > st.structHigh) {
        if (!st.chochInLeg && st.bias === -1) {
          if (st.structHighBar >= 0) {
            pushChoch(st, { dir: "bull", fromIdx: st.structHighBar, toIdx: i, price: st.structHigh });
          }
          st.chochInLeg = true;
        }
        st.bias = 1;
      }

      st.lastPointPrice = ph;
      st.lastPointBar   = i;
    }
  }

  // ── Low Pivot ─────────────────────────────────────────────────────────────
  if (pl !== null) {
    if (st.lastPivotType !== -1) {
      if (passes(pl)) {
        if (st.lastPivotType === 1) { st.structHigh = st.lastPointPrice; st.structHighBar = st.lastPointBar; }
        st.lastPivotType = -1;

        // 고점 로직과 동일 — 실제 돌파가 있을 때만 bias를 세운다 (2026-08-12 수정)
        let isChoch = false;
        if (!Number.isNaN(st.structLow) && pl < st.structLow) {
          if (st.bias === 1) isChoch = true;
          st.bias = -1;
        }

        if (st.lastPointBar >= 0) {
          st.curSeg = { i1: st.lastPointBar, p1: st.lastPointPrice, i2: i, p2: pl };
          pushSegment(st, st.curSeg);
        }
        if (isChoch && st.structLowBar >= 0) {
          pushChoch(st, { dir: "bear", fromIdx: st.structLowBar, toIdx: i, price: st.structLow });
        }

        st.chochInLeg     = isChoch;
        st.lastPointPrice = pl;
        st.lastPointBar   = i;
      }
    } else if (pl < st.lastPointPrice) {
      if (st.curSeg) { st.curSeg.i2 = i; st.curSeg.p2 = pl; }

      // 고점 연장 분기와 동일 — 돌파하면 bias는 항상 갱신, CHoCH는 반대 추세였을 때만
      if (!Number.isNaN(st.structLow) && pl < st.structLow) {
        if (!st.chochInLeg && st.bias === 1) {
          if (st.structLowBar >= 0) {
            pushChoch(st, { dir: "bear", fromIdx: st.structLowBar, toIdx: i, price: st.structLow });
          }
          st.chochInLeg = true;
        }
        st.bias = -1;
      }

      st.lastPointPrice = pl;
      st.lastPointBar   = i;
    }
  }
}

let _st = null;

export function computeStructureZigzag(candles, params = {}) {
  const n = candles.length;
  if (n < 2) return EMPTY;

  const left_bars = params.left_bars ?? 5;
  if (n < left_bars + 2) return EMPTY;

  // 누적 상태를 버려야 하는 경우에만 초기화 (그 외에는 절대 재계산하지 않음)
  const firstT = +candles[0].t;
  if (!_st || _st.arr !== candles || _st.params !== params || _st.firstT !== firstT) {
    _st = initState(candles, params, firstT);
  }

  // 마지막 호출 이후의 봉 + 진행 중 봉을 처리.
  // 진행 중 봉(n-1)은 매 틱 다시 처리되지만 step()이 멱등이라 중복 반영되지 않는다.
  for (let i = _st.i; i < n; i++) step(_st, candles, i);
  _st.i = n - 1;

  const show_choch = params.show_choch ?? true;
  const max_choch  = params.max_choch  ?? 10;
  return {
    segments: _st.segments,
    chochs:   show_choch ? _st.chochs.slice(-max_choch) : [],
  };
}
