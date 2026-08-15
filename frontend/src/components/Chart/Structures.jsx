import { memo } from "react";
import { CANVAS_C, PALETTE, SEL_HANDLE_R } from "../../constants";
import { useStore } from "../../store";
import { tsToIdx } from "../../chart/scales";
import { deriveStructure, normalizeStructurePoints } from "../../chart/deriveStructure";
import { setStructChochCounts, setStructLiveSegment, setStructLiveChochs } from "../../chart/structRenderState";
import { clipPolylineX, clipSegmentX, inViewX, VIEW_PAD } from "../../chart/svgGeom";

// 수동 구조 SVG 렌더 — 지그재그 + CHoCH 마크 + 꼭짓점 핸들
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 사용자 확정 사양 — 임의 변경 금지 (2026-08-12 확정, 실사용 테스트 통과)      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// [R1] CHoCH 마크는 구조의 opacity 설정을 **따르지 않는다. 항상 100%.**
//      ChochMarks가 opacity prop을 아예 받지 않는 건 실수가 아니다.
//      "다른 요소와 일관되게" opacity를 다시 넣지 말 것 — 지그재그를 흐리게 깔아도
//      마크는 또렷해야 한다는 사용자 요구사항이다.
//
// [R2] 신규 구조 기본 투명도 0.5 (useStructures.js의 STRUCT_DEFAULT_OPACITY).
//      1.0으로 "정상화"하지 말 것.
//
// [R3] 진행 중 레그(점선)는 꼭짓점 timestamp가 가장 최근인 구조 **하나만** 갖는다.
//      나머지는 deriveStructure에 candles 대신 null을 넘겨 라이브를 끈다.
//      전부에게 주면 과거 구조가 화면 끝까지 점선을 뻗는다 (사용자 지적).
//      확정 CHoCH는 캔들 없이 계산되므로 null을 넘겨도 잃는 게 없다.
//
// [R4] liveCandles는 candlesRef.current다. candles prop으로 바꾸지 말 것 —
//      진행 중 봉의 고가/저가가 낡아 라이브 판정이 조용히 죽는다.
//      단, tsToIdx 좌표 변환은 candles(prop)를 쓴다. 길이가 항상 같아 안전하다.
//
// [R5] 라이브에서 나온 CHoCH는 점선, 확정분은 실선. 이 구분을 없애지 말 것.
//
// [R6] CHoCH 표시 개수 제한은 **구조마다 각각**이고, 값도 구조가 들고 있다(st.maxChoch,
//      더블클릭 팝업에서 설정). 전역 설정 하나로 두지 말 것 — 두 번 문제가 됐다:
//        ① 전 구조를 합쳐 최신 N개로 자르던 시절: 과거 구간에 그린 구조의 마크가
//           최신 구조에 밀려 통째로 사라짐 (그 구조만 봐도 안 보임)
//        ② 전역 숫자만 있던 시절: 값을 낮춰둔 걸 잊고 "CHoCH가 안 뜬다"고 오해
//      **기본값은 제한 없음(undefined = 전체).** 기본을 숫자로 두면 ②가 되풀이된다.
//      화면 정리는 구조별 토글(showChoch)이 담당한다 — 같은 팝업에 나란히 있다.
//      지표 전체 토글(struct.show_choch)도 2026-08-12 제거했다. 구조별 토글과 AND로
//      걸리는 별개 값이라, OFF로 저장해 두면 구조별 ON이 먹지 않는데 그 사실이
//      구조 팝업 어디에도 드러나지 않았다. 켜고 끄는 곳은 팝업 하나로 족하다.
//
// [R10] CHoCH 발생 알림(alertChoch)은 **기본 OFF**다 (2026-08-13 사용자 결정).
//      다른 구조별 플래그(showChoch/showLegVol)는 기본 ON인데 이것만 반대인 이유:
//      알림 ON인 구조는 호박색 점선 + 글로우로 그려진다. 기본이 ON이면 **모든**
//      구조가 알림 스타일이 되어 색이 아무것도 구분해주지 못한다 (실제로 그렇게 보였다).
//      "undefined = ON이 이 파일의 관례"라며 되돌리지 말 것 — 표시와 묶인 플래그라 다르다.
//
// [R9] **그리기 전에 뷰포트로 자른다** (2026-08-13, 5m 렉 신고 → 실측으로 원인 확인).
//      구조 좌표는 timestamp라, 로드된 캔들 범위보다 과거에 그린 구조는 tsToIdx가
//      음수 bar index로 외삽한다. useCandles는 3000봉을 싣는데 5m면 **10.4일치뿐**이라
//      한 달 전 구조가 x = -80,000px에 찍힌다(1h는 -6,720px — 12배 차이).
//      점선은 클리핑 **전에** 조각으로 펼쳐지므로 폴리라인 하나에 점선 8,960개가 되고,
//      Structures는 liveClose 구독이라 그 페인트가 틱마다(최대 60fps) 반복된다.
//      → clipPolylineX/clipSegmentX로 자른다. 화면 안 형상은 완전히 동일하다(실측 오차 1e-14).
//      **되돌리지 말 것** — "클리핑은 SVG가 알아서 한다"는 말은 길이에는 맞지만
//      dasharray에는 틀리다. 자세한 근거는 chart/svgGeom.js 주석.
//
// [R7] **선분(몸통) 부분 선택은 없다** (2026-08-12 사용자 요청으로 제거).
//      몸통을 클릭했을 때 선이 파랗게 물드는 게 거슬린다는 이유였다.
//      파란색은 이제 꼭짓점 부분 선택 전용이다. 선분 강조 레이어를 되살리지 말 것.
//
// 자동 ZZ(overlayRenderers.js::renderStructureZigzag)와 픽셀 단위로 같은 스타일
const ZZ_COLOR   = CANVAS_C.NEUTRAL;      // #888888
const BULL_COLOR = CANVAS_C.BULL_DARK;    // #0ecb81
const BEAR_COLOR = CANVAS_C.BEAR_DARK;    // #f6465d
const SEL_COLOR  = "#f0b90b";           // 구조 전체 선택 = 금색
// 알림 ON = 호박색 + 점선 + 굵기 1.5 + 글로우 — **트렌드라인/채널/원과 같은 규칙**
// (TrendLines.jsx의 alert 스타일을 그대로 옮긴 것. 한쪽만 바꾸면 같은 알림인데
//  선 종류마다 다르게 보인다. 뜻만 다르다 — 선·채널·원 = 근접 알림 / 구조·ZZ = CHoCH 발생 알림)
// ※ 예전엔 여기에 🔔 아이콘도 달렸다 — 2026-08-14 사용자 요청으로 **네 종류 모두** 제거.
//   되살리려면 넷을 같이 되살릴 것
const ALERT_COLOR = "#fbbf24";
// 구조 안에서 다시 고른 꼭짓점 = 파랑. 금색과 확실히 구분돼야
// "지금 Delete를 누르면 이것만 지워진다"가 한눈에 보인다 (사용자 요구사항)
const PART_COLOR = PALETTE.info;        // #60a5fa

