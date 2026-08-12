// 수동 구조(Structure) — 사용자가 찍은 꼭짓점에서 CHoCH를 파생하는 순수 함수
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 사용자 확정 사양 — 임의 변경 금지 (2026-08-12 확정, 실사용 테스트 통과)      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// 아래는 전부 사용자가 직접 요구했거나, 실제 버그를 겪고 함께 고쳐서 확정한 동작이다.
// "이상해 보인다 / 더 정확할 것 같다"는 이유로 되돌리지 말 것. 되돌리면 재발하는
// 구체적 증상을 각 항목에 적어뒀다. 바꿔야 할 이유가 생기면 먼저 사용자에게 확인할 것.
//
// [1] CHoCH는 "실제 돌파로 bias가 선 상태"에서만 찍는다.
//     느슨하게(구조 고/저점이 없다는 이유만으로 bias를 세팅) 바꾸지 말 것 —
//     그러면 고점100 → 저점90 → 고점110 같은 단순 상승(BOS)에도 CHoCH가 찍힌다.
//     ※ 자동 ZZ(structureZigzag.js)와 원본 Pine도 2026-08-12에 같은 규칙으로 통일했다.
//       셋 중 하나만 되돌리면 같은 차트에서 지표끼리 결과가 어긋난다.
//     사용자 확인: "알고리즘대로 잘 표시되면 문제 없어" (덜/많이 뜨는 건 문제가 아님)
//     → 마크가 적게 뜬다고 규칙을 완화하지 말 것.
//
// [2] BOS는 표시하지 않는다. 제안했다가 거절당함 — "오히려 복잡해".
//     디버깅 목적이라도 BOS 라벨 레이어를 추가하지 말 것.
//
// [3] CHoCH 가로선의 끝점은 **레그 선분과 레벨의 교차점**(crossT)이다.
//     캔들을 뒤져서 "실제로 뚫린 봉"을 찾지 말 것.
//     되돌리면: 화면에 그려진 건 직선 지그재그인데 캔들은 그 선과 어긋나므로,
//     가로선이 지그재그를 지나 오른쪽으로 삐져나온다. 하락 레그에서 특히 잦다.
//     (이 버그로 사용자가 두 번 지적함. firstCrossT 방식은 폐기됐다 — 되살리지 말 것)
//
// [4] 진행 중 레그는 **꼬리(고가/저가) 기준**이고, 값은 "마지막 꼭짓점 이후 구간의 극값"이다.
//     종가(liveClose)로 바꾸지 말 것 — 꼭짓점이 꼬리에 스냅되므로 기준이 어긋난다.
//     구간 극값을 쓰는 건 실수가 아니라 **래치 장치**다. 극값은 구간이 늘어나도
//     되돌아가지 않으므로, 뚫었다 되돌아와도 마크가 유지된다(사용자 요구사항).
//     "현재가만 보면 되는데 왜 전체를 스캔하지?"라고 단순화하지 말 것.
//
// [5] candles 인자에는 반드시 **candlesRef.current**를 넘긴다 (Structures.jsx 참고).
//     React candles state는 봉마감 때만 갱신돼서 진행 중 봉의 고가/저가가 낡아 있다
//     (useCandles.js:29-38). prop으로 "정리"하면 [4]가 조용히 죽는다.
//
// [6] 진행 중 레그는 **가장 최근 꼭짓점을 가진 구조 하나만** 갖는다 (Structures.jsx에서 결정).
//     모든 구조에 라이브를 주면 과거 구조도 마지막 꼭짓점에서 화면 오른쪽 끝까지
//     긴 점선을 뻗어 엉뚱한 데로 이어지려는 것처럼 보인다(사용자 지적).
//
// ── 자동 ZZ(chart/structureZigzag.js)와의 관계 ────────────────────────────────
// 자동 ZZ는 피벗 탐지와 CHoCH 판정이 한 덩어리로 붙은 forward-only 누적 상태다.
// 진행 중 봉의 ATR이 커지면서 이미 찍힌 CHoCH가 탈락하는 걸 막으려고 그 구조를 썼다.
//
// 여기서는 꼭짓점을 **사용자가 소유**하므로 그 방어가 필요 없다. ATR 필터도, 피벗
// 탐지도 없고 points[]가 바뀔 때마다 전체를 다시 뽑는다.
//   → 꼭짓점을 옮기면 그 지점 이후의 구조 고/저점이 바뀌므로 CHoCH가 사라지거나
//     없던 게 생긴다. 의도된 동작이다.
//
// ── bias 규칙 (자동 ZZ·원본 Pine과 동일) ──────────────────────────────────────
// **실제 돌파가 있었을 때만 bias를 세운다.** 구조 고/저점이 아직 없다는 이유로
// bias를 미리 정해두면 H1 → L1 → H2(>H1) 같은 단순 상승에서도 첫 CHoCH가 찍히는데,
// 하락 추세가 성립한 적이 없으므로 그건 BOS이지 CHoCH가 아니다.
//
// 원래 자동 ZZ와 원본 Pine에만 이 오탐이 있었고 수동 구조는 처음부터 엄격했다.
// 2026-08-12에 사용자 요청으로 셋 다 같은 규칙으로 통일했다
// (structureZigzag.js / 기타/structure_zigzag.pine 동시 수정).
//
// ── 판정은 전부 꼬리(고가/저가) 기준 ──────────────────────────────────────────
// 꼭짓점이 클릭 시 봉의 고가/저가에 스냅되므로, 진행 중 레그도 종가가 아닌 꼬리로 본다.
// 진행 중 레그의 값은 "마지막 꼭짓점 이후 구간의 최저가/최고가"다. 구간 극값은 구간이
// 늘어나도 되돌아가지 않으므로, **한번 뚫으면 가격이 되돌아와도 마크가 유지된다**
// (누적 상태 없이 순수 함수인 채로 래치가 성립).

