import { useEffect, useRef, useState } from "react";
import { BN_PUBLIC } from "../constants";

const RSI_PERIOD  = 14;
const ALL_TF      = ["5m", "15m", "1h", "4h", "1d", "1w"];
const TF_LABEL    = { "5m": "5분", "15m": "15분", "1h": "1시간", "4h": "4시간", "1d": "1일", "1w": "1주" };
// 타임프레임별 봉 길이(초) — 알람 쿨다운 기준
const TF_SECS     = { "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };

// ── RSI 유틸 ──────────────────────────────────────────────────────────────────

function buildRSIState(candles) {
  if (candles.length < RSI_PERIOD + 1) return null;
  const cl = candles.map(c => c.c);
  let ag = 0, al = 0;
  for (let i = 1; i <= RSI_PERIOD; i++) {
    const d = cl[i] - cl[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= RSI_PERIOD; al /= RSI_PERIOD;
  for (let i = RSI_PERIOD + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    ag = (ag * (RSI_PERIOD - 1) + Math.max(d, 0)) / RSI_PERIOD;
    al = (al * (RSI_PERIOD - 1) + Math.max(-d, 0)) / RSI_PERIOD;
  }
  return { ag, al, rsi: al === 0 ? 100 : 100 - 100 / (1 + ag / al) };
}

function tickRSI(state, prevClose, currClose) {
  if (!state) return null;
  const d  = currClose - prevClose;
  const ag = (state.ag * (RSI_PERIOD - 1) + Math.max(d, 0)) / RSI_PERIOD;
  const al = (state.al * (RSI_PERIOD - 1) + Math.max(-d, 0)) / RSI_PERIOD;
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function buildRSIArray(candles) {
  if (candles.length < RSI_PERIOD + 1) return [];
  const cl = candles.map(c => c.c);
  let ag = 0, al = 0;
  for (let i = 1; i <= RSI_PERIOD; i++) {
    const d = cl[i] - cl[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= RSI_PERIOD; al /= RSI_PERIOD;
  const data = [{ t: candles[RSI_PERIOD].t, rsi: al === 0 ? 100 : 100 - 100 / (1 + ag / al) }];
  for (let i = RSI_PERIOD + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    ag = (ag * (RSI_PERIOD - 1) + Math.max(d, 0)) / RSI_PERIOD;
    al = (al * (RSI_PERIOD - 1) + Math.max(-d, 0)) / RSI_PERIOD;
    data.push({ t: candles[i].t, rsi: al === 0 ? 100 : 100 - 100 / (1 + ag / al) });
  }
  return data;
}

// ── 다이버전스 감지 ────────────────────────────────────────────────────────────

function findPeaks(data, lb) {
  const r = [];
  for (let i = lb; i < data.length - lb; i++) {
    let ok = true;
    for (let j = 1; j <= lb; j++) {
      if (data[i].rsi <= data[i-j].rsi || data[i].rsi <= data[i+j].rsi) { ok = false; break; }
    }
    if (ok) r.push(i);
  }
  return r;
}

function findTroughs(data, lb) {
  const r = [];
  for (let i = lb; i < data.length - lb; i++) {
    let ok = true;
    for (let j = 1; j <= lb; j++) {
      if (data[i].rsi >= data[i-j].rsi || data[i].rsi >= data[i+j].rsi) { ok = false; break; }
    }
    if (ok) r.push(i);
  }
  return r;
}

// t1/r1/t2/r2 포함 — 차트 렌더링에 사용
function detectDivs(candles, peakLb, scan) {
  const slice  = candles.slice(-scan);
  const rsiArr = buildRSIArray(slice);
  if (rsiArr.length < 20) return [];

  const cMap = new Map();
  for (const c of slice) cMap.set(+c.t, c);

  const peaks   = findPeaks(rsiArr, peakLb);
  const troughs = findTroughs(rsiArr, peakLb);
  const divs    = [];

  for (let i = peaks.length - 1; i >= 1; i--) {
    const rA = rsiArr[peaks[i-1]], rB = rsiArr[peaks[i]];
    const cA = cMap.get(+rA.t), cB = cMap.get(+rB.t);
    if (!cA || !cB) continue;
    if (cB.h > cA.h && rB.rsi < rA.rsi)
      divs.push({ type: "regular", dir: "bear", key: `rb${+rB.t}`, t1: rA.t, r1: rA.rsi, t2: rB.t, r2: rB.rsi });
    else if (cB.h < cA.h && rB.rsi > rA.rsi)
      divs.push({ type: "hidden",  dir: "bear", key: `hb${+rB.t}`, t1: rA.t, r1: rA.rsi, t2: rB.t, r2: rB.rsi });
  }
  for (let i = troughs.length - 1; i >= 1; i--) {
    const rA = rsiArr[troughs[i-1]], rB = rsiArr[troughs[i]];
    const cA = cMap.get(+rA.t), cB = cMap.get(+rB.t);
    if (!cA || !cB) continue;
    if (cB.l < cA.l && rB.rsi > rA.rsi)
      divs.push({ type: "regular", dir: "bull", key: `ru${+rB.t}`, t1: rA.t, r1: rA.rsi, t2: rB.t, r2: rB.rsi });
    else if (cB.l > cA.l && rB.rsi < rA.rsi)
      divs.push({ type: "hidden",  dir: "bull", key: `hu${+rB.t}`, t1: rA.t, r1: rA.rsi, t2: rB.t, r2: rB.rsi });
  }
  return divs;
}

// ── 타임프레임별 모니터 ────────────────────────────────────────────────────────

function startTFMonitor(tf, stateRef, settingsRef, divParamsRef, rsiParamsRef, onAlertRef, onDivUpdate) {
  let closed = false;

  stateRef.current[tf] = {
    candles: [], ws: null,
    rsiState: null, prevRSI: null,
    lastDivKeys: new Set(),
    inOB: false, inOS: false,
    lastOBAlert: 0, lastOSAlert: 0, // 마지막 알람 타임스탬프(ms)
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
      st.rsiState = buildRSIState(closed_);
      st.prevRSI  = st.rsiState?.rsi ?? null;
      const dp = divParamsRef.current;
      const divs = detectDivs(closed_, dp.peak_lb ?? 5, dp.scan_candles ?? 300);
      st.lastDivKeys = new Set(divs.map(d => d.key));
      onDivUpdate(tf, divs.slice(0, dp.max_show ?? 10));
    })
    .catch(e => console.error("[AlertMonitor] REST 실패", tf, e));

  // WebSocket 연결
  const connectWS = () => {
    if (closed) return;
    const ws = new WebSocket(`wss://fstream.binance.com/ws/btcusdt@kline_${tf}`);
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
        st.rsiState = buildRSIState(closed_);
        st.prevRSI  = st.rsiState?.rsi ?? null;

        // 봉 마감 RSI 기준으로 inOB/inOS 재평가
        // → 마감 RSI가 이미 과매수 이상이면 새 봉에서 재알람 방지
        const rp        = rsiParamsRef.current;
        const obThr     = rp.overbought ?? 70;
        const osThr     = rp.oversold   ?? 30;
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

        // 다이버전스 (봉 마감 시에만 체크) — detectDivs 1회만 호출
        {
          const dp      = divParamsRef.current;
          const divs    = detectDivs(closed_, dp.peak_lb ?? 5, dp.scan_candles ?? 300);
          const newKeys = new Set(divs.map(d => d.key));
          if (s.div || s.hiddenDiv) {
            for (const div of divs) {
              if (!st.lastDivKeys.has(div.key)) {
                if (div.type === "regular" && s.div) {
                  const label = div.dir === "bull" ? "불리시 다이버전스" : "베어리시 다이버전스";
                  onAlertRef.current(`${TF_LABEL[tf]} ${label}`);
                }
                if (div.type === "hidden" && s.hiddenDiv) {
                  const label = div.dir === "bull" ? "히든 불리시 다이버전스" : "히든 베어리시 다이버전스";
                  onAlertRef.current(`${TF_LABEL[tf]} ${label}`);
                }
              }
            }
          }
          st.lastDivKeys = newKeys;
          onDivUpdate(tf, divs.slice(0, dp.max_show ?? 10));
        }

      } else {
        arr[arr.length - 1] = candle;
      }

      // RSI 과매수/과매도 (매 틱, 히스테리시스: 진입 obThr/osThr, 복귀 (obThr-5)/(osThr+5) + 쿨다운)
      if ((s.rsiOB || s.rsiOS) && st.rsiState && arr.length >= 2) {
        const rp_        = rsiParamsRef.current;
        const obThr_     = rp_.overbought ?? 70;
        const osThr_     = rp_.oversold   ?? 30;
        const prevClose  = arr[arr.length - 2].c;
        const currRSI    = tickRSI(st.rsiState, prevClose, candle.c);
        const cooldownMs = (TF_SECS[tf] ?? 300) * 1000;
        const now        = Date.now();
        if (currRSI !== null) {
          if (s.rsiOB) {
            if (!st.inOB && currRSI >= obThr_ && now - st.lastOBAlert > cooldownMs) {
              st.inOB = true;
              st.lastOBAlert = now;
              onAlertRef.current(`${TF_LABEL[tf]} RSI 과매수 진입 (${currRSI.toFixed(1)})`);
            } else if (st.inOB && currRSI < obThr_ - 5) {
              st.inOB = false;
            }
          }
          if (s.rsiOS) {
            if (!st.inOS && currRSI <= osThr_ && now - st.lastOSAlert > cooldownMs) {
              st.inOS = true;
              st.lastOSAlert = now;
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

export function useAlertMonitor(settings, onAlert, divParams = {}, rsiParams = {}) {
  const settingsRef  = useRef(settings);
  settingsRef.current = settings;
  const onAlertRef   = useRef(onAlert);
  onAlertRef.current = onAlert;
  const divParamsRef = useRef(divParams);
  divParamsRef.current = divParams;
  const rsiParamsRef = useRef(rsiParams);
  rsiParamsRef.current = rsiParams;
  const stateRef     = useRef({});

  const [divsByTF, setDivsByTF] = useState({});

  useEffect(() => {
    const cleanups = ALL_TF.map(tf =>
      startTFMonitor(tf, stateRef, settingsRef, divParamsRef, rsiParamsRef, onAlertRef, (tf, divs) => {
        setDivsByTF(prev => ({ ...prev, [tf]: divs }));
      })
    );
    return () => {
      cleanups.forEach(fn => fn());
      stateRef.current = {};
    };
  }, []); // 마운트/언마운트 시에만 — settings는 ref로 항상 최신값 참조

  // divParams 변경 시 즉시 재계산
  useEffect(() => {
    const { peak_lb = 5, scan_candles = 300, max_show = 10 } = divParams;
    ALL_TF.forEach(tf => {
      const st = stateRef.current[tf];
      if (!st?.candles.length) return;
      const closed_ = st.candles.slice(0, -1);
      const divs = detectDivs(closed_, peak_lb, scan_candles);
      st.lastDivKeys = new Set(divs.map(d => d.key));
      setDivsByTF(prev => ({ ...prev, [tf]: divs.slice(0, max_show) }));
    });
  }, [divParams.peak_lb, divParams.scan_candles, divParams.max_show]); // eslint-disable-line react-hooks/exhaustive-deps

  return { divsByTF };
}
