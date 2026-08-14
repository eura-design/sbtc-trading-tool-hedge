// 캔들 SoA(Structure of Arrays) — 리플레이가 다루는 봉 수가 만 단위를 넘기 때문
//
// ── 왜 객체 배열을 안 쓰나 ────────────────────────────────────────────────
// useCandles가 쓰는 `{ t: Date, o, h, l, c, v }`는 봉당 100바이트를 훌쩍 넘는다
// (Date 객체 하나가 특히 비싸다). 5m 전체 히스토리는 상장일(2019-09-08)부터
// ≈729,000봉이라 그대로 담으면 100MB를 넘기고 전부 GC 대상이 된다.
// Float64Array 6개로 두면 같은 데이터가 봉당 48바이트, 총 35MB다.
//
// 렌더러·지표는 전부 객체 배열을 기대하므로 **화면에 올라가는 구간만**
// soaToCandles로 되돌린다. 그 구간은 지금 useCandles가 들고 있는 3000봉과 같은 규모라
// 기존 렌더 경로에 추가 부담이 없다.
//
// ── import 없음 ──────────────────────────────────────────────────────────
// pivotLevels.js·fib.js와 같은 이유다. node에서 바로 import해 실제 응답으로 검산한다.

const FIELDS = ["t", "o", "h", "l", "c", "v"];

export function createSoA(n) {
  return {
    n,
    t: new Float64Array(n),
    o: new Float64Array(n),
    h: new Float64Array(n),
    l: new Float64Array(n),
    c: new Float64Array(n),
    v: new Float64Array(n),
  };
}

export const EMPTY_SOA = createSoA(0);

/**
 * Binance kline 행 배열 → SoA.
 * 행 형식: [openTime, open, high, low, close, volume, closeTime, ...]
 */
export function soaFromRows(rows) {
  const n = rows.length;
  const s = createSoA(n);
  for (let i = 0; i < n; i++) {
    const k = rows[i];
    s.t[i] = +k[0];
    s.o[i] = +k[1];
    s.h[i] = +k[2];
    s.l[i] = +k[3];
    s.c[i] = +k[4];
    s.v[i] = +k[5];
  }
  return s;
}

export function concatSoA(parts) {
  let n = 0;
  for (const p of parts) n += p.n;
  const s = createSoA(n);
  let off = 0;
  for (const p of parts) {
    if (!p.n) continue;
    for (const f of FIELDS) s[f].set(p[f].subarray(0, p.n), off);
    off += p.n;
  }
  return s;
}

/** [from, to) 구간 복사본. 원본과 메모리를 공유하지 않는다(캐시 청크를 잘라 쓰므로). */
export function sliceSoA(soa, from, to) {
  const a = Math.max(0, Math.min(from, soa.n));
  const b = Math.max(a, Math.min(to, soa.n));
  const s = createSoA(b - a);
  for (const f of FIELDS) s[f].set(soa[f].subarray(a, b));
  return s;
}

/**
 * openTime이 `t` 이상인 첫 인덱스 (lower bound). 없으면 soa.n.
 * 리플레이 시크가 "이 시각으로" 요청하면 봉 인덱스로 바꿔야 한다.
 */
export function indexOfTime(soa, t) {
  let lo = 0, hi = soa.n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (soa.t[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 봉 하나만 객체로 — 리플레이가 확정봉을 한 개씩 이어붙일 때 쓴다 */
export function candleAt(soa, i) {
  return {
    t: new Date(soa.t[i]),
    o: soa.o[i], h: soa.h[i], l: soa.l[i], c: soa.c[i], v: soa.v[i],
  };
}

/**
 * SoA [from, to) → useCandles와 **완전히 같은 형태**의 객체 배열.
 *
 * 형태가 조금이라도 다르면 renderCandles·structureZigzag·legVolume 등
 * 캔들을 받는 모든 코드가 리플레이에서만 조용히 어긋난다. 필드명·타입을 바꾸지 말 것.
 */
export function soaToCandles(soa, from = 0, to = soa.n) {
  const a = Math.max(0, Math.min(from, soa.n));
  const b = Math.max(a, Math.min(to, soa.n));
  const out = new Array(b - a);
  for (let i = a; i < b; i++) {
    out[i - a] = {
      t: new Date(soa.t[i]),
      o: soa.o[i], h: soa.h[i], l: soa.l[i], c: soa.c[i], v: soa.v[i],
    };
  }
  return out;
}