export const EMPTY_STRUCTURE = { segments: [], chochs: [], liveSegment: null };

// 고/저 교대 불변식 유지 — 시간순 정렬 후 연속된 동일 타입은 더 극단적인 쪽만 남긴다.
// (꼭짓점 삭제로 고점–고점이 인접하게 되는 경우를 여기서 흡수)
export function normalizeStructurePoints(points) {
  const sorted = [...(points ?? [])].sort((a, b) => a.t - b.t);
  const out = [];
  for (const pt of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.type === pt.type) {
      const keepNew = pt.type === "H" ? pt.p > prev.p : pt.p < prev.p;
      if (keepNew) out[out.length - 1] = pt;
      continue;
    }
    out.push(pt);
  }
  return out;
}

// 각 꼭짓점의 캔들 인덱스. points/candles 모두 시간순이라 한 번의 전진 스캔으로 끝난다.
function mapPivotIndices(points, candles) {
  const out = new Array(points.length).fill(0);
  let i = 0;
  for (let k = 0; k < points.length; k++) {
    while (i < candles.length - 1 && +candles[i].t < points[k].t) i++;
    out[k] = i;
  }
  return out;
}

/**
 * CHoCH 가로선을 어디서 끊을지 — 레그 선분(t1,p1 → t2,p2)이 레벨과 만나는 지점.
 *
 * ── 왜 "봉이 실제로 뚫은 시점"이 아니라 선분 교차점인가 ──────────────────────
 * 화면에 그려진 건 캔들이 아니라 꼭짓점을 이은 직선 지그재그다. 이 둘은 어긋난다.
 * 고점 110 → 저점 85 레그에서 레벨이 90이면 직선은 80% 지점에서 90을 지나지만,
 * 실제 가격은 90 위에서 뭉개다 레그 끝에서야 깨는 경우가 흔하다. 봉 기준으로 끊으면
 * 그 차이만큼 가로선이 지그재그를 지나 오른쪽으로 삐져나온다.
 * (하락 레그에서 더 자주 나오는 패턴이라 bear 쪽에 몰려 보인다.)
 *
 * 선분 교차점으로 끊으면 정의상 두 꼭짓점 사이에 들어가므로 절대 삐져나오지 않는다.
 */
function crossT(t1, p1, t2, p2, level) {
  const dp = p2 - p1;
  if (dp === 0) return t2;
  const a = Math.min(1, Math.max(0, (level - p1) / dp));
  return t1 + a * (t2 - t1);
}

/**
 * 꼭짓점 배열 → 지그재그 세그먼트 + CHoCH 마크
 *
 * @param points  [{ t, p, type: "H"|"L" }] — 시간순, 고/저 교대 (normalize 완료 가정)
 * @param candles 라이브 캔들 배열. 진행 중 레그 판정에만 쓴다(확정 꼭짓점 계산엔 불필요).
 *                **candlesRef.current를 넘겨야 한다** — React candles state는 봉마감
 *                때만 갱신되므로 진행 중 봉의 고가/저가가 낡아 있다 (useCandles.js:29-38).
 *                생략하면 라이브 레그 없이 확정 꼭짓점만으로 계산한다.
 * @param trace   배열을 넘기면 꼭짓점마다 판정 근거를 담는다 (chart/structDebug.js 전용).
 *                판정 로직을 복제하면 실제 동작과 어긋난 설명을 하게 되므로 여기서 직접 기록한다.
 */
