// 과거 캔들 캐시 — IndexedDB 청크 저장 + 빠진 구간만 네트워크 조회
//
// ── 왜 캐시가 필요한가 ────────────────────────────────────────────────────
// 5m 3개월이면 26,000봉 = 18회 요청이다. 한 번은 2초면 끝나지만, 같은 구간을 다시
// 연습할 때마다 다시 받는 건 낭비고 rate limit 예산도 실거래 폴링과 나눠 쓰는 값이다.
// 한 번 받은 봉은 **영영 바뀌지 않으므로**(마감된 과거 봉) 캐시 무효화 문제가 없다.
//
// ── 왜 봉 단위가 아니라 청크인가 ──────────────────────────────────────────
// 봉 하나를 레코드 하나로 넣으면 26,000번 write가 돌아 IDB 트랜잭션이 수 초씩 걸린다.
// CHUNK_BARS(1000)봉을 Float64Array 묶음 하나로 넣으면 write가 26번이다.
//
// ── 진행 중 청크는 저장하지 않는다 ────────────────────────────────────────
// 청크의 시간 범위가 통째로 과거가 됐을 때만 `complete`로 보고 저장한다.
// 마지막 청크는 아직 봉이 채워지는 중이라 저장하면 영원히 반쪽짜리가 캐시된다.
// 재조회 비용은 최대 1000봉(1회 요청)이라 무시할 만하다.
//
// ⚠ **캔들이 0개인 청크도 저장한다.** 상장 이전 구간이 그렇다. 안 넣으면
//   "빠진 청크"로 판정돼 페이지를 열 때마다 같은 빈 구간을 다시 받는다.

// ⚠ 상대 import의 `.js` 확장자는 의도적이다 — klines.js 상단 주석 참고
import { tfMs } from "./timeframes.js";
import { fetchRange, FIRST_LISTING_MS } from "./klines.js";
import { concatSoA, sliceSoA, indexOfTime, soaFromRows, createSoA } from "./soa.js";

const DB_NAME    = "hadge-replay";
const DB_VERSION = 1;
const STORE      = "klines";
const CHUNK_BARS = 1000;

const chunkSpan = (tf) => tfMs(tf) * CHUNK_BARS;
const chunkIdxOf = (t, tf) => Math.floor(t / chunkSpan(tf));
const chunkKey = (symbol, tf, idx) => `${symbol}|${tf}|${idx}`;

// ── IndexedDB (없으면 메모리 폴백) ────────────────────────────────────────
// 시크릿 모드·스토리지 차단 환경에서도 리플레이 자체는 동작해야 한다.
// node에서 import해 검산할 때도 이 경로를 탄다.
const memory = new Map();
let dbPromise = null;

function openDB() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn("[replay] IndexedDB 열기 실패 — 메모리 캐시로 동작합니다:", req.error?.message);
      resolve(null);
    };
  });
  return dbPromise;
}

async function readChunks(symbol, tf, from, to) {
  const out = new Map();
  const db = await openDB();
  if (!db) {
    for (let i = from; i <= to; i++) {
      const v = memory.get(chunkKey(symbol, tf, i));
      if (v) out.set(i, v);
    }
    return out;
  }
  await new Promise((resolve) => {
    const tx = tx0(db, "readonly");
    const store = tx.objectStore(STORE);
    let pending = to - from + 1;
    if (pending <= 0) return resolve();
    for (let i = from; i <= to; i++) {
      const idx = i;
      const req = store.get(chunkKey(symbol, tf, idx));
      req.onsuccess = () => { if (req.result) out.set(idx, req.result.soa); if (--pending === 0) resolve(); };
      req.onerror   = () => { if (--pending === 0) resolve(); };
    }
  });
  return out;
}

async function writeChunks(symbol, tf, entries) {
  if (!entries.length) return;
  const db = await openDB();
  if (!db) {
    for (const { idx, soa } of entries) memory.set(chunkKey(symbol, tf, idx), soa);
    return;
  }
  await new Promise((resolve) => {
    const tx = tx0(db, "readwrite");
    const store = tx.objectStore(STORE);
    for (const { idx, soa } of entries) {
      store.put({ key: chunkKey(symbol, tf, idx), soa });
    }
    tx.oncomplete = resolve;
    tx.onerror = () => { console.warn("[replay] 캐시 저장 실패:", tx.error?.message); resolve(); };
    tx.onabort  = () => resolve();
  });
}

const tx0 = (db, mode) => db.transaction(STORE, mode);

// ── 조회 ─────────────────────────────────────────────────────────────────

/**
 * [startMs, endMs) 구간 캔들을 SoA로 돌려준다. 캐시에 있는 청크는 재사용하고
 * 빠진 청크만 **연속 구간으로 묶어** 한 번에 받는다 (요청 수 최소화).
 *
 * @param onProgress ({ loaded, expected, tf }) — fetchRange가 그대로 전달
 */
export async function getRange(symbol, tf, startMs, endMs, { signal, onProgress } = {}) {
  const span = chunkSpan(tf);
  if (!span) throw new Error(`알 수 없는 타임프레임: ${tf}`);

  const start = Math.max(startMs, FIRST_LISTING_MS);
  if (endMs <= start) return createSoA(0);

  const i0 = chunkIdxOf(start, tf);
  const i1 = chunkIdxOf(endMs - 1, tf);

  const cached = await readChunks(symbol, tf, i0, i1);

  // 빠진 청크를 연속 구간(run)으로 묶는다
  const runs = [];
  for (let i = i0; i <= i1; i++) {
    if (cached.has(i)) continue;
    const last = runs[runs.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else runs.push({ from: i, to: i });
  }

  const now = Date.now();
  for (const run of runs) {
    const runStart = run.from * span;
    const runEnd   = (run.to + 1) * span;
    const soa = await fetchRange(symbol, tf, runStart, runEnd, { signal, onProgress });

    // 받은 구간을 청크 경계로 쪼개 캐시에 넣는다
    const toWrite = [];
    for (let i = run.from; i <= run.to; i++) {
      const a = indexOfTime(soa, i * span);
      const b = indexOfTime(soa, (i + 1) * span);
      const part = sliceSoA(soa, a, b);
      cached.set(i, part);
      // 청크 전체가 과거가 됐을 때만 저장 — 진행 중 청크는 반쪽짜리로 굳는다
      if ((i + 1) * span <= now) toWrite.push({ idx: i, soa: part });
    }
    await writeChunks(symbol, tf, toWrite);
  }

  const parts = [];
  for (let i = i0; i <= i1; i++) parts.push(cached.get(i) ?? createSoA(0));
  const all = concatSoA(parts);

  return sliceSoA(all, indexOfTime(all, start), indexOfTime(all, endMs));
}

/**
 * 끝 시각에서 뒤로 `bars`봉. 리플레이 시작 시점을 고르면 그 이전 워밍업 구간을
 * 받는 용도다 — 지표(ATR·EMA·RSI)가 첫 봉부터 제대로 나오려면 앞쪽 여유가 필요하다.
 */
export function getLastBars(symbol, tf, endMs, bars, opts) {
  return getRange(symbol, tf, endMs - tfMs(tf) * bars, endMs, opts);
}

/** 캐시 비우기 — 저장 형식을 바꿨을 때 쓴다 */
export async function clearCache() {
  memory.clear();
  const db = await openDB();
  if (!db) return;
  await new Promise((resolve) => {
    const tx = tx0(db, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

export const _internals = { chunkSpan, chunkIdxOf, chunkKey, CHUNK_BARS, soaFromRows };
