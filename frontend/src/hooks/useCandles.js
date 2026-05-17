import { useState, useEffect, useRef } from "react";
import { BN_PUBLIC, BN_WS } from "../constants";
import { useStore } from "../store";

export function useCandles(interval, onTickRef) {
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const candlesRef = useRef([]);
  const wsRafRef   = useRef(null);

  useEffect(() => {
    candlesRef.current = []; setCandles([]); setLoading(true);
    let ws = null, closed = false, retryTimer = null;

    const connectWS = () => {
      if (closed) return;
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.onclose = null;
        ws.close();
      }
      ws = new WebSocket(`${BN_WS}/ws/btcusdt@kline_${interval}`);
      ws.onmessage = (evt) => {
        const k = JSON.parse(evt.data).k;
        const candle = { t: new Date(k.t), o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v };
        const arr = candlesRef.current;
        if (!arr.length) return;
        const last = arr[arr.length - 1];

        if (candle.t.getTime() === last.t.getTime()) {
          arr[arr.length - 1] = candle;
          if (wsRafRef.current !== null) return;
          wsRafRef.current = requestAnimationFrame(() => {
            wsRafRef.current = null;
            if (!closed) {
              onTickRef?.current?.();
              useStore.getState().setLiveClose(arr[arr.length - 1].c);
            }
          });
        } else if (candle.t > last.t) {
          arr.push(candle);
          if (arr.length > 3100) arr.shift();
          if (!closed) {
            setCandles([...arr]);
            useStore.getState().setLiveClose(candle.c);
          }
        }
      };
      ws.onerror = e => console.error("WS error", e);
      ws.onclose = () => {
        if (!closed) {
          console.warn("[WS] 연결 끊김, 3초 후 재연결...");
          retryTimer = setTimeout(connectWS, 3000);
        }
      };
    };

    const load = async () => {
      try {
        const parse = d => Array.isArray(d) ? d.map(k => ({ t: new Date(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })) : [];
        const r1 = await fetch(`${BN_PUBLIC}/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=1500`);
        const recent = parse(await r1.json());
        if (!recent.length) {
          console.warn(`[useCandles] ${interval} 캔들 응답 없음 — 재연결 대기`);
          return;
        }
        const endTime = recent[0].t.getTime() - 1;
        const r2 = await fetch(`${BN_PUBLIC}/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=1500&endTime=${endTime}`);
        const older = parse(await r2.json());
        const parsed = [...older, ...recent];
        if (closed) return;
        candlesRef.current = parsed;
        setCandles([...parsed]);
        useStore.getState().setLiveClose(parsed[parsed.length - 1]?.c ?? null);
      } catch(e) { console.error(e); } finally { if (!closed) setLoading(false); }

      connectWS();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && (!ws || ws.readyState === WebSocket.CLOSED)) {
        console.log("[WS] 탭 활성화 — 재연결");
        clearTimeout(retryTimer);
        connectWS();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    load();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      if (wsRafRef.current !== null) { cancelAnimationFrame(wsRafRef.current); wsRafRef.current = null; }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (ws) ws.close();
    };
  }, [interval]);

  return { candles, candlesRef, loading };
}
