// 수동 구조(Structure) — 사용자가 찍은 꼭짓점에서 CHoCH를 파생하는 순수 함수
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 사용자 확정 사양 — 임의 변경 금지 (2026-08-12 확정, 실사용 테스트 통과)      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// 아래는 전부 사용자가 직접 요구했거나, 실제 버그를 겪고 함께 고쳐서 확정한 동작이다.
// "이상해 보인다 / 더 정확할 것 같다"는 이유로 되돌리지 말 것. 되돌리면 재발하는
// 구체적 증상을 각 항목에 적어뒀다. 바꿔야 할 이유가 생기면 먼저 사용자에게 확인할 것.
//
// [1] **첫 돌파도 CHoCH다** (2026-08-13 사용자 요청으로 변경 — 수동 구조에만 적용).
//     BOS로 처리하는 건 "같은 방향 추세가 이미 서 있는데 또 돌파한" 경우뿐이다.
//       bull: bias !== 1 이면 발생 (반대 추세 -1 + 미정 0)
//       bear: bias !== -1 이면 발생
//     되돌리면 재발하는 문제: 구조마다 **첫 돌파에 마크가 통째로 없다.**
//     돌파가 한 번뿐인 짧은 구조는 CHoCH가 0개가 되고, 여러 구조를 그리면
//     "어떤 건 아예 안 보인다"가 된다 (사용자 지적).
//     ※ 이전 규칙(bias가 반대로 선 상태에서만)은 고점100 → 저점90 → 고점110 같은
//       단순 상승에도 마크가 찍히는 걸 막으려던 것이었다. 그 케이스는 이제 다시 찍힌다 —
//       사용자가 그 트레이드오프를 알고 선택했다.
//     ※ 자동 ZZ(structureZigzag.js)와 원본 Pine(기타/structure_zigzag.pine)도 같은 날
//       같은 규칙으로 맞췄다. 셋 중 하나만 되돌리면 같은 차트에서 지표끼리, 또
//       트레이딩뷰와 마크 개수가 어긋난다.
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
// [4] ⚠ **진행 중 레그(마지막 꼭짓점 → 현재 극값)는 2026-08-26에 기능째 삭제됐다.**
//     사용자 요청 — "자동 이어그리기가 그걸 대체하니 제거해도 된다".
//     되살리지 말 것. 되살리려면 여기 계산뿐 아니라 structRenderState의
//     `_liveSegment`, Structures의 렌더·[R3] 소유자 판정, hitDetection의 끝점 클릭,
//     cursorRules, legDebug가 전부 다시 필요하다.
//     ※ 그래서 이 함수는 **캔들을 받지 않는다** — 확정 꼭짓점만으로 계산된다.
//       옛 [5](candlesRef.current를 넘길 것)와 [6](라이브는 구조 하나만)도 같이 사라졌다.
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
// ── bias 규칙 (2026-08-13 — 자동 ZZ·원본 Pine과 동일) ─────────────────────────
// bias는 여전히 **실제 돌파가 있었을 때만** 세운다(미리 정해두지 않는다).
// 달라진 건 마크 조건이다: bias가 아직 미정(0)인 상태의 첫 돌파도 CHoCH로 찍는다.
//   H1 → L1 → H2(>H1) → 마크 O   (예전엔 X)
//   H1 → L1 → H2(>H1) → L2 → H3(>H2) → H3는 마크 X (bias가 이미 상승 = BOS)
// 즉 BOS는 "추세가 이미 그 방향인데 또 돌파"할 때만이고, 구조의 출발점은 전환으로 본다.
// 손으로 그린 구조는 사용자가 이미 추세를 보고 찍은 것이라 첫 돌파에도 의미가 있다는 판단.
//
// ── 판정은 전부 꼬리(고가/저가) 기준 ──────────────────────────────────────────
// 꼭짓점이 클릭 시 봉의 고가/저가에 스냅되므로 판정도 꼬리로 본다.

export const EMPTY_STRUCTURE = { segments: [], chochs: [] };

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
 * @param trace   배열을 넘기면 꼭짓점마다 판정 근거를 담는다 (chart/structDebug.js 전용).
 *                판정 로직을 복제하면 실제 동작과 어긋난 설명을 하게 되므로 여기서 직접 기록한다.
 *
 * ⚠ 캔들을 받지 않는다 — 진행 중 레그가 사라지면서 필요가 없어졌다 ([4]).
 */
export function deriveStructure(points, trace = null) {
  if (!points || points.length < 2) return EMPTY_STRUCTURE;

  const segments = [];
  for (let k = 1; k < points.length; k++) {
    segments.push({
      t1: points[k - 1].t, p1: points[k - 1].p,
      t2: points[k].t,     p2: points[k].p,
    });
  }

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
        // bias === 0(첫 돌파)도 CHoCH — 같은 방향 추세가 이미 서 있을 때만 BOS다 ([1])
        if (bias !== 1) {
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
        // 고점 쪽과 동일 — 첫 돌파(bias === 0)도 CHoCH ([1])
        if (bias !== -1) {
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
      trace.push({
        "#": k,
        꼭짓점: `${cur.type} ${cur.p}`,
        "감시 레벨": level ?? "—",
        "직전 추세": BIAS_LABEL[biasBefore],
        판정: fired ? "CHoCH ✔"
          : level === null ? "비교할 구조 레벨이 아직 없음"
          : !broke         ? "레벨 미돌파"
          : `돌파했지만 직전 추세가 이미 ${BIAS_LABEL[biasBefore]} → BOS(추세 지속)`,
      });
    }
  }

  return { segments, chochs };
}
