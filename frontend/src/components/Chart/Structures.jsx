import { memo } from "react";
import { CANVAS_C } from "../../constants";
import { useStore } from "../../store";
import { tsToIdx } from "../../chart/scales";
import { deriveStructure, normalizeStructurePoints } from "../../chart/deriveStructure";

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
// 자동 ZZ(overlayRenderers.js::renderStructureZigzag)와 픽셀 단위로 같은 스타일
const ZZ_COLOR   = CANVAS_C.NEUTRAL;      // #888888
const BULL_COLOR = CANVAS_C.BULL_DARK;    // #0ecb81
const BEAR_COLOR = CANVAS_C.BEAR_DARK;    // #f6465d
const SEL_COLOR  = "#f0b90b";

const CHOCH_FONT = "700 10px 'JetBrains Mono','Fira Code','Courier New',monospace";

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
    const y      = yScale(ev.price);
    const isBull = ev.dir === "bull";
    const color  = isBull ? BULL_COLOR : BEAR_COLOR;
    return (
      <g key={`ch${k}`}>
        <line x1={x0} y1={y} x2={x1} y2={y}
          stroke={color} strokeWidth={1.5}
          // 진행 중 레그에서 나온 CHoCH는 확정분과 구분되게 점선
          strokeDasharray={ev.live ? "5,3" : undefined} />
        <text x={(x0 + x1) / 2} y={isBull ? y - 4 : y + 12}
          textAnchor="middle" style={{ font: CHOCH_FONT }}
          fill={color}>CHoCH</text>
      </g>
    );
  });
}

export const Structures = memo(function Structures({
  structures, selectedStructId, structDraft, structPreview,
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

  return (
    <g style={{ pointerEvents: "none" }}>
      {(structures ?? []).map(st => {
        if (!st.points?.length) return null;
        // draft에 들어온 구조(연장 원본 / 흡수된 구조)는 draft가 대신 그린다
        if (inDraft(structDraft, st.id)) return null;
        const selected = st.id === selectedStructId;
        const opacity  = selected ? 0.95 : (st.opacity ?? 1.0);
        const color    = selected ? SEL_COLOR : ZZ_COLOR;

        // segments는 아래 polyline이 points로 직접 그리므로 여기선 chochs/liveSegment만 사용
        const { chochs, liveSegment } =
          deriveStructure(st.points, st.id === liveOwnerId ? liveCandles : null);
        const pts = st.points.map(pt => toXY(pt.t, pt.p));

        return (
          <g key={st.id}>
            {/* 지그재그 선 */}
            <polyline
              points={pts.map(q => `${q.x},${q.y}`).join(" ")}
              fill="none" stroke={color}
              strokeWidth={selected ? 1.5 : 1}
              opacity={0.8 * opacity}
            />

            {/* 진행 중 레그 — 마지막 꼭짓점에서 현재가까지 */}
            {liveSegment && (() => {
              const a = toXY(liveSegment.t1, liveSegment.p1);
              const b = toXY(liveSegment.t2, liveSegment.p2);
              return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={color} strokeWidth={1} opacity={0.45 * opacity}
                strokeDasharray="4,3" />;
            })()}

            <ChochMarks chochs={chochs} candles={candles}
              xScale={xScale} yScale={yScale} IW={IW} />

            {/* 꼭짓점 — 선택 시 드래그 핸들, 평소엔 위치 표시용 점 */}
            {pts.map((q, k) => (
              <circle key={k} cx={q.x} cy={q.y}
                r={selected ? 5 : 2}
                fill={selected ? SEL_COLOR : ZZ_COLOR}
                opacity={selected ? 0.9 : 0.7 * opacity} />
            ))}
          </g>
        );
      })}

      {/* ── 그리는 중인 구조 ── */}
      {structDraft?.points?.length > 0 && (() => {
        const pts = structDraft.points.map(pt => toXY(pt.t, pt.p));
        const prev = pts[pts.length - 1];
        const nextXY = structPreview ? toXY(structPreview.t, structPreview.p) : null;
        // 이어 그리기 중에도 CHoCH가 계속 보이도록 draft에서도 파생한다.
        // draft는 과거 방향 연장 시 역순일 수 있어 normalize로 시간순을 맞춘 뒤 넘긴다.
        const draftChochs = structDraft.points.length >= 2
          ? deriveStructure(
              normalizeStructurePoints(structDraft.points),
              liveOwnerId === DRAFT_ID ? liveCandles : null,
            ).chochs
          : [];
        return (
          <g>
            {pts.length >= 2 && (
              <polyline points={pts.map(q => `${q.x},${q.y}`).join(" ")}
                fill="none" stroke={ZZ_COLOR} strokeWidth={1} opacity={0.8} />
            )}
            <ChochMarks chochs={draftChochs} candles={candles}
              xScale={xScale} yScale={yScale} IW={IW} />
            {nextXY && (
              <line x1={prev.x} y1={prev.y} x2={nextXY.x} y2={nextXY.y}
                stroke={ZZ_COLOR} strokeWidth={1} opacity={0.45} strokeDasharray="4,3" />
            )}
            {pts.map((q, k) => (
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