export function deriveStructure(points, candles = null, trace = null) {
  if (!points || points.length < 2) return EMPTY_STRUCTURE;

  const segments = [];
  for (let k = 1; k < points.length; k++) {
    segments.push({
      t1: points[k - 1].t, p1: points[k - 1].p,
      t2: points[k].t,     p2: points[k].p,
    });
  }

  const hasCandles = !!candles?.length;
  const pIdx = hasCandles ? mapPivotIndices(points, candles) : null;

  const chochs = [];
  let structHigh = null, structHighT = null;   // 직전 확정 스윙 고점 (상향 돌파 감시 대상)
  let structLow  = null, structLowT  = null;   // 직전 확정 스윙 저점 (하향 돌파 감시 대상)
  let bias = 0;                                // 1 = 상승, -1 = 하락, 0 = 미확정

  const BIAS_LABEL = { 1: "상승", [-1]: "하락", 0: "미정" };

  for (let k = 1; k < points.length; k++) {
    const prev = points[k - 1], cur = points[k];
    const biasBefore = bias;
    let level = null, broke = false, fired = false;

    if (cur.type === "H") {
      // 고점에 도달 = 직전 저점이 구조 저점으로 확정됨
      if (prev.type === "L") { structLow = prev.p; structLowT = prev.t; }
      level = structHigh;
      if (structHigh !== null && cur.p > structHigh) {
        broke = true;
        if (bias === -1) {
          fired = true;
          chochs.push({
            dir: "bull", fromT: structHighT, price: structHigh,
            toT: crossT(prev.t, prev.p, cur.t, cur.p, structHigh),
          });
        }
        bias = 1;
      }
    } else {
      if (prev.type === "H") { structHigh = prev.p; structHighT = prev.t; }
      level = structLow;
      if (structLow !== null && cur.p < structLow) {
        broke = true;
        if (bias === 1) {
          fired = true;
          chochs.push({
            dir: "bear", fromT: structLowT, price: structLow,
            toT: crossT(prev.t, prev.p, cur.t, cur.p, structLow),
          });
        }
        bias = -1;
      }
    }

    if (trace) {
      const need = cur.type === "H" ? -1 : 1;   // 전환이 되려면 서 있어야 할 반대 추세
      trace.push({
        "#": k,
        꼭짓점: `${cur.type} ${cur.p}`,
        "감시 레벨": level ?? "—",
        "직전 추세": BIAS_LABEL[biasBefore],
        판정: fired ? "CHoCH ✔"
          : level === null ? "비교할 구조 레벨이 아직 없음"
          : !broke         ? "레벨 미돌파"
          : `돌파했지만 직전 추세가 ${BIAS_LABEL[need]}이 아니라 ${BIAS_LABEL[biasBefore]} → BOS(추세 지속)`,
      });
    }
  }

  // ── 진행 중 레그 (마지막 꼭짓점 → 현재) ────────────────────────────────────
  // 확정된 꼭짓점은 손대지 않고, 구간 극값이 구조 레벨을 뚫었는지만 본다.
  let liveSegment = null;
  if (hasCandles) {
    const lastPt  = points[points.length - 1];
    const lastIdx = pIdx[points.length - 1];
    const end     = candles.length - 1;

    if (end > lastIdx) {
      const up = lastPt.type === "L";   // 마지막이 저점이면 진행 중 레그는 상승

      // 구간 극값 — 구간이 늘어나도 되돌아가지 않으므로 래치 역할을 한다
      let extP = up ? -Infinity : Infinity, extT = +candles[lastIdx].t;
      for (let i = lastIdx + 1; i <= end; i++) {
        const v = up ? candles[i].h : candles[i].l;
        if (up ? v > extP : v < extP) { extP = v; extT = +candles[i].t; }
      }

      if (Number.isFinite(extP)) {
        liveSegment = { t1: lastPt.t, p1: lastPt.p, t2: extT, p2: extP };

        const level = up ? structHigh : structLow;
        const want  = up ? -1 : 1;   // 반대 추세가 서 있어야 전환이다
        if (level !== null && bias === want && (up ? extP > level : extP < level)) {
          chochs.push({
            dir: up ? "bull" : "bear",
            fromT: up ? structHighT : structLowT,
            // 확정분과 동일한 규칙 — 화면에 그려진 진행 중 레그(점선)와의 교차점
            toT: crossT(lastPt.t, lastPt.p, extT, extP, level),
            price: level,
            live: true,
          });
        }
      }
    }
  }

  return { segments, chochs, liveSegment };
}
