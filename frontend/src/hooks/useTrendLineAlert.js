import { useEffect, useRef } from "react";
import { fibPrice, fmtFibRatio, fibLevelsOf } from "../chart/fib";
import { useStore } from "../store";

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
  // 레벨은 도형마다 다르므로 렌더(Fibs.jsx)·히트(findHitFib)와 똑같이
  // `fibLevelsOf(fb)`로 도형에서 읽는다 (chart/fib.js [F1]).
  // 여기서만 다른 목록을 보면 "화면에 없는 선에서 알림이 온다"가 된다
  fibs = [], setFibAlertOff = () => {},
) {
  const nearRef    = useRef({});
  const pendingRef = useRef(new Set());

  useEffect(() => {
    if (!candles.length) return;
    const last  = candles[candles.length - 1];
    const lastT = last.t instanceof Date ? last.t.getTime() : +last.t;
    // ⚠ 현재가는 **`liveClose`를 본다 — `candles`의 마지막 봉을 쓰지 말 것** (2026-08-25).
    //   `useCandles`는 진행 중 봉을 `candlesRef`에서만 갱신하고 React 상태는
    //   봉마감 때 한 번만 복사한다 → 여기 `last.c`는 **그 봉이 열릴 때 가격**이다.
    //   1h면 최대 한 시간 묵은 값으로 0.2%를 재게 되어,
    //   화면에서 선에 닿았는데도 안 울리고 반대로 멀어졌는데 울렸다
    //   ※ **구독하지 않고 그때그때 읽는다**(`getState`) — 틱마다 구독하면
    //     이 훅을 부르는 App 전체가 매 틱 리렌더된다 (Structures.jsx와 같은 이유)
    const price = useStore.getState().liveClose ?? last.c;

    // 삭제된 도형의 nearRef/pendingRef 잔존 키 정리 (메모리 누수 + alert 복귀 막힘 방지)
    //
    // ⚠ **nearRef도 `pendingRef`와 같이 "알림이 켜진 도형"만 남긴다** (2026-08-25).
    //   예전엔 **도형 존재 기준**이라, 한 번 울려 알림이 꺼진 뒤 다시 켜도
    //   `nearRef[key]`가 true로 남아 있어 **가격이 선에 닿아 있는데도 영영 안 울렸다**
    //   (사용자 신고). 0.3% 밖으로 나갔다 돌아와야만 풀렸기 때문이다
    //   → 알림을 다시 켜는 것이 곧 **다시 물어보겠다**는 뜻이므로, 그때 근접
    //     상태를 백지에서 다시 재는 게 맞다 (닿아 있으면 곧바로 울린다)
    //   ※ 알림이 **켜져 있는 동안에는 그대로 남는다** — 가격이 선 옆에 머무르는
    //     동안 봉마감마다 다시 울리면 안 되므로 히스테리시스는 살아 있다
    const aliveKeys = new Set();
    for (const ln of (lines || []))    { if (!ln.alert) continue; aliveKeys.add(`l${ln.id}`); }
    for (const ch of (channels || [])) { if (!ch.alert) continue; aliveKeys.add(`ch${ch.id}`); aliveKeys.add(`ch${ch.id}_m`); aliveKeys.add(`ch${ch.id}_r`); }
    for (const ci of (circles || []))  { if (!ci.alert) continue; aliveKeys.add(`ci${ci.id}`); }
    // 피보나치는 도형 하나가 레벨 수만큼 키를 갖는다. 팝업에서 레벨을 끄면
    // 그 키는 여기서 자연히 빠져 정리된다 (다시 켰을 때 "이미 근접" 상태로 남지 않는다)
    for (const fb of (fibs || [])) { if (!fb.alert) continue; for (const r of fibLevelsOf(fb)) aliveKeys.add(`fb${fb.id}_${r}`); }
    // ⚠ **`pendingRef`는 도형의 `locked`(단축키 `l`)와 아무 관계가 없다.**
    //   저건 "못 움직이게 잠갔다"이고 이건 **"이 도형은 이미 울렸다"는 표시**다.
    //   이름이 헷갈리니 주석에서 "잠금"이라 부르지 말 것 — 실제로 혼동이 있었다
    //
    // ⚠ 울림 표시는 **알림이 켜진 도형만** 남긴다 — 존재 여부가 아니다 (2026-08-25).
    //   토스트가 닫히면 그 도형의 알림이 꺼지는데 표시는 그대로 남는다. 여기서 치우지
    //   않으면 **나중에 🔔을 다시 켰을 때 표시가 남아 있어 영영 안 울린다**
    //   (`a` 단축키는 `alert`만 건드리므로 이 표시를 지워 주지 않는다).
    //   ※ 이건 "닫을 때 표시를 지운다"가 아니다 — 알림이 켜져 있는 동안에는 남아
    //     있어야 같은 도형이 토스트를 연달아 띄우지 않는다
    //   ※ nearRef(위 aliveKeys)도 **같은 기준**이다 (2026-08-25 변경) — 알림을 다시 켜면
    //     근접 상태를 백지에서 다시 재므로, 가격이 이미 선에 닿아 있으면 곧바로 울린다
    const aliveGroupKeys = new Set([
      ...(lines || []).filter(l => l.alert).map(l => `l${l.id}`),
      ...(channels || []).filter(c => c.alert).map(c => `ch${c.id}`),
      ...(circles || []).filter(c => c.alert).map(c => `ci${c.id}`),
      ...(fibs || []).filter(f => f.alert).map(f => `fb${f.id}`),
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
        // ⚠ **기준은 현재가다** — 문구에도 "현재가 위/아래"라고 적는다 (2026-09-04 사용자 요청).
        //   `(위)`만 쓰면 "선이 위에 있다"로도 읽혀 뜻이 반대로 전해진다.
        //   채널·원·피보나치 세 곳도 같은 규칙이다
        const side = price >= linePrice ? "위" : "아래";
        // ⚠ **닫는 방법과 무관하게 하는 일이 하나다** (2026-08-25 사용자 지정):
        //   `확인`을 누르든 20초가 지나 저절로 닫히든 → **그 도형의 알림을 끈다.**
        //   울림 표시(pendingRef)도 nearRef도 여기서 건드리지 않는다.
        //   즉 **알림을 켜 둔 도형은 한 번 울리고 스스로 꺼진다** — 다시 받으려면
        //   팝업 🔔이나 단축키 `a`로 켠다
        //
        //   ⚠ 울림 표시를 지우지 말 것 — 지우면 가격이 아직 선 근처라, 알림 OFF가 반영되기
        //     전 한 틱에 같은 토스트가 곧바로 다시 뜬다
        //   ⚠ nearRef도 되돌리지 말 것 — 되돌리면 가격이 선 옆에 머무는 동안
        //     20초마다 끝없이 울린다. 0.3% 밖으로 나갔다 돌아와야 다시 울리는 게 맞다
        //   ※ 남은 표시는 위 정리 블록이 치운다(알림이 꺼진 도형은 감시 대상이 아니다).
        //     그래서 나중에 🔔을 다시 켜도 표시가 남아 막지 않는다
        onAlert(`추세선 근접 (현재가 ${side})  ${fmt(price)}`, () => setLineAlertOff(line.id));
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
          onAlert(`채널선 근접 (현재가 ${side})  ${fmt(price)}`, () => setChannelAlertOff(ch.id));
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
        onAlert(`원 근접 (현재가 ${side})  ${fmt(price)}`, () => setCircleAlertOff(ci.id));
      }
    }
    // ── 피보나치 (레벨 가로선 각각) ───────────────────────────────────────────
    // 그룹 키(fb{id})로 한 번 울리면 그 도형은 토스트가 닫힐 때까지 조용해진다 — 채널과 같은 규칙.
    // 레벨이 7~10개라 그렇게 안 하면 되돌림 한 번에 토스트가 여러 개 쌓인다.
    for (const fb of (fibs || [])) {
      if (!fb.alert) continue;
      const gkey = `fb${fb.id}`;
      if (pendingRef.current.has(gkey)) continue;
      const levels = fibLevelsOf(fb);
      for (const r of levels) {
        const target = fibPrice(fb.p1, fb.p2, r, isLog);
        const ev = checkNear(price, target, `${gkey}_${r}`, nearRef);
        if (ev !== "enter") continue;
        pendingRef.current.add(gkey);
        const side = price >= target ? "위" : "아래";
        onAlert(`피보나치 ${fmtFibRatio(r)} 근접 (현재가 ${side})  ${fmt(price)}`, () => setFibAlertOff(fb.id));
        break;
      }
    }
  // lines/channels/circles/fibs 변경(드래그 포함) 시에도 즉시 체크.
  // 레벨을 켜고 끄면 fibs 배열이 새로 만들어지므로(useDrawableStore.update) 여기 걸린다 —
  // 별도의 fibLevels deps가 필요 없다
  }, [candles, lines, channels, circles, fibs]); // eslint-disable-line react-hooks/exhaustive-deps
}
