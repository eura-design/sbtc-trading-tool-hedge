import { useEffect, useRef } from "react";

const PROXIMITY_PCT  = 0.002; // 0.2% 이내 → 근접 알림
const HYSTERESIS_PCT = 0.003; // 0.3% 이상 멀어지면 "근접" 상태 해제

function linePriceAt(t1, p1, t2, p2, t) {
  const dt = t2 - t1;
  if (dt === 0) return p1;
  return p1 + (p2 - p1) * (t - t1) / dt;
}

function checkNear(price, target, key, nearRef) {
  if (!isFinite(target) || target === 0) return null;
  const dist    = Math.abs(price - target) / target;
  const isNear  = dist < PROXIMITY_PCT;
  const wasNear = nearRef.current[key] ?? false;
  if (isNear && !wasNear)  { nearRef.current[key] = true;  return "enter"; }
  if (wasNear && dist > HYSTERESIS_PCT) { nearRef.current[key] = false; return "leave"; }
  return null;
}

function fmt(price) {
  return "$" + price.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

export function useTrendLineAlert(
  lines, candles, onAlert, setLineAlertOff,
  channels, setChannelAlertOff,
  circles,  setCircleAlertOff,
  isLog = false,
) {
  const nearRef    = useRef({});
  const pendingRef = useRef(new Set());

  useEffect(() => {
    if (!candles.length) return;
    const last  = candles[candles.length - 1];
    const lastT = last.t instanceof Date ? last.t.getTime() : +last.t;
    const price = last.c;

    // ── 추세선 ────────────────────────────────────────────────────────────────
    for (const line of (lines || [])) {
      if (!line.alert) continue;
      const gkey = `l${line.id}`;
      if (pendingRef.current.has(gkey)) continue;
      const linePrice = linePriceAt(+line.t1, line.p1, +line.t2, line.p2, lastT);
      const ev = checkNear(price, linePrice, gkey, nearRef);
      if (ev === "enter") {
        pendingRef.current.add(gkey);
        const side = price >= linePrice ? "위" : "아래";
        onAlert(`추세선 근접 (${side})  ${fmt(price)}`, () => {
          setLineAlertOff(line.id);
          pendingRef.current.delete(gkey);
          nearRef.current[gkey] = false;
        });
      }
    }

    // ── 채널 (메인선 + 미러선 각각 체크) ─────────────────────────────────────
    for (const ch of (channels || [])) {
      if (!ch.alert) continue;
      if (ch.offset == null || !isFinite(ch.offset)) continue;
      const gkey = `ch${ch.id}`;
      if (pendingRef.current.has(gkey)) continue;
      for (const [suffix, p1, p2] of [
        ["m", ch.p1,                                              ch.p2                                             ],
        ["r", isLog ? ch.p1 * ch.offset : ch.p1 + ch.offset,    isLog ? ch.p2 * ch.offset : ch.p2 + ch.offset   ],
      ]) {
        const linePrice = linePriceAt(+ch.t1, p1, +ch.t2, p2, lastT);
        const ev = checkNear(price, linePrice, `${gkey}_${suffix}`, nearRef);
        if (ev === "enter") {
          pendingRef.current.add(gkey);
          const side = price >= linePrice ? "위" : "아래";
          onAlert(`채널선 근접 (${side})  ${fmt(price)}`, () => {
            setChannelAlertOff(ch.id);
            pendingRef.current.delete(gkey);
            nearRef.current[`${gkey}_m`] = false;
            nearRef.current[`${gkey}_r`] = false;
          });
          break;
        }
      }
    }

    // ── 원 (중심 가격 기준) ───────────────────────────────────────────────────
    for (const ci of (circles || [])) {
      if (!ci.alert) continue;
      const gkey = `ci${ci.id}`;
      if (pendingRef.current.has(gkey)) continue;
      const ev = checkNear(price, ci.cx_p, gkey, nearRef);
      if (ev === "enter") {
        pendingRef.current.add(gkey);
        const side = price >= ci.cx_p ? "위" : "아래";
        onAlert(`원 근접 (${side})  ${fmt(price)}`, () => {
          setCircleAlertOff(ci.id);
          pendingRef.current.delete(gkey);
          nearRef.current[gkey] = false;
        });
      }
    }
  // lines/channels/circles 변경(드래그 포함) 시에도 즉시 체크
  }, [candles, lines, channels, circles]); // eslint-disable-line react-hooks/exhaustive-deps
}
