// 과거 캔들 페이지네이션 — 리플레이 데이터 계층의 네트워크 담당
//
// useCandles는 `limit=1500`을 두 번 불러 3000봉만 들고 있다(useCandles.js:60-67).
// 5m로 환산하면 10.4일이라 리플레이에는 턱없이 모자란다. 여기서는 startTime/endTime으로
// 상장일까지 원하는 구간을 전부 받는다.
//
//   BTCUSDT 무기한 최초 봉 = 1567900800000 (2019-09-08) — 실측 확인
//
// ── 훅이 아니라 순수 모듈인 이유 ──────────────────────────────────────────
// 캐시(history.js)와 재생 UI 양쪽에서 부르고, node에서 그대로 import해 실제 응답으로
// 검산할 수 있어야 한다 (pivotLevels.js·fib.js와 같은 이유).

// ⚠ 이 폴더의 상대 import에는 **`.js` 확장자를 붙인다** (프로젝트 나머지와 다른 점).
//   Vite는 양쪽 다 되지만 node ESM은 확장자가 없으면 못 찾는다. pivotLevels.js가
//   node에서 바로 돌아가는 건 import이 하나도 없기 때문이고, 여기는 그렇지 않다.
//   확장자를 떼면 "실제 응답으로 검산한다"는 이 계층의 설계 근거가 사라진다.
import { BN_PUBLIC } from "../constants.js";
import { tfMs } from "./timeframes.js";
import { soaFromRows, concatSoA } from "./soa.js";

export const MAX_LIMIT = 1500;
// BTCUSDT 무기한 상장일 — **가장 이른 날짜이자 대비책일 뿐이다** (2026-09-02).
// ⚠ 코인마다 다르다 (ETH 2019-11-27 / DOGE 2020-07-10). 실제 하한은 그 심볼의
//   `onboardDate`이고 `/api/symbols`가 준다 — ReplayBar가 그 값을 쓴다.
//   여기 값은 아래 fetch가 "그보다 이르게는 요청하지 않는다"는 안전선이다
export const FIRST_LISTING_MS = 1567900800000;

// ── Rate limit ───────────────────────────────────────────────────────────
// 선물 REST는 IP당 분당 2400 weight, klines는 limit이 1001~1500이면 요청당 10이다.
// 산술적으로 분당 240회까지 되지만 **절반만 쓴다**: 리플레이를 받는 동안에도
// balance/position/tpsl 폴링과 usePivotLevels의 TF별 조회가 계속 돈다.
// 그쪽이 429를 맞으면 실거래 화면이 멎으므로, 다운로더가 예산을 다 먹으면 안 된다.
const WEIGHT_BUDGET = 1200;
const WINDOW_MS     = 60_000;
const KLINE_WEIGHT  = 10;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const id = setTimeout(done, ms);
    const onAbort = () => { clearTimeout(id); reject(abortError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
    function done() { signal?.removeEventListener("abort", onAbort); resolve(); }
  });
}

function abortError() {
  return typeof DOMException !== "undefined"
    ? new DOMException("Aborted", "AbortError")
    : Object.assign(new Error("Aborted"), { name: "AbortError" });
}

/**
 * 60초 슬라이딩 윈도우 weight 버킷.
 *
 * IP 단위 제한이므로 모듈 레벨 싱글턴이다 — 리플레이 창을 여러 개 띄우거나
 * 여러 TF를 동시에 받아도 합산 예산 하나를 나눠 쓴다.
 */
class WeightWindow {
  constructor(budget, windowMs) {
    this.budget = budget;
    this.windowMs = windowMs;
    this.events = [];        // { at, w }
    this.blockedUntil = 0;   // 429/418을 맞으면 전면 정지
  }

  used(now) {
    const cut = now - this.windowMs;
    while (this.events.length && this.events[0].at < cut) this.events.shift();
    let s = 0;
    for (const e of this.events) s += e.w;
    return s;
  }

  async acquire(w, signal) {
    for (;;) {
      const now = Date.now();
      if (now < this.blockedUntil) {
        await sleep(this.blockedUntil - now, signal);
        continue;
      }
      if (this.used(now) + w <= this.budget) {
        this.events.push({ at: now, w });
        return;
      }
      // 가장 오래된 소비가 창 밖으로 나가면 자리가 난다
      const wait = this.events[0].at + this.windowMs - now;
      await sleep(Math.max(wait, 50), signal);
    }
  }

  /** 429/418 응답 — Retry-After만큼 모두 정지시킨다 */
  penalize(ms) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
  }
}

export const weightWindow = new WeightWindow(WEIGHT_BUDGET, WINDOW_MS);

