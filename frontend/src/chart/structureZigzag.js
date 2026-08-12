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
  // 초기화 = 과거 전 구간을 다시 훑어 CHoCH를 무더기로 재생산한다는 뜻.
  // 알림 쪽이 이걸 "새 발생"으로 오해하지 않도록 세대 번호를 올린다
  // (TF 전환·파라미터 변경 직후 알림이 터지는 것을 막는 유일한 신호다).
  _gen++;
  return {
    arr: candles, params, firstT, p,
    atr: wilderATR(candles, p.atr_period),
    // 로드된 캔들 전체를 잇는다 (표시 범위 옵션 없음 — 2026-08-12 사용자 요청으로 scan_from 제거).
    // 최초 1회만 전 구간을 훑고 이후는 증분 처리라 비용은 무시할 수준.
    i: p.left_bars,                              // 다음에 처리할 봉

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

/**
 * CHoCH 가로선을 어디서 끊을지 — **레그 선분과 레벨의 교차점**(bar index, 소수 허용).
 * `deriveStructure.js`의 crossT와 같은 규칙이다. 한쪽만 바꾸면 두 지표가 어긋난다.
 *
 * ── 왜 "실제로 뚫은 봉(i)"이 아닌가 (2026-08-12 수정) ─────────────────────
 * 화면에 그려진 건 캔들이 아니라 꼭짓점을 이은 직선 지그재그다. 둘은 어긋난다.
 * 고점 110 → 저점 85 레그에서 레벨이 90이면 직선은 80% 지점에서 90을 지나지만,
 * 실제 가격은 90 위에서 뭉개다 레그 끝에서야 깨는 경우가 흔하다. 피벗 봉으로 끊으면
 * 그 차이만큼 **가로선이 지그재그를 지나 오른쪽으로 삐져나온다**(사용자 지적).
 * 선분 교차점은 정의상 두 꼭짓점 사이에 들어가므로 어떤 데이터·TF에서도 안 삐져나온다.
 */
function crossIdx(i1, p1, i2, p2, level) {
  const dp = p2 - p1;
  if (dp === 0) return i2;
  const a = Math.min(1, Math.max(0, (level - p1) / dp));
  return i1 + a * (i2 - i1);
}

function pushSegment(st, seg) {
  st.segments.push(seg);
  if (st.segments.length > MAX_SEGMENTS) st.segments.shift();
}

function pushChoch(st, ev) {
  // seq는 상태가 초기화돼도 계속 증가하는 전역 일련번호 — 알림(useChochAlert)이
  // "이번에 새로 찍힌 것"을 판별하는 데 쓴다. 배열 인덱스는 shift 때문에 못 쓴다.
  ev.seq = ++_seq;
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
          // seg = 이 CHoCH가 속한 레그. 끝점이 계속 연장되므로 가로선 끝(toIdx)과
          // 실선/점선 여부는 저장하지 않고 computeStructureZigzag가 매번 파생한다.
          pushChoch(st, { dir: "bull", fromIdx: st.structHighBar, price: st.structHigh, seg: st.curSeg });
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
            pushChoch(st, { dir: "bull", fromIdx: st.structHighBar, price: st.structHigh, seg: st.curSeg });
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
          pushChoch(st, { dir: "bear", fromIdx: st.structLowBar, price: st.structLow, seg: st.curSeg });
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
            pushChoch(st, { dir: "bear", fromIdx: st.structLowBar, price: st.structLow, seg: st.curSeg });
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

let _st  = null;
let _gen = 0;   // 상태 초기화 세대 (TF 전환·파라미터 변경 시 증가)
let _seq = 0;   // CHoCH 누적 일련번호 (초기화돼도 계속 증가)

/**
 * 현재 누적된 CHoCH 총 개수 (max_choch 슬라이스 이전의 원본 개수).
 *
 * IndicatorMenu의 "검출 N개" 표시와, 더블클릭 팝업의 CHoCH 개수 슬라이더 상한(1~N).
 * ZZ 계산이 캔버스 렌더 경로에서만 돌아 React 상태로 올라오지 않으므로,
 * 메뉴가 열릴 때 이 함수로 모듈 상태를 직접 읽는다(메뉴 열려 있는 동안은 갱신 안 됨).
 * ZZ가 꺼져 있으면 계산 자체가 안 돌아 0을 반환한다.
 */
export function getZzChochTotal() {
  return _st?.chochs.length ?? 0;
}

/**
 * 현재 누적된 지그재그 세그먼트 `[{ i1, p1, i2, p2 }]` (좌표는 **bar index**).
 *
 * 레그 등락률 hover 표시(hitDetection.findHoveredLegPct)가 히트 판정에 쓴다.
 * ZZ는 캔버스 렌더 경로에만 있어 React로 올라오지 않으므로 모듈 상태를 직접 읽는다.
 * 마지막 세그먼트는 진행 중인 레그(curSeg)라 매 틱 끝점이 연장된다.
 * ZZ가 꺼져 있으면 계산 자체가 안 돌아 빈 배열이다.
 */
export function getZzSegments() {
  return _st?.segments ?? [];
}

/**
 * CHoCH 알림용 신호 — `{ gen, last }`.
 *   gen  : 상태 초기화 세대. 값이 바뀌었으면 과거 구간을 재계산한 것이므로
 *          알림 쪽은 **소리 없이 기준선만 다시 잡아야 한다**.
 *   last : 마지막 CHoCH `{ seq, dir, price, ... }` | null.
 *          같은 gen 안에서 seq가 커졌으면 그게 방금 발생한 CHoCH다.
 *
 * 개수(getZzChochTotal) 비교로는 안 된다 — MAX_CHOCHS를 넘으면 shift로
 * 앞이 잘려나가 길이가 그대로여도 새 CHoCH가 찍힐 수 있다.
 */
export function getZzChochSignal() {
  const arr = _st?.chochs;
  return { gen: _gen, last: arr?.length ? arr[arr.length - 1] : null };
}

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
  if (!show_choch) return { segments: _st.segments, chochs: [] };
  // null/미설정 = 제한 없음. slice(-Infinity)는 배열 전체를 준다.
  // 기본을 숫자로 두면 낮춰둔 걸 잊고 "CHoCH가 안 뜬다"고 오해한다 (Structures.jsx [R6])
  const max_choch = params.max_choch > 0 ? params.max_choch : Infinity;

  // 가로선 끝(toIdx)과 실선/점선은 **저장하지 않고 매번 파생한다** — 진행 중 레그는
  // 끝점이 계속 연장되므로 교차점도 같이 움직여야 지그재그 밖으로 안 삐져나온다.
  // 누적 기록(_st.chochs)은 손대지 않으므로 forward-only 원칙은 그대로다.
  return {
    segments: _st.segments,
    chochs: _st.chochs.slice(-max_choch).map(ev => ({
      dir:   ev.dir,
      price: ev.price,
      fromIdx: ev.fromIdx,
      toIdx: ev.seg ? crossIdx(ev.seg.i1, ev.seg.p1, ev.seg.i2, ev.seg.p2, ev.price) : ev.fromIdx,
      // 아직 연장 중인 레그(curSeg)에서 나온 CHoCH = 진행 중 → 점선.
      // 다음 피벗으로 레그가 확정되면 curSeg가 교체돼 자동으로 실선이 된다.
      // (수동 구조의 ev.live와 같은 의미 — Structures.jsx [R5])
      live:  ev.seg != null && ev.seg === _st.curSeg,
    })),
  };
}
