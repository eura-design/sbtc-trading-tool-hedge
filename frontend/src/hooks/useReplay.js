import { useState, useEffect, useRef, useCallback } from "react";
import { getRange } from "../replay/history.js";
import { indexOfTime } from "../replay/soa.js";
import { fetchFundingRates } from "../replay/klines.js";
import { ReplayEngine } from "../replay/engine.js";
import { PaperBroker } from "../replay/paperBroker.js";
import { sessionKey, saveSession, loadSession, clearSession, restoreInto, hasProgress, sameRange } from "../replay/session.js";
import { driveTfFor, tfMs, ticksPerBar } from "../replay/timeframes.js";
import { useStore } from "../store";
import { DEFAULT_SYMBOL } from "../constants";

// 리플레이 캔들 피드 — useCandles를 대신한다
//
// **반환 형태가 useCandles와 같다** (`{ candles, candlesRef, loading }`). 렌더러·지표가
// 전부 그 계약을 보고 있어서, 리플레이 모드에서는 이 훅의 결과를 그 자리에 그대로 끼운다.
//
// ── 재생 = 구동 TF 한 틱 ─────────────────────────────────────────────────
// 1h 리플레이는 5m 12틱으로 열린다(timeframes.js). 그래서 "한 칸 전진"의 기본 단위가
// 구동 봉이고, 표시봉 하나를 넘기려면 stepBar를 쓴다.
//
// ── useCandles와 같은 갱신 규칙 ──────────────────────────────────────────
// 봉이 진행 중일 때는 배열을 in-place로 고치고 onTickRef만 부른다(리렌더 없음).
// 봉이 마감될 때만 setCandles로 새 배열을 넘긴다. useCandles.js:29-46과 같은 이유고,
// 이걸 어기면 틱마다 SVG 오버레이 전체가 리렌더된다.
//
// ⚠ 이 훅은 **전역 스토어를 건드리지 않는다** (liveClose 포함). 실시간 값과 리플레이
//   값이 같은 자리에 섞이면 어느 쪽이 화면에 있는지 알 수 없어진다. 어느 값을 스토어에
//   넣을지는 리플레이 모드를 켜고 끄는 쪽(3단계 통합)이 정한다.

const BASE_TICK_MS = 300;   // 속도 1배 = 구동 봉 하나에 0.3초
// 페이퍼 체결의 수량 단위 — **그 심볼의 것**을 쓴다 (DOGE는 1이다).
// ⚠ 훅 밖(콜백 안)에서도 부르므로 스토어를 그 자리에서 읽는다
const qtyStep   = () => useStore.getState().symbolFilters.step;
// 연습 청산가는 심볼의 유지증거금률을 따른다 (DOGE 0.0065 / BTC 0.004)
const maintRate = () => useStore.getState().symbolFilters.maintRate;

const DEFAULT_WARMUP_BARS = 750;   // ATR(100)·EMA(60)·ZZ 피벗이 첫 봉부터 제대로 나오도록