// ※ CHoCH 마크에는 **글자가 없다** — 가로선만 그린다 (2026-08-14 사용자 요청).
//   `"CHoCH"` → `"C"` → 제거 순으로 줄였다. 마크가 여러 개 붙으면 글자끼리 겹쳐
//   화면이 복잡해 보인다는 이유. 방향은 색(초록/빨강)과 선 위치가 이미 말해준다.
//   ⚠ 자동 ZZ(overlayRenderers.js)·`기타/structure_zigzag.pine`도 같이 지웠다 —
//     되살릴 거면 셋을 같이. 한쪽만 되살리면 지표마다 다르게 보인다

// 진행 중 레그 소유자 판정에서 draft를 가리키는 키 (구조 id와 겹치지 않게)
const DRAFT_ID = Symbol("draft");

// 이 구조가 현재 draft에 흡수돼 있는가 (연장 원본이거나 이어붙인 대상)
const inDraft = (draft, id) =>
  draft != null && (draft.extendId === id || !!draft.mergeIds?.includes(id));

// CHoCH는 구조의 투명도 설정을 따르지 않는다 — 지그재그를 흐리게 두고도
// 마크는 또렷해야 하므로 항상 100%.
function ChochMarks({ chochs, candles, xScale, yScale, IW }) {
  return chochs.map((ev, k) => {
    const rawX0 = xScale(tsToIdx(ev.fromT, candles));
    const rawX1 = xScale(tsToIdx(ev.toT,   candles));
    if (rawX1 < 0 || rawX0 > IW) return null;          // 화면 밖
    const x0 = Math.max(0, rawX0);
    // 돌파 봉이 레벨 시작점과 같은 화면 위치면 선이 사라지므로 최소 폭 확보
    const x1 = Math.max(Math.min(IW, rawX1), x0 + 2);
    const y     = yScale(ev.price);
    const color = ev.dir === "bull" ? BULL_COLOR : BEAR_COLOR;
    // 가로선 하나뿐 — 라벨 없음 (파일 상단 주석 참고).
    // <g>로 감싸지 않는 이유: 자식이 하나라 노드만 늘어난다
    return (
      <line key={`ch${k}`} x1={x0} y1={y} x2={x1} y2={y}
        stroke={color} strokeWidth={1.5}
        // 진행 중 레그에서 나온 CHoCH는 확정분과 구분되게 점선
        strokeDasharray={ev.live ? "5,3" : undefined} />
    );
  });
}

