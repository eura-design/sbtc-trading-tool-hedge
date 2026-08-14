import { useState, useEffect, useRef, useCallback } from "react";
import { getRange } from "../replay/history.js";
import { indexOfTime } from "../replay/soa.js";
import { fetchFundingRates } from "../replay/klines.js";
import { ReplayEngine } from "../replay/engine.js";
import { PaperBroker } from "../replay/paperBroker.js";
import { sessionKey, saveSession, loadSession, restoreInto, hasProgress } from "../replay/session.js";
import { driveTfFor, tfMs, ticksPerBar } from "../replay/timeframes.js";
import { useStore } from "../store";

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
const DEFAULT_WARMUP_BARS = 750;   // ATR(100)·EMA(60)·ZZ 피벗이 첫 봉부터 제대로 나오도록

export function useReplay({
  enabled,
  tf,
  startMs,
  endMs,
  symbol = "BTCUSDT",
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

  const driveTf = driveTfFor(tf);

  // 저장은 debounce한다 — 틱마다 직렬화하면 재생이 눈에 띄게 느려진다
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (sessionKeyRef.current) saveSession(sessionKeyRef.current, brokerRef.current);
    }, 500);
  }, []);

  // 주문 액션(paperActions)이 부를 수 있도록 스토어에 걸어 둔다
  useEffect(() => {
    useStore.getState().setScheduleReplaySave(scheduleSave);
    return () => clearTimeout(saveTimerRef.current);
  }, [scheduleSave]);

  /**
   * 엔진 커서만큼 페이퍼 브로커를 따라가게 한다.
   *
   * ⚠ **뒤로 시크하면 연습 계좌를 초기화한다.** 시간을 되감았는데 아까 낸 주문과
   *   손익이 남아 있으면 "손실만 지우고 다시 하기"가 되어 연습이 무의미해진다.
   *   되감은 시점에는 포지션도 주문도 없으므로, 지나간 봉을 다시 먹일 필요는 없다
   *   (빈 계좌에 봉을 먹여봐야 아무 일도 안 일어난다).
   */
  const syncBroker = useCallback(() => {
    const e = engineRef.current, b = brokerRef.current;
    if (!e || !b) return;
    if (e.cursor < fedRef.current) {
      const fresh = new PaperBroker({ startBalance, fundingRates: b.fundingRates });
      fresh.lastPrice = e.price;
      fresh.lastTime  = e.nowMs;
      brokerRef.current = fresh;
      useStore.getState().setPaperBroker(fresh);
      fedRef.current = e.cursor;
      useStore.getState().syncPaper();
      scheduleSave();
      return;
    }
    const d = e.drive;
    for (let i = fedRef.current; i < e.cursor; i++) {
      b.onBar({ t: d.t[i], o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i], v: d.v[i] });
    }
    fedRef.current = e.cursor;
    useStore.getState().syncPaper();
    scheduleSave();
  }, [startBalance, scheduleSave]);

  const syncStatus = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    setStatus({ progress: e.progress, nowMs: e.nowMs, price: e.price, atEnd: e.atEnd });
  }, []);

  // ── 로드 ────────────────────────────────────────────────────────────────
  useEffect(() => {
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

        const broker = new PaperBroker({ startBalance, fundingRates });
        broker.lastPrice = eng.price ?? display.c[Math.max(0, eng.closedCount() - 1)];
        broker.lastTime  = eng.nowMs;
        fedRef.current = 0;

        // 이전 세션 이어하기 — 같은 구간의 저장분이 있으면 계좌와 진행 위치를 되살린다.
        // 진행 위치는 시각으로 저장돼 있어 그동안 TF를 바꿨어도 맞는다 (replay/session.js)
        const key = sessionKey(symbol, startMs, endMs);
        sessionKeyRef.current = key;
        const saved = loadSession(key);
        if (hasProgress(saved)) {
          restoreInto(broker, saved);
          const idx = indexOfTime(drive, saved.lastTime);
          // lastTime은 **처리한 마지막 봉의 시가**다 → 그 봉까지 소비한 상태로 맞춘다
          const cursor = Math.min(drive.n, idx + 1);
          eng.seek(cursor);
          fedRef.current = cursor;
          candlesRef.current = eng.candles;
        }
        brokerRef.current = broker;
        useStore.getState().setPaperBroker(broker);
        useStore.getState().syncPaper();

        setCandles([...eng.candles]);
        syncStatus();
      } catch (e) {
        if (e.name !== "AbortError" && !cancelled) {
          console.error("[replay] 로드 실패:", e);
          setError(e.message);
        }
      } finally {
        if (!cancelled) { setLoading(false); setLoadInfo(null); }
      }
    })();

    return () => { cancelled = true; ac.abort(); setPlaying(false); };
  }, [enabled, tf, driveTf, startMs, endMs, symbol, warmupBars, startBalance, syncStatus]);

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
    stepTick, stepBar, seekProgress,
    // 상태
    ...status,
    driveTf,
    ticksPerBar: ticksPerBar(tf, driveTf),
  };
}
