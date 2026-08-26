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
// v2 (2026-08-26) — 청크에 `at`(받아 둔 시각)을 붙이고 그 인덱스를 만들었다.
// 예전엔 캐시가 **무한정 쌓였다** (비우는 함수는 있는데 아무도 안 불렀다).
const DB_VERSION = 2;
const STORE      = "klines";
const CHUNK_BARS = 1000;

// 캐시 상한 — 청크 하나가 1000봉 × 6 × 8바이트 ≈ 48KB이므로 400개면 약 19MB다.
// 90일 5m 한 세션이 26청크라 열댓 구간을 오가도 여유가 있다.
// ⚠ 이건 **성능용 캐시일 뿐**이다 — 지워도 다시 받으면 그만이라 상한을 낮게 잡아도
//   기능이 깨지지 않는다. 저장 공간을 조용히 먹는 쪽이 더 나쁘다.
const MAX_CHUNKS = 400;

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
      // ⚠ 옛 청크는 **버린다.** v1에는 `at`이 없어서 인덱스에 잡히지 않고, 그러면
      //   영영 안 지워지는 찌꺼기가 된다. 캐시는 다시 받으면 그만이라 버리는 게 싸다.
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      const store = db.createObjectStore(STORE, { keyPath: "key" });
      // 오래된 것부터 지우려면 값을 통째로 읽지 않고 시각만 훑을 수 있어야 한다
      store.createIndex("at", "at");
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
    const at = Date.now();
    for (const { idx, soa } of entries) {
      store.put({ key: chunkKey(symbol, tf, idx), soa, at });
    }
    tx.oncomplete = resolve;
    tx.onerror = () => { console.warn("[replay] 캐시 저장 실패:", tx.error?.message); resolve(); };
    tx.onabort  = () => resolve();
  });
}

const tx0 = (db, mode) => db.transaction(STORE, mode);

/**
 * 캐시가 상한을 넘으면 **먼저 받아 둔 것부터** 지운다.
 *
 * 쓰기가 끝난 뒤에만 부르고, 상한 아래면 개수만 세고 끝난다(거의 공짜).
 * `at` 인덱스를 커서로 훑으므로 **캔들 데이터를 읽지 않는다** — 값까지 읽으면
 * 정리하려다 수십 MB를 메모리에 올리게 된다.
 *
 * ※ 받은 시각 기준이지 마지막으로 쓴 시각이 아니다. 읽을 때마다 시각을 갱신하면
 *   조회 한 번에 쓰기가 딸려붙어 리플레이 로딩이 느려진다 — 캐시 하나 더 받는 값보다 비싸다.
 */
async function trimCache() {
  const db = await openDB();
  if (!db) {
    // 메모리 폴백도 같이 막는다 (Map은 넣은 순서를 지킨다)
    while (memory.size > MAX_CHUNKS) memory.delete(memory.keys().next().value);
    return;
  }
  await new Promise((resolve) => {
    const tx    = tx0(db, "readwrite");
    const store = tx.objectStore(STORE);
    const req   = store.count();
    req.onsuccess = () => {
      let over = req.result - MAX_CHUNKS;
      if (over <= 0) return;                       // 상한 아래 — 아무것도 안 한다
      const cur = store.index("at").openKeyCursor();   // 값이 아니라 키만
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || over <= 0) return;
        store.delete(c.primaryKey);
        over--;
        c.continue();
      };
    };
    tx.oncomplete = resolve;
    tx.onerror    = resolve;
    tx.onabort    = resolve;
  });
}

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
    await trimCache();   // 상한을 넘으면 먼저 받아 둔 청크부터 지운다
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

/**
 * 캐시 통째로 비우기 — 저장 형식을 바꿨을 때 쓴다.
 * ※ 평소 정리는 `trimCache()`가 쓰기 뒤에 알아서 한다 (상한 MAX_CHUNKS).
 */
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
