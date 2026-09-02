import { useState, useEffect, useRef } from "react";
import { BN_PUBLIC, BN_WS, DEFAULT_SYMBOL } from "../constants";
import { useStore } from "../store";

/**
 * @param enabled false면 REST·WebSocket 둘 다 붙지 않는다 — 리플레이 모드용.
 *   실시간 캔들이 계속 흐르면 liveClose가 현재가로 덮이고(과거를 보는 중인데 현재가가
 *   뜬다) WS도 쓸데없이 열려 있다. 리플레이는 useReplay가 같은 계약으로 대체한다.
 */
export function useCandles(interval, onTickRef, enabled = true, symbol = DEFAULT_SYMBOL) {
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const candlesRef = useRef([]);
  const wsRafRef   = useRef(null);

  useEffect(() => {
    candlesRef.current = []; setCandles([]);
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    let ws = null, closed = false, retryTimer = null;

    const connectWS = () => {
      if (closed) return;
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.onclose = null;
        ws.close();
      }
      // 스트림 이름은 **소문자**여야 한다 — 대문자로 보내면 조용히 아무것도 안 온다
      ws = new WebSocket(`${BN_WS}/ws/${symbol.toLowerCase()}@kline_${interval}`);
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
        const r1 = await fetch(`${BN_PUBLIC}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=1500`);
        const recent = parse(await r1.json());
        if (!recent.length) {
          console.warn(`[useCandles] ${symbol} ${interval} 캔들 응답 없음 - 재연결 대기`);
          return;
        }
        const endTime = recent[0].t.getTime() - 1;
        const r2 = await fetch(`${BN_PUBLIC}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=1500&endTime=${endTime}`);
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
  }, [interval, enabled, symbol]);   // 심볼이 바뀌면 캔들을 통째로 다시 받는다

  return { candles, candlesRef, loading };
}