export function useReplay({
  enabled,
  tf,
  startMs,
  endMs,
  symbol = DEFAULT_SYMBOL,   // App이 넘긴다 — 기본값은 대비책일 뿐이다
  warmupBars = DEFAULT_WARMUP_BARS,
  startBalance = 10_000,
  onTickRef,
} = {}) {
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  // 첫 로드가 길어질 때(구간이 길수록) 진행률을 보여준다 — 멈춘 것처럼 보이지 않게
  const [loadInfo, setLoadInfo] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed]     = useState(1);

  // 커서가 움직일 때마다 바뀌는 값들 — 하나로 묶어 리렌더를 한 번만 일으킨다
  const [status, setStatus] = useState({ progress: 0, nowMs: null, price: null, atEnd: false });

  const candlesRef = useRef([]);
  const engineRef  = useRef(null);
  const brokerRef  = useRef(null);
  const fedRef     = useRef(0);      // 브로커에 이미 먹인 구동 봉 수
  const sessionKeyRef = useRef(null);
  const saveTimerRef  = useRef(null);
  const timerRef   = useRef(null);
  const speedRef   = useRef(speed);
  speedRef.current = speed;

  // ── TF를 바꿔도 재생이 이어지게 하는 세 값 (2026-08-19 사용자 요청) ──────
  // TF가 바뀌면 표시·구동 캔들을 통째로 다시 받아야 해서 로드 이펙트가 재실행되고,
  // 그 cleanup이 재생을 멈춘다(로딩 중에 커서를 굴릴 수는 없다).
  // 그래서 **멈추기 직전 상태를 기억해 뒀다가 로드가 끝나면 되켠다.**
  const playingRef  = useRef(false);
  playingRef.current = playing;
  const wasPlayingRef = useRef(false);   // cleanup 시점의 재생 여부
  const prevLoadRef   = useRef(null);    // { rangeKey, tf } — "TF만 바뀌었나" 판정용

  const driveTf = driveTfFor(tf);

  // 저장은 debounce한다 — 틱마다 직렬화하면 재생이 눈에 띄게 느려진다
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (sessionKeyRef.current) saveSession(sessionKeyRef.current, brokerRef.current);
    }, 500);
  }, []);

  /**
   * 대기 중인 저장을 **지금 당장** 흘려보낸다.
   *
   * ⚠ TF 전환에 반드시 필요하다. 재생 중에는 매 틱(기본 300ms)마다 scheduleSave가
   *   500ms 타이머를 다시 깔기 때문에 **저장이 한 번도 일어나지 않는다.**
   *   진행 위치는 `broker.lastTime`으로만 저장되므로(replay/session.js), 이걸 안 흘리면
   *   TF를 바꾼 순간 **재생을 시작하기 전 지점으로 되감긴다** — 몇 분을 재생했든.
   */
  const flushSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    if (sessionKeyRef.current && brokerRef.current) {
      saveSession(sessionKeyRef.current, brokerRef.current);
    }
  }, []);

  // 주문 액션(paperActions)이 부를 수 있도록 스토어에 걸어 둔다
  useEffect(() => {
    useStore.getState().setScheduleReplaySave(scheduleSave);
    return () => clearTimeout(saveTimerRef.current);
  }, [scheduleSave]);

  /**
   * 엔진 커서만큼 페이퍼 브로커를 따라가게 한다.
   *
   * ⚠ **뒤로 시크해도 연습 계좌를 건드리지 않는다** (2026-08-19 사용자 확정).
   *   예전에는 여기서 브로커를 통째로 새로 만들었고, 그래서 진행 슬라이더를 살짝
   *   왼쪽으로 옮기기만 해도 몇 시간 쌓은 연습 성적이 말없이 사라졌다.
   *   **초기화는 이제 명시적인 버튼 하나로만 일어난다**(`resetPaper`).
   *   ※ 옛 주석의 근거("손실만 지우고 다시 하기가 된다")는 뒤집힌 얘기였다 —
   *     되감아도 장부가 남으므로 오히려 지금이 손실을 지울 수 없는 쪽이다.
   *
   *   되감은 뒤에는 지나간 봉을 다시 먹이지 않는다(이미 반영된 체결이라 두 번 세면
   *   안 된다). 대신 **브로커의 현재가·시각을 되감은 지점으로 맞춘다** — 안 그러면
   *   시장가 주문이 미래 가격에 체결되고 포지션 미실현이 미래 가격으로 계산된다.
   */
  const syncBroker = useCallback(() => {
    const e = engineRef.current, b = brokerRef.current;
    if (!e || !b) return;
    if (e.cursor < fedRef.current) {
      b.lastPrice = e.price;
      b.lastTime  = e.nowMs;
      fedRef.current = e.cursor;
    } else {
      const d = e.drive;
      for (let i = fedRef.current; i < e.cursor; i++) {
        b.onBar({ t: d.t[i], o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i], v: d.v[i] });
      }
      fedRef.current = e.cursor;
    }
    // ⚠ 시계를 **먼저** 맞춘다. syncPaper는 마크 가격으로 `replayPrice`를 읽는데,
    //   App의 시계 반영은 렌더 뒤 useEffect라 한 틱 늦다. 크게 시크하면 그 한 틱이
    //   수천 달러 차이라, 되감은 직후 포지션 미실현이 엉뚱한 값으로 찍혔다
    useStore.getState().setReplayClock(e.nowMs, e.price);
    useStore.getState().syncPaper();
    scheduleSave();
  }, [scheduleSave]);

  /**
   * 연습 계좌·성적 초기화 — **사용자가 버튼을 눌렀을 때만** 부른다.
   * 자동으로 불리는 경로는 하나도 없어야 한다 (위 syncBroker 주석 참고).
   */
  const resetPaper = useCallback(() => {
    const e = engineRef.current, b = brokerRef.current;
    if (!b) return;
    const fresh = new PaperBroker({ startBalance, fundingRates: b.fundingRates, step: qtyStep(), maintRate: maintRate() });
    fresh.lastPrice = e?.price ?? null;
    fresh.lastTime  = e?.nowMs ?? null;
    // 펀딩비 커서는 이미 지나온 구간만큼 앞으로 당겨 둔다 — 0으로 두면 재생을
    // 이어갈 때 지금까지의 펀딩비가 한꺼번에 청구된다
    while (fresh._fundIdx < fresh.fundingRates.length
           && fresh.fundingRates[fresh._fundIdx].time <= (fresh.lastTime ?? 0)) fresh._fundIdx++;
    brokerRef.current = fresh;
    useStore.getState().setPaperBroker(fresh);
    useStore.getState().syncPaper();
    clearSession();
    scheduleSave();
  }, [startBalance, scheduleSave]);

  const syncStatus = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    setStatus({ progress: e.progress, nowMs: e.nowMs, price: e.price, atEnd: e.atEnd });
  }, []);

  // ── 로드 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    // ── TF만 바뀐 재실행인가 ────────────────────────────────────────────
    // 구간(symbol·startMs·endMs)이 그대로인데 다시 로드한다 = 사용자가 TF를 바꿨다.
    // 그때만 재생을 되켠다 — 날짜를 옮기거나 리플레이를 처음 켠 경우까지 자동
    // 재생하면 화면이 준비되기도 전에 봉이 흘러간다.
    // ⚠ 이 판정은 **cleanup보다 뒤, prevLoadRef 갱신보다 앞**에서 해야 한다.
    //   cleanup이 wasPlayingRef를 채우고, 아래에서 prevLoadRef를 새 값으로 덮는다.
    const rangeKey = `${symbol}|${startMs}|${endMs}`;
    const prev     = prevLoadRef.current;
    const resume   = !!prev && prev.rangeKey === rangeKey && prev.tf !== tf && wasPlayingRef.current;
    wasPlayingRef.current = false;
    prevLoadRef.current = enabled ? { rangeKey, tf } : null;

    if (!enabled || !tf || !startMs || !endMs || endMs <= startMs) {
      engineRef.current = null;
      brokerRef.current = null;
      fedRef.current = 0;
      candlesRef.current = [];
      setCandles([]);
      setPlaying(false);
      useStore.getState().setPaperBroker(null);
      return;
    }

    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const onProgress = ({ loaded, expected, tf: t }) =>
          setLoadInfo({ pct: expected ? Math.min(100, Math.round((loaded / expected) * 100)) : 0, tf: t });

        const step = tfMs(tf);
        // 워밍업만큼 앞을 더 받는다. 시작 시각 정렬은 아래에서 **실제 봉 시가**로 맞춘다
        const display = await getRange(symbol, tf, startMs - step * warmupBars, endMs, { signal: ac.signal, onProgress });
        if (cancelled || !display.n) {
          if (!cancelled) setError("해당 구간에 캔들이 없습니다");
          return;
        }

        // ⚠ 정렬을 산술(floor(t/step)*step)로 하면 1w·1M에서 틀린다.
        //   주봉은 월요일 시작인데 epoch 기준으로 나누면 목요일 경계가 나온다.
        //   실제 받아온 봉의 시가를 쓰면 어떤 TF에서도 정확하다.
        let di = 0;
        while (di + 1 < display.n && display.t[di + 1] <= startMs) di++;
        const alignedStart = display.t[di];

        const drive = await getRange(symbol, driveTf, alignedStart, endMs, { signal: ac.signal, onProgress });
        if (cancelled) return;
        if (!drive.n) { setError("구동 타임프레임 데이터가 없습니다"); return; }

        // 펀딩비는 실패해도 리플레이를 막지 않는다 — 없으면 보유 비용만 빠진다
        const fundingRates = await fetchFundingRates(symbol, alignedStart, endMs, { signal: ac.signal })
          .catch(() => []);
        if (cancelled) return;

        const eng = new ReplayEngine({ tf, driveTf, display, drive, replayStartMs: alignedStart });
        engineRef.current = eng;
        candlesRef.current = eng.candles;

        const broker = new PaperBroker({ startBalance, fundingRates, step: qtyStep(), maintRate: maintRate() });
        broker.lastPrice = eng.price ?? display.c[Math.max(0, eng.closedCount() - 1)];
        broker.lastTime  = eng.nowMs;
        fedRef.current = 0;

        // 이전 세션 이어하기 (replay/session.js의 두 단계 규칙)
        //   ① 같은 구간 → 계좌·포지션·진행 위치까지 전부. 진행 위치는 시각으로
        //      저장돼 있어 그동안 TF를 바꿨어도 맞는다
        //   ② 다른 구간 → **연습 성적(장부)만** 이어받는다. 포지션은 두고 온다
        //      (다른 시기의 진입가는 화면 밖이라 유령 포지션이 된다)
        //      ⚠ 여기서 장부까지 버리면 날짜를 옮길 때마다 성적이 사라진다 —
        //        초기화는 버튼으로만 한다는 규칙이 깨진다 (2026-08-19)
        const key = sessionKey(symbol, startMs, endMs);
        sessionKeyRef.current = key;
        const saved = loadSession();
        if (hasProgress(saved)) {
          const full = sameRange(saved, key);
          restoreInto(broker, saved, full);
          if (full) {
            const idx = indexOfTime(drive, saved.lastTime);
            // lastTime은 **처리한 마지막 봉의 시가**다 → 그 봉까지 소비한 상태로 맞춘다
            const cursor = Math.min(drive.n, idx + 1);
            eng.seek(cursor);
            fedRef.current = cursor;
            candlesRef.current = eng.candles;
          } else {
            // 새 구간의 시작 시점 시세로 맞춘다 (restoreInto가 채우지 않는 두 값)
            broker.lastPrice = eng.price ?? display.c[Math.max(0, eng.closedCount() - 1)];
            broker.lastTime  = eng.nowMs;
          }
        }
        brokerRef.current = broker;
        useStore.getState().setPaperBroker(broker);
        useStore.getState().syncPaper();

        setCandles([...eng.candles]);
        syncStatus();
        // 끊긴 재생을 이어붙인다. 끝에 닿아 있으면 되켜지 않는다(재생 루프가 바로 멈춘다)
        if (resume && !eng.atEnd) setPlaying(true);
      } catch (e) {
        if (e.name !== "AbortError" && !cancelled) {
          console.error("[replay] 로드 실패:", e);
          setError(e.message);
        }
      } finally {
        if (!cancelled) { setLoading(false); setLoadInfo(null); }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      // ⚠ **순서가 중요하다.** 저장을 먼저 흘려야 아래에서 다시 로드할 때
      //   loadSession이 방금까지 재생한 지점을 읽는다 (flushSave 주석 참고)
      flushSave();
      wasPlayingRef.current = playingRef.current;
      setPlaying(false);
    };
  }, [enabled, tf, driveTf, startMs, endMs, symbol, warmupBars, startBalance, syncStatus, flushSave]);

  // ── 커서 이동 결과를 화면에 반영 ────────────────────────────────────────
  // barClosed일 때만 새 배열을 만든다 (useCandles와 같은 규칙)
  const applyMove = useCallback((res) => {
    const e = engineRef.current;
    if (!e || !res?.moved) return;
    candlesRef.current = e.candles;
    // 체결 판정을 화면 갱신보다 먼저 — 새 봉이 그려질 때 포지션도 이미 반영돼 있어야 한다
    syncBroker();
    if (res.barClosed) setCandles([...e.candles]);
    else onTickRef?.current?.();
    syncStatus();
  }, [onTickRef, syncStatus, syncBroker]);

  const stepTick = useCallback((n = 1) => {
    const e = engineRef.current;
    if (e) applyMove(e.step(n));
  }, [applyMove]);

  const stepBar = useCallback(() => {
    const e = engineRef.current;
    if (e) applyMove(e.stepBar());
  }, [applyMove]);

  // 시크는 엔진이 배열을 새로 만든다(identity 교체 = ZZ 누적 리셋) → 항상 setCandles
  const seekProgress = useCallback((p) => {
    const e = engineRef.current;
    if (!e) return;
    e.seekProgress(p);
    candlesRef.current = e.candles;
    syncBroker();
    setCandles([...e.candles]);
    syncStatus();
  }, [syncStatus, syncBroker]);

  // ── 재생 루프 ───────────────────────────────────────────────────────────
  // setInterval이 아니라 setTimeout 체인이다 — 속도를 바꿔도 다음 틱부터 바로 반영되고,
  // 탭이 백그라운드로 가서 타이머가 밀려도 틱이 몰아서 터지지 않는다
  useEffect(() => {
    if (!playing) return;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const e = engineRef.current;
      if (!e || e.atEnd) { setPlaying(false); return; }
      applyMove(e.step(1));
      timerRef.current = setTimeout(tick, Math.max(16, BASE_TICK_MS / speedRef.current));
    };
    timerRef.current = setTimeout(tick, Math.max(16, BASE_TICK_MS / speedRef.current));

    return () => { stopped = true; clearTimeout(timerRef.current); };
  }, [playing, applyMove]);

  const play   = useCallback(() => { if (!engineRef.current?.atEnd) setPlaying(true); }, []);
  const pause  = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying(p => !p), []);

  return {
    // useCandles와 같은 계약
    candles, candlesRef, loading, loadInfo,
    error,
    // 재생 제어
    playing, play, pause, toggle, speed, setSpeed,
    stepTick, stepBar, seekProgress, resetPaper,
    // 상태
    ...status,
    driveTf,
    ticksPerBar: ticksPerBar(tf, driveTf),
  };
}