/** 한 페이지 조회 — 429는 Retry-After를 지켜 재시도한다 */
async function fetchPage(symbol, tf, startTime, endTime, limit, signal) {
  const url = `${BN_PUBLIC}/fapi/v1/klines?symbol=${symbol}&interval=${tf}`
            + `&limit=${limit}&startTime=${startTime}&endTime=${endTime}`;

  for (let attempt = 0; ; attempt++) {
    await weightWindow.acquire(KLINE_WEIGHT, signal);
    let r;
    try {
      r = await fetch(url, { signal });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      if (attempt >= 3) throw e;
      await sleep(500 * 2 ** attempt, signal);   // 네트워크 순단
      continue;
    }

    if (r.status === 429 || r.status === 418) {
      const retry = Number(r.headers.get("retry-after")) || 60;
      weightWindow.penalize(retry * 1000);
      if (attempt >= 5) throw new Error(`klines ${tf} rate limited (${r.status})`);
      continue;
    }
    if (!r.ok) throw new Error(`klines ${tf} ${r.status}`);
    return r.json();
  }
}

/**
 * 펀딩비 이력 — 8시간마다 한 건이라 90일이 270건뿐이다(1회 요청).
 * 페이퍼 계좌가 포지션 보유 비용을 실제대로 반영하려면 필요하다.
 * 실패해도 리플레이 자체는 돌아야 하므로 빈 배열로 넘긴다.
 */
export async function fetchFundingRates(symbol, startMs, endMs, { signal } = {}) {
  const out = [];
  let cursor = Math.max(startMs, FIRST_LISTING_MS);
  for (let page = 0; page < 20 && cursor < endMs; page++) {
    await weightWindow.acquire(1, signal);
    const url = `${BN_PUBLIC}/fapi/v1/fundingRate?symbol=${symbol}`
              + `&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    let rows;
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) break;
      rows = await r.json();
    } catch (e) {
      if (e.name === "AbortError") throw e;
      break;
    }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const k of rows) out.push({ time: +k.fundingTime, rate: +k.fundingRate });
    const last = +rows[rows.length - 1].fundingTime;
    if (last + 1 <= cursor) break;
    cursor = last + 1;
    if (rows.length < 1000) break;
  }
  return out;
}

/**
 * [startMs, endMs) 구간 캔들을 전부 받아 SoA로 반환.
 *
 * @param onProgress ({ loaded, expected, tf }) — 진행률 UI용. expected는 봉 길이로
 *                   나눈 추정치라 거래 중단 구간이 있으면 실제보다 클 수 있다
 */
export async function fetchRange(symbol, tf, startMs, endMs, { signal, onProgress } = {}) {
  const step = tfMs(tf);
  if (!step) throw new Error(`알 수 없는 타임프레임: ${tf}`);

  const start = Math.max(startMs, FIRST_LISTING_MS);
  if (endMs <= start) return soaFromRows([]);

  const expected = Math.ceil((endMs - start) / step);
  const parts = [];
  let loaded = 0;
  let cursor = start;

  // 한 페이지가 최소 1봉은 전진하므로 상한은 넉넉하다. 무한 루프 방지용
  const maxPages = Math.ceil(expected / MAX_LIMIT) + 16;

  for (let page = 0; cursor < endMs; page++) {
    if (page > maxPages) throw new Error(`fetchRange(${tf}): 페이지 상한 초과`);

    const rows = await fetchPage(symbol, tf, cursor, endMs - 1, MAX_LIMIT, signal);
    if (!rows.length) break;

    // endMs는 배타적 — 경계 봉이 섞여 들어오지 않게 여기서 한 번 더 자른다
    const kept = rows[rows.length - 1][0] < endMs ? rows : rows.filter(k => k[0] < endMs);
    if (kept.length) {
      parts.push(soaFromRows(kept));
      loaded += kept.length;
      onProgress?.({ loaded, expected, tf });
    }

    const lastRow = rows[rows.length - 1];

    // ── 종료 판정은 openTime이 아니라 **closeTime**으로 ──
    // `lastOpen + step >= endMs`로 끊으면 1M에서 틀린다: TF_MS["1M"]이 30일 근사값이라
    // 2월(28일)에서는 아직 봉이 남았는데 조기 종료되고, 31일 달에서는 빈 페이지를
    // 한 번 더 받는다. closeTime(행 인덱스 6 = openTime + 실제 길이 − 1)은 모든 TF에서
    // 정확하다. 이게 없으면 구간이 딱 떨어질 때마다 빈 응답 요청이 한 번씩 낭비된다
    // (실측: 3000봉 구간에서 2회면 될 것이 3회).
    if (+lastRow[6] + 1 >= endMs) break;
    if (rows.length < MAX_LIMIT) break;           // 마지막 페이지

    // 커서는 `lastOpen + 1` — openTime >= startTime 규칙만 쓰므로 봉 길이가
    // 불규칙해도(1M) 안전하게 전진한다
    const nextCursor = lastRow[0] + 1;
    if (nextCursor <= cursor) break;              // 전진 없음 — 방어
    cursor = nextCursor;
  }

  return parts.length === 1 ? parts[0] : concatSoA(parts);
}
