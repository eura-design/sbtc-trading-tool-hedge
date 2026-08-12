import { useEffect, useRef } from "react";
import { BN_PUBLIC, BN_WS, TF_MS } from "../constants";

const ALL_TF      = ["5m", "15m", "1h", "4h", "1d", "1w", "1M"];
const TF_LABEL    = { "5m": "5분", "15m": "15분", "1h": "1시간", "4h": "4시간", "1d": "1일", "1w": "1주", "1M": "1월" };
// TF_MS(constants.js)를 쿨다운 기준으로 사용 — TF_SECS 제거

// ── RSI 유틸 ──────────────────────────────────────────────────────────────────
import { buildRSIState, tickRSI } from "../utils/rsi";

// ── 타임프레임별 모니터 ────────────────────────────────────────────────────────

function startTFMonitor(tf, stateRef, settingsRef, rsiParamsRef, onAlertRef) {
  let closed = false;

  stateRef.current[tf] = {
    candles: [], ws: null,
    rsiState: null, prevRSI: null,
    inOB: false, inOS: false,
    lastOBAlert: 0, lastOSAlert: 0, // 마지막 알람 타임스탬프(ms)
    lastOBAlertCandleTime: 0,
    lastOSAlertCandleTime: 0,
  };

  // 초기 캔들 REST 로드
  fetch(`${BN_PUBLIC}/fapi/v1/klines?symbol=BTCUSDT&interval=${tf}&limit=300`)
    .then(r => r.json())
    .then(d => {
      if (closed) return;
      const st = stateRef.current[tf];
      if (!st) return;
      st.candles = d.map(k => ({ t: new Date(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
      const closed_ = st.candles.slice(0, -1);
      const period0 = rsiParamsRef.current.period ?? 14;
      st.rsiState = buildRSIState(closed_, period0);
      st.prevRSI  = st.rsiState?.rsi ?? null;
    })
    .catch(e => console.error("[AlertMonitor] REST 실패", tf, e));

  // WebSocket 연결
  const connectWS = () => {
    if (closed) return;
    const ws = new WebSocket(`${BN_WS}/ws/btcusdt@kline_${tf}`);
    stateRef.current[tf].ws = ws;

    ws.onmessage = (evt) => {
      const k      = JSON.parse(evt.data).k;
      const candle = { t: new Date(k.t), o: +k.o, h: +k.h, l: +k.l, c: +k.c };
      const st     = stateRef.current[tf];
      if (!st || !st.candles.length) return;

      const arr        = st.candles;
      const last       = arr[arr.length - 1];
      const isNewCandle = candle.t.getTime() !== last.t.getTime();
      const s          = settingsRef.current[tf] || {};

      if (isNewCandle) {
        arr.push(candle);
        if (arr.length > 350) arr.shift();

        const closed_ = arr.slice(0, -1);
        const rp        = rsiParamsRef.current;
        const period    = rp.period     ?? 14;
        const obThr     = rp.overbought ?? 70;
        const osThr     = rp.oversold   ?? 30;
        st.rsiState = buildRSIState(closed_, period);
        st.prevRSI  = st.rsiState?.rsi ?? null;

        // 봉 마감 RSI 기준으로 inOB/inOS 재평가
        // → 마감 RSI가 이미 과매수 이상이면 새 봉에서 재알람 방지
        const closedRSI = st.rsiState?.rsi ?? null;
        if (closedRSI !== null) {
          if      (closedRSI >= obThr)      st.inOB = true;
          else if (closedRSI <  obThr - 5)  st.inOB = false;
          // (obThr-5)~obThr 사이는 현재 플래그 유지 (히스테리시스 구간)

          if      (closedRSI <= osThr)      st.inOS = true;
          else if (closedRSI >  osThr + 5)  st.inOS = false;
        }

        // 봉 마감 알림
        if (s.close) onAlertRef.current(`${TF_LABEL[tf]} 봉 마감`);

      } else {
        arr[arr.length - 1] = candle;
      }

      // RSI 과매수/과매도 (매 틱, 히스테리시스: 진입 obThr/osThr, 복귀 (obThr-5)/(osThr+5) + 쿨다운)
      if ((s.rsiOB || s.rsiOS) && st.rsiState && arr.length >= 2) {
        const rp_        = rsiParamsRef.current;
        const period_    = rp_.period     ?? 14;
        const obThr_     = rp_.overbought ?? 70;
        const osThr_     = rp_.oversold   ?? 30;
        const prevClose  = arr[arr.length - 2].c;
        const currRSI    = tickRSI(st.rsiState, prevClose, candle.c, period_);
        const cooldownMs = TF_MS[tf] ?? 300_000;
        const now        = Date.now();
        const candleTime = candle.t.getTime();
        if (currRSI !== null) {
          if (s.rsiOB) {
            if (!st.inOB && currRSI >= obThr_ && st.lastOBAlertCandleTime !== candleTime && now - st.lastOBAlert > cooldownMs) {
              st.inOB = true;
              st.lastOBAlert = now;
              st.lastOBAlertCandleTime = candleTime;
              onAlertRef.current(`${TF_LABEL[tf]} RSI 과매수 진입 (${currRSI.toFixed(1)})`);
            } else if (st.inOB && currRSI < obThr_ - 5) {
              st.inOB = false;
            }
          }
          if (s.rsiOS) {
            if (!st.inOS && currRSI <= osThr_ && st.lastOSAlertCandleTime !== candleTime && now - st.lastOSAlert > cooldownMs) {
              st.inOS = true;
              st.lastOSAlert = now;
              st.lastOSAlertCandleTime = candleTime;
              onAlertRef.current(`${TF_LABEL[tf]} RSI 과매도 진입 (${currRSI.toFixed(1)})`);
            } else if (st.inOS && currRSI > osThr_ + 5) {
              st.inOS = false;
            }
          }
        }
        st.prevRSI = currRSI;
      }
    };

    ws.onerror = e => console.error("[AlertMonitor] WS 오류", tf, e);
    ws.onclose = () => { if (!closed) setTimeout(connectWS, 3000); };
  };

  connectWS();

  return () => {
    closed = true;
    const st = stateRef.current[tf];
    if (st?.ws) st.ws.close();
  };
}

// ── 메인 훅 ───────────────────────────────────────────────────────────────────

export function useAlertMonitor(settings, onAlert, rsiParams = {}) {
  const settingsRef  = useRef(settings);
  settingsRef.current = settings;
  const onAlertRef   = useRef(onAlert);
  onAlertRef.current = onAlert;
  const rsiParamsRef = useRef(rsiParams);
  rsiParamsRef.current = rsiParams;
  const stateRef     = useRef({});

  useEffect(() => {
    const cleanups = ALL_TF.map(tf =>
      startTFMonitor(tf, stateRef, settingsRef, rsiParamsRef, onAlertRef)
    );
    return () => {
      cleanups.forEach(fn => fn());
      stateRef.current = {};
    };
  }, []); // 마운트/언마운트 시에만 — settings는 ref로 항상 최신값 참조

  // rsiParams.period 변경 시 rsiState를 새 기간으로 재빌드 (틱 RSI 연속성 유지)
  useEffect(() => {
    const period = rsiParams.period ?? 14;
    ALL_TF.forEach(tf => {
      const st = stateRef.current[tf];
      if (!st?.candles.length) return;
      const closed_ = st.candles.slice(0, -1);
      st.rsiState = buildRSIState(closed_, period);
      st.prevRSI  = st.rsiState?.rsi ?? null;
    });
  }, [rsiParams.period]);
}
