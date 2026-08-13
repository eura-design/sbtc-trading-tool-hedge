import { useState, useEffect, useMemo, useRef } from "react";
import { BN_PUBLIC, TF_MS, INTERVALS } from "../constants";
import { computePivotLevels, combineTfLevels } from "../chart/pivotLevels";

// 각 TF에서 받아올 캔들 수 — lookback(600) + 피벗 확인봉 여유
const FETCH_LIMIT = 700;
// 재조회 상한. 봉이 닫힐 때만 값이 바뀌므로 원래는 TF 길이마다 한 번이면 되지만,
// 1d·1w·1M을 그대로 두면 페이지를 켜 둔 채 며칠이 지나도 갱신되지 않는다
const MAX_REFETCH_MS = 30 * 60_000;

const TF_ORDER = INTERVALS.map(i => i.value);

async function fetchCandles(tf, signal) {
  const r = await fetch(
    `${BN_PUBLIC}/fapi/v1/klines?symbol=BTCUSDT&interval=${tf}&limit=${FETCH_LIMIT}`,
    { signal },
  );
  if (!r.ok) throw new Error(`klines ${tf} ${r.status}`);
  const j = await r.json();
  return j.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
}

/**
 * Pivot Levels — 스윙 피벗 기반 지지/저항 (계산은 chart/pivotLevels.js의 순수 함수).
 *
 * **멀티 타임프레임**이다 (2026-08-13 사용자 요청): 차트가 어떤 TF든, `params.tfs`에서
 * 고른 TF들의 레벨을 전부 같은 자리에 그린다. 그래서 차트 캔들을 쓰지 않고 TF별로
 * Binance REST에서 따로 받아 온다 — 차트는 한 번에 한 TF만 들고 있기 때문이다.
 *
 * - 다음 봉이 닫히는 시점에 맞춰 TF별로 재조회한다 (최대 30분 간격).
 *   체결 틱마다 돌 이유가 없다 — 피벗은 좌우 확인봉이 필요해 진행 중 봉에서 안 생긴다
 * - 선택이 바뀌어도 이미 받아 둔 TF는 다시 받지 않는다 (캐시는 언마운트까지 유지)
 * - 파라미터(감지 봉·병합 폭 등)만 바뀌면 네트워크 없이 계산만 다시 한다
 */
export function usePivotLevels(params = {}) {
  const pivot_bars = params.pivot_bars ?? 8;
  const merge_atr  = params.merge_atr  ?? 0.5;
  const min_touch  = params.min_touch  ?? 2;
  const top_n      = params.top_n      ?? 3;
  const lookback   = params.lookback   ?? 600;

  // 선택 TF — INTERVALS 순서로 정규화해서 배열 순서 차이로 재조회가 돌지 않게 한다
  const tfList = Array.isArray(params.tfs) ? params.tfs : [];
  const tfKey  = TF_ORDER.filter(t => tfList.includes(t)).join(",");

  // { [tf]: candles } — 선택에서 뺀 TF도 지우지 않는다 (다시 켤 때 재조회 없이 바로 뜬다)
  const [candlesByTf, setCandlesByTf] = useState({});
  const fetchedAtRef = useRef({});      // { [tf]: 마지막 조회 시각 }

  useEffect(() => {
    const tfs = tfKey ? tfKey.split(",") : [];
    if (!tfs.length) return;

    const ac = new AbortController();
    const timers = [];
    let alive = true;

    // 봉 길이(최대 30분) 안에 받아 둔 값이면 아직 바뀌지 않았다.
    // TF 하나를 토글할 때마다 나머지 TF까지 다시 받는 낭비를 막는다
    const isStale = (tf) => {
      const ms = Math.min(TF_MS[tf] ?? MAX_REFETCH_MS, MAX_REFETCH_MS);
      return Date.now() - (fetchedAtRef.current[tf] ?? 0) >= ms;
    };

    const pull = async (tf, doFetch) => {
      if (doFetch) {
        try {
          const c = await fetchCandles(tf, ac.signal);
          fetchedAtRef.current[tf] = Date.now();
          if (alive) setCandlesByTf(prev => ({ ...prev, [tf]: c }));
        } catch (e) {
          if (e.name !== "AbortError") console.warn("[PivotLevels] 캔들 조회 실패:", tf, e.message);
        }
      }
      if (!alive) return;
      // 다음 봉 마감 직후로 예약 (1w·1M은 modulo 위상이 맞지 않지만 어차피 상한에 걸린다)
      const ms = TF_MS[tf] ?? MAX_REFETCH_MS;
      const delay = Math.min(ms - (Date.now() % ms) + 2000, MAX_REFETCH_MS);
      timers.push(setTimeout(() => pull(tf, true), delay));
    };

    for (const tf of tfs) pull(tf, isStale(tf));

    return () => {
      alive = false;
      ac.abort();
      timers.forEach(clearTimeout);
    };
  }, [tfKey]);

  return useMemo(() => {
    const tfs = tfKey ? tfKey.split(",") : [];
    const perTf = [];
    for (const tf of tfs) {
      const candles = candlesByTf[tf];
      if (!candles?.length) continue;
      perTf.push({
        tf, tfMs: TF_MS[tf] ?? 0,
        levels: computePivotLevels(candles, { pivot_bars, merge_atr, min_touch, top_n, lookback }),
      });
    }
    return combineTfLevels(perTf);
  }, [candlesByTf, tfKey, pivot_bars, merge_atr, min_touch, top_n, lookback]);
}