export const Structures = memo(function Structures({
  structures, selectedStructId, structPart, structDraft, structPreview,
  scales, candles, candlesRef, IW,
}) {
  // 리렌더 트리거용 구독 — 값 자체는 안 쓴다.
  // ChartArea가 구독하면 틱마다 SVG 오버레이 전체가 리렌더되므로 여기서만 구독한다.
  useStore(s => s.liveClose);

  if (!scales || !candles.length) return null;
  const { xScale, yScale } = scales;

  const toXY = (t, p) => ({ x: xScale(tsToIdx(t, candles)), y: yScale(p) });

  // 진행 중 봉의 고가/저가는 ref에만 최신값이 있다 (React candles는 봉마감 때만 갱신).
  // 길이는 항상 같으므로 tsToIdx 좌표 변환은 candles를 그대로 써도 된다.
  const liveCandles = candlesRef?.current?.length ? candlesRef.current : candles;

  // ── 진행 중 레그는 "가장 최근 꼭짓점을 가진 구조" 하나만 갖는다 ────────────
  // 모든 구조가 현재가를 쫓으면, 과거에 그려둔 구조도 마지막 꼭짓점에서 화면
  // 오른쪽 끝까지 긴 점선을 뻗어 엉뚱한 데로 이어지려는 것처럼 보인다.
  // 과거 구조는 이미 끝난 것이므로 확정 꼭짓점만 그린다.
  // (deriveStructure에 candles를 안 넘기면 라이브 레그가 통째로 꺼진다 —
  //  확정 CHoCH는 캔들 없이도 계산되므로 잃는 게 없다)
  const maxT = pts => (pts?.length ? Math.max(...pts.map(p => p.t)) : -Infinity);
  const liveOwnerId = (() => {
    const cands = (structures ?? [])
      .filter(s => s.points?.length && !inDraft(structDraft, s.id))
      .map(s => ({ id: s.id, t: maxT(s.points) }));
    if (structDraft?.points?.length) cands.push({ id: DRAFT_ID, t: maxT(structDraft.points) });
    if (!cands.length) return null;
    return cands.reduce((a, b) => (b.t > a.t ? b : a)).id;
  })();

  // ── CHoCH 파생 + 표시 개수 제한 ([R6]) ─────────────────────────────────────
  // 개수를 세려면 구조별 렌더 안에서 계산할 수 없다 — 먼저 전부 파생해 합친다.
  // draft에 들어온 구조(연장 원본 / 흡수된 구조)는 draft가 대신 그리므로 제외.
  const visible = (structures ?? []).filter(
    st => st.points?.length && !inDraft(structDraft, st.id));

  const derived = new Map();
  for (const st of visible) {
    derived.set(st.id, deriveStructure(st.points, st.id === liveOwnerId ? liveCandles : null));
  }
  // 이어 그리기 중에도 CHoCH가 계속 보이도록 draft에서도 파생한다.
  // draft는 과거 방향 연장 시 역순일 수 있어 normalize로 시간순을 맞춘 뒤 넘긴다.
  const draftPts = structDraft?.points?.length >= 2
    ? normalizeStructurePoints(structDraft.points) : null;
  const draftDerived = draftPts
    ? deriveStructure(draftPts, liveOwnerId === DRAFT_ID ? liveCandles : null)
    : null;

  // 구조별 CHoCH 표시 토글(더블클릭 팝업)이 꺼진 구조는 제외. 기본은 ON이라 undefined = ON
  // (기존에 저장된 구조가 전부 꺼진 채로 뜨지 않게).
  const chochOn = st => st.showChoch !== false;
  // 슬라이스 **전** 개수를 구조별로 남긴다 — 팝업의 "CHoCH 개수" 슬라이더 상한(1~N)
  setStructChochCounts(new Map(visible.map(st => [st.id, derived.get(st.id).chochs.length])));

  // 진행 중 레그(점선)를 hover 라벨이 쓸 수 있게 남긴다.
  // 구조를 통틀어 하나뿐이므로([R3]) 여기서 한 번만 기록하면 된다.
  //
  // [R8] **prev(직전 동일방향 레그)까지 같이 남긴다.** 안 그러면 진행 중 레그만
  //   거래량 비교(↑↓%)가 통째로 안 뜬다 — 정작 제일 자주 보는 레그인데다,
  //   화면엔 비교 대상이 뻔히 보이는 상태라 "왜 이것만 안 나오지"가 된다(사용자 지적).
  //   진행 중 레그는 pts[n-1] → 현재이므로 두 칸 앞 레그는 pts[n-3] → pts[n-2]다
  //   (고/저 교대라 방향 판정 없이 정확 — 자동 ZZ가 segs[k-2]를 쓰는 것과 같은 근거).
  //   좌표 변환(timestamp → bar index)은 소비하는 쪽(hitDetection)에서 한다.
  const liveOwnerPts = liveOwnerId === DRAFT_ID
    ? draftPts
    : visible.find(st => st.id === liveOwnerId)?.points;
  const liveSeg = (liveOwnerId === DRAFT_ID
    ? draftDerived?.liveSegment
    : derived.get(liveOwnerId)?.liveSegment) ?? null;
  const n = liveOwnerPts?.length ?? 0;
  // 소유 구조의 `거래량 비교` 설정도 같이 실어 보낸다 — 진행 중 레그는 구조 목록에 없어서
  // hitDetection이 st.showLegVol을 직접 읽을 수 없다 (prev를 여기서 넘기는 것과 같은 이유).
  // draft(그리는 중)는 아직 구조가 아니므로 ON.
  const liveShowVol = liveOwnerId === DRAFT_ID
    ? true
    : visible.find(st => st.id === liveOwnerId)?.showLegVol !== false;
  // ownerId / type — 점선 끝점을 **클릭해서 확정**하는 경로가 쓴다 (2026-08-15).
  // hitDetection이 "어느 구조에, 어떤 타입으로 붙일지"를 알아야 하는데 진행 중 레그는
  // 구조 목록에 없어서 직접 알아낼 수 없다 (prev·showVol을 여기서 실어 보내는 것과 같은 이유).
  // draft는 ownerId를 주지 않는다 — 그리는 중에는 클릭이 이미 꼭짓점 추가다
  const liveOwnerLast = n > 0 ? liveOwnerPts[n - 1] : null;
  setStructLiveSegment(
    liveSeg
      ? {
          ...liveSeg,
          showVol: liveShowVol,
          ownerId: liveOwnerId === DRAFT_ID ? null : liveOwnerId,
          // 마지막이 저점(L)이면 진행 중 레그는 상승 → 찍힐 점은 고점(H)
          type: liveOwnerLast?.type === "L" ? "H" : "L",
          ...(n >= 3 ? { prev: { t1: liveOwnerPts[n - 3].t, t2: liveOwnerPts[n - 2].t } } : {}),
        }
      : liveSeg,
  );

  // 알림(useChochAlert)용 — 진행 중 레그에서 나온 CHoCH만. 확정분을 넣으면
  // 꼭짓점을 옮길 때마다 과거 CHoCH가 재계산돼 알림이 터진다(structRenderState 주석).
  // draft는 제외 — 그리는 도중에 울리면 방해만 된다.
  setStructLiveChochs(
    visible.flatMap(st =>
      derived.get(st.id).chochs
        .filter(ev => ev.live)
        .map(ev => ({ structId: st.id, dir: ev.dir, price: ev.price }))),
  );

  // 표시 개수 제한 — **구조마다 각각, 그 구조의 팝업에서 설정한 값** ([R6]).
  // chochs는 deriveStructure가 시간순으로 push하므로 slice(-N)이 곧 최신 N개다.
  // st.maxChoch가 없으면 제한 없음(전체) — 기본값을 숫자로 두면 "왜 안 보이지"가 반복된다.
  // 지표 전체 스위치(struct.show_choch)는 없앴다 — 켜고 끄는 건 구조별 팝업 하나뿐이다.
  // 전역 값을 다시 두면 OFF로 저장된 걸 잊고 "구조별로 켰는데 왜 안 뜨지"가 된다.
  const shown = (list, st) => {
    if (st && !chochOn(st)) return [];
    const n = st?.maxChoch;
    return n > 0 ? list.slice(-n) : list;
  };

  return (
    <g style={{ pointerEvents: "none" }}>
      {visible.map(st => {
        const selected = st.id === selectedStructId;
        const opacity  = selected ? 0.95 : (st.opacity ?? 1.0);
        // CHoCH 발생 알림 — [R10] **기본 OFF** (true일 때만 ON).
        // 선택이 알림보다 우선한다 (트렌드라인과 동일) — 지금 뭘 조작 중인지가 먼저다
        const alert    = !!st.alertChoch;
        const color    = selected ? SEL_COLOR : alert ? ALERT_COLOR : ZZ_COLOR;

        // segments는 아래 polyline이 points로 직접 그리므로 여기선 chochs/liveSegment만 사용
        const { chochs, liveSegment } = derived.get(st.id);
        const pts = st.points.map(pt => toXY(pt.t, pt.p));

        // 선택된 구조 안에서 다시 고른 꼭짓점 (Delete로 이것만 지워진다).
        // 선분 부분 선택은 없다 — [R7] 참고.
        const partPt = selected && structPart?.kind === "point" ? structPart.idx : -1;

        // [R9] **뷰포트로 잘라서 그린다.** 5m처럼 짧은 TF에서는 예전에 그린 구조가
        // x = -80,000px 밖에 찍히는데, 점선(알림 ON)은 클리핑 전에 조각으로 펼쳐져서
        // 폴리라인 하나에 점선 8,960개가 생긴다 → 틱마다 리렌더라 그대로 렉이 된다.
        // 자세한 실측은 chart/svgGeom.js 주석. 화면 안 형상은 그대로다.
        const vis  = clipPolylineX(pts, IW);
        const poly = vis.map(q => `${q.x},${q.y}`).join(" ");

        return (
          <g key={st.id}>
            {/* 알림/선택 글로우 — 트렌드라인과 같은 굵기 6 / 불투명도 0.18 */}
            {(alert || selected) && vis.length >= 2 && (
              <polyline points={poly} fill="none" stroke={color} strokeWidth={6} opacity={0.18} />
            )}

            {/* 지그재그 선 */}
            {vis.length >= 2 && (
              <polyline
                points={poly}
                fill="none" stroke={color}
                strokeWidth={selected || alert ? 1.5 : 1}
                opacity={0.8 * opacity}
                strokeDasharray={alert && !selected ? "6,3" : undefined}
              />
            )}

            {/* 진행 중 레그 — 마지막 꼭짓점에서 현재가까지 (점선이라 [R9] 클리핑 필수) */}
            {liveSegment && (() => {
              const a = toXY(liveSegment.t1, liveSegment.p1);
              const b = toXY(liveSegment.t2, liveSegment.p2);
              const s = clipSegmentX(a.x, a.y, b.x, b.y, -VIEW_PAD, IW + VIEW_PAD);
              if (!s) return null;
              return (
                <g>
                  <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                    stroke={color} strokeWidth={1} opacity={0.45 * opacity}
                    strokeDasharray="4,3" />
                  {/* 끝점 핸들 — **누르면 그 자리가 꼭짓점으로 확정된다** (2026-08-15 사용자 요청).
                      속을 비운 원인 이유: "아직 확정 아님"을 확정 꼭짓점(꽉 찬 원)과 구분한다.
                      판정은 hitDetection이 하고 여기선 보이기만 한다 — Structures 전체가
                      pointerEvents:none이라 이 노드가 클릭을 받지는 않는다 */}
                  {inViewX(b.x, IW) && (
                    <circle cx={b.x} cy={b.y} r={SEL_HANDLE_R + 0.5}
                      fill="none" stroke={color} strokeWidth={1.2}
                      opacity={0.75 * opacity} />
                  )}
                </g>
              );
            })()}

            <ChochMarks chochs={shown(chochs, st)} candles={candles}
              xScale={xScale} yScale={yScale} IW={IW} />

            {/* ※ 알림 ON을 나타내던 🔔 아이콘은 2026-08-14 사용자 요청으로 제거.
                알림 여부는 **호박색 + 점선 + 글로우**만으로 나타낸다 (선/채널/원도 동일).
                켜고 끄는 곳은 더블클릭 팝업의 🔔 토글 + 단축키 `a` — 그건 그대로다 */}

            {/* 꼭짓점 — 선택 시 드래그 핸들, 평소엔 위치 표시용 점.
                다시 클릭해 고른 꼭짓점만 파랑 (Delete 대상)

                ⚠ 반지름은 2026-08-14 사용자 요청으로 **선택/부분선택 둘 다 절반**으로 줄였다
                  (금색 5 → 2.5 / 파랑 6 → 3). 점이 커서 지그재그를 가린다는 이유.
                  ※ **히트 반경은 안 줄었다** — 잡는 판정은 hitDetection이 따로 갖고 있어
                    점이 작아져도 집기 어려워지지 않는다. "작아서 못 누른다"며 되돌리지 말 것

                ⚠ 여기 선택 크기가 **다른 도형의 기준**이다 (2026-08-14, 같은 날 후속 요청).
                  트렌드라인/채널/원/피보나치가 전부 `SEL_HANDLE_R`을 쓰므로 이 값을 바꾸면
                  다섯 도형이 같이 움직인다 — 그게 의도다. 여기만 리터럴로 되돌리지 말 것.
                  세 크기는 상수 기준 상대값: 부분선택 +0.5 / 선택 = 기준 / 미선택 -0.5 */}
            {pts.map((q, k) => {
              if (!inViewX(q.x, IW)) return null;      // [R9] 화면 밖 꼭짓점은 노드도 만들지 않는다
              const isPart = k === partPt;
              return (
                <circle key={k} cx={q.x} cy={q.y}
                  r={isPart ? SEL_HANDLE_R + 0.5 : (selected ? SEL_HANDLE_R : SEL_HANDLE_R - 0.5)}
                  fill={isPart ? PART_COLOR : color}
                  opacity={isPart ? 1 : (selected ? 0.9 : 0.7 * opacity)} />
              );
            })}
          </g>
        );
      })}

      {/* ── 그리는 중인 구조 ── */}
      {structDraft?.points?.length > 0 && (() => {
        const pts = structDraft.points.map(pt => toXY(pt.t, pt.p));
        const prev = pts[pts.length - 1];
        const nextXY = structPreview ? toXY(structPreview.t, structPreview.p) : null;
        // [R9] draft도 자른다 — 이어 그리기(startExtendStruct)는 원본 꼭짓점을 통째로
        // seed하므로 draft 폴리라인도 화면 밖 수만 px까지 뻗을 수 있다
        const vis = clipPolylineX(pts, IW);
        return (
          <g>
            {vis.length >= 2 && (
              <polyline points={vis.map(q => `${q.x},${q.y}`).join(" ")}
                fill="none" stroke={ZZ_COLOR} strokeWidth={1} opacity={0.8} />
            )}
            <ChochMarks chochs={shown(draftDerived?.chochs ?? [])} candles={candles}
              xScale={xScale} yScale={yScale} IW={IW} />
            {nextXY && (() => {
              const s = clipSegmentX(prev.x, prev.y, nextXY.x, nextXY.y, -VIEW_PAD, IW + VIEW_PAD);
              return s && <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                stroke={ZZ_COLOR} strokeWidth={1} opacity={0.45} strokeDasharray="4,3" />;
            })()}
            {pts.map((q, k) => inViewX(q.x, IW) && (
              <circle key={k} cx={q.x} cy={q.y} r={3} fill={ZZ_COLOR} opacity={0.8} />
            ))}
            {nextXY && (
              <circle cx={nextXY.x} cy={nextXY.y} r={4}
                fill="none" stroke={ZZ_COLOR} strokeWidth={1} opacity={0.7} />
            )}
          </g>
        );
      })()}

      {/* 첫 점 찍기 전 스냅 미리보기 */}
      {!structDraft && structPreview && (() => {
        const q = toXY(structPreview.t, structPreview.p);
        return <circle cx={q.x} cy={q.y} r={4} fill="none"
          stroke={ZZ_COLOR} strokeWidth={1} opacity={0.7} />;
      })()}
    </g>
  );
});
