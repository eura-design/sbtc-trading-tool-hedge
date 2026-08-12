import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { getZzChochSignal } from "../chart/structureZigzag";
import { getStructLiveChochs } from "../chart/structRenderState";

// CHoCH 발생 알림 — 자동 ZZ + 수동 구조 공용
//
// ── 왜 훅에서 폴링하듯 비교하는가 ──────────────────────────────────────────
// 두 지표 모두 CHoCH가 **React 상태로 올라오지 않는다**:
//   - 자동 ZZ    : 캔버스 렌더 경로(candleRenderer)에서 계산 → 모듈 상태
//   - 수동 구조  : Structures.jsx 렌더에서 계산 → structRenderState에 기록
// 둘 다 진행 중 봉의 고가/저가(candlesRef)를 봐야 제대로 나오므로 여기서 다시
// 계산할 수도 없다. 그래서 틱마다(liveClose 구독) 모듈 상태를 읽어 비교한다.
//
// ── 오알림을 막는 두 장치 ───────────────────────────────────────────────────
// [1] 첫 관측은 **무조건 조용히 기준선만 잡는다.** 페이지를 열면 과거 전 구간의
//     CHoCH가 한꺼번에 계산되므로, 이게 없으면 로드하자마자 알림이 쏟아진다.
// [2] 자동 ZZ는 세대(gen) 비교. TF를 바꾸거나 파라미터를 만지면 누적 상태를 버리고
//     과거를 다시 훑는데, 그때 마지막 CHoCH의 seq가 바뀐다 → gen이 변했으면
//     "새 발생"이 아니라 재계산이므로 소리 없이 기준선만 갱신한다.
//
// 수동 구조는 진행 중 레그의 CHoCH만 대상이라(structRenderState 주석) 편집으로는
// 울리지 않는다. 키는 `구조id|방향|레벨가격`이라 같은 마크가 확정분으로 바뀌어도
// 다시 울리지 않는다.
const fmt = p => "$" + p.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const dirLabel = dir => (dir === "bull" ? "상승 전환" : "하락 전환");

/**
 * @param structures   현재 표시 중인 수동 구조 목록 (alertChoch 플래그를 읽는다)
 * @param zzAlertOn    자동 ZZ의 CHoCH 알림 on/off (indicatorParams.zz.alert_choch)
 * @param onAlert      알림 표시 콜백 (addToast — 일반 토스트, 30초 자동 닫힘)
 */
export function useChochAlert({ structures, zzAlertOn, onAlert }) {
  // 틱마다 재실행되도록 구독 — 값 자체는 쓰지 않는다
  const liveClose = useStore(s => s.liveClose);

  const zzRef     = useRef({ gen: null, seq: null });
  const structRef = useRef(null);   // Set<key> | null (null = 아직 기준선 없음)

  useEffect(() => {
    // ── 자동 ZZ ──────────────────────────────────────────────────────────────
    const { gen, last } = getZzChochSignal();
    const prev = zzRef.current;
    const seq  = last?.seq ?? null;

    if (prev.gen !== gen || prev.seq === null) {
      // [1] 첫 관측 / [2] 재계산 — 조용히 기준선만
      zzRef.current = { gen, seq };
    } else if (seq !== null && seq > prev.seq) {
      zzRef.current = { gen, seq };
      if (zzAlertOn) onAlert(`ZZ CHoCH ${dirLabel(last.dir)}  ${fmt(last.price)}`);
    }

    // ── 수동 구조 ────────────────────────────────────────────────────────────
    const live = getStructLiveChochs();
    const keys = new Set(live.map(e => `${e.structId}|${e.dir}|${e.price}`));
    const seen = structRef.current;
    structRef.current = keys;

    if (seen) {   // [1] 첫 관측이면 기준선만 잡고 끝
      for (const e of live) {
        const key = `${e.structId}|${e.dir}|${e.price}`;
        if (seen.has(key)) continue;
        // 알림은 구조별 플래그로 끈다 — 기본 ON이므로 undefined는 ON
        const st = structures?.find(s => s.id === e.structId);
        if (st && st.alertChoch === false) continue;
        onAlert(`구조 CHoCH ${dirLabel(e.dir)}  ${fmt(e.price)}`);
      }
    }
  }, [liveClose, structures, zzAlertOn, onAlert]);
}
