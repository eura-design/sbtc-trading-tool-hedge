import { useEffect, useRef } from "react";
import { fibPrice, fmtFibRatio } from "../chart/fib";

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
  // 피보나치 — 레벨 가로선 **각각**이 근접 대상이다.
  // fibLevels는 화면에 그려지는 것과 같은 배열이어야 한다 (App.jsx의 useMemo 하나).
  // 여기서만 다른 목록을 보면 "화면에 없는 선에서 알림이 온다"가 된다
  fibs = [], setFibAlertOff = () => {}, fibLevels = [],
) {
  const nearRef    = useRef({});
  const pendingRef = useRef(new Set());

  useEffect(() => {
    if (!candles.length) return;
    const last  = candles[candles.length - 1];
    const lastT = last.t instanceof Date ? last.t.getTime() : +last.t;
    const price = last.c;

    // 삭제된 도형의 nearRef/pendingRef 잔존 키 정리 (메모리 누수 + alert 복귀 막힘 방지)
    const aliveKeys = new Set();
    for (const ln of (lines || []))     aliveKeys.add(`l${ln.id}`);
    for (const ch of (channels || [])) { aliveKeys.add(`ch${ch.id}`); aliveKeys.add(`ch${ch.id}_m`); aliveKeys.add(`ch${ch.id}_r`); }
    for (const ci of (circles || []))   aliveKeys.add(`ci${ci.id}`);
    // 피보나치는 도형 하나가 레벨 수만큼 키를 갖는다. 지표 메뉴에서 레벨을 끄면
    // 그 키는 여기서 자연히 빠져 정리된다 (다시 켰을 때 "이미 근접" 상태로 남지 않는다)
    for (const fb of (fibs || [])) for (const r of fibLevels) aliveKeys.add(`fb${fb.id}_${r}`);
    const aliveGroupKeys = new Set([
      ...(lines || []).map(l => `l${l.id}`),
      ...(channels || []).map(c => `ch${c.id}`),
      ...(circles || []).map(c => `ci${c.id}`),
      ...(fibs || []).map(f => `fb${f.id}`),
    ]);
    for (const k of Object.keys(nearRef.current)) {
      if (!aliveKeys.has(k)) delete nearRef.current[k];
    }
    for (const k of Array.from(pendingRef.current)) {
      if (!aliveGroupKeys.has(k)) pendingRef.current.delete(k);
    }

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
    // ── 피보나치 (레벨 가로선 각각) ───────────────────────────────────────────
    // 그룹 키(fb{id})로 한 번 울리면 그 도형은 확인 전까지 조용해진다 — 채널과 같은 규칙.
    // 레벨이 7~10개라 그렇게 안 하면 되돌림 한 번에 토스트가 여러 개 쌓인다.
    for (const fb of (fibs || [])) {
      if (!fb.alert) continue;
      const gkey = `fb${fb.id}`;
      if (pendingRef.current.has(gkey)) continue;
      for (const r of fibLevels) {
        const target = fibPrice(fb.p1, fb.p2, r, isLog);
        const ev = checkNear(price, target, `${gkey}_${r}`, nearRef);
        if (ev !== "enter") continue;
        pendingRef.current.add(gkey);
        const side = price >= target ? "위" : "아래";
        onAlert(`피보나치 ${fmtFibRatio(r)} 근접 (${side})  ${fmt(price)}`, () => {
          setFibAlertOff(fb.id);
          pendingRef.current.delete(gkey);
          for (const rr of fibLevels) nearRef.current[`${gkey}_${rr}`] = false;
        });
        break;
      }
    }
  // lines/channels/circles/fibs 변경(드래그 포함) 시에도 즉시 체크.
  // fibLevels도 봐야 한다 — 레벨을 켜면 그 선의 근접 판정이 바로 시작돼야 한다
  }, [candles, lines, channels, circles, fibs, fibLevels]); // eslint-disable-line react-hooks/exhaustive-deps
}
