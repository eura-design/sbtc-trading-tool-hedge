import { memo } from "react";
import { SEL_HANDLE_R, PALETTE } from "../../constants";
import { useTheme } from "../../ThemeContext";
import { tsToIdx } from "../../chart/scales";
import { VIEW_PAD } from "../../chart/svgGeom";
import { measureStats, fmtDuration, fmtPriceDiff, fmtPct } from "../../chart/measure";
import { LockMark } from "./LockMark";

// ── 측정 박스 (2026-08-26 사용자 요청) ──────────────────────────────────────
// 사각형을 끌면 그 구간의 **등락률 · 가격 차이 · 기간**을 보여준다.
// ⚠ 봉 수는 일부러 빼 뒀다 (2026-08-27 사용자 지정) — chart/measure.js 참고.
// 트레이딩뷰의 `날짜 및 가격 범위`에 해당한다.
//
// ⚠ **색이 방향을 말한다** (사용자 지정): 위로 그리면 초록, 아래로 그리면 빨강.
//   이 시스템에서 초록·빨강은 이미 상승·하락이라 따로 배울 게 없다.
//   ※ 그래서 롱/숏 포지션 라인과 색이 겹친다 — 대신 **면이 깔린 사각형**이라
//     가로선 몇 개인 포지션 마커와 모양으로 갈린다
//
// 면 투명도는 플랜 박스(BoxOverlay)의 0.07~0.10과 같은 계열이다. 캔들이 비쳐 보여야 한다
const FILL_ALPHA = 0.08;
const SEL_COLOR  = "#f0b90b";   // 선택 = 금색 (다른 도형과 같다)

// 글자 — 등락률만 크다. 아래 두 줄은 딸린 값이라 작게 (레그 hover 라벨과 같은 관계)
const PCT_FS  = 13;
const SUB_FS  = 11;
const LINE_H  = 15;
// 세 줄이 들어갈 최소 크기. 이보다 작으면 박스 **위**에 얹는다 — 글자를 지우면
// 측정 도구가 아무것도 말하지 않게 된다
// ⚠ 84 → 68 (2026-08-27) — 봉 수를 빼면서 가장 긴 줄이 짧아졌다.
//   그대로 두면 들어갈 수 있는 박스인데도 글자를 위로 밀어낸다.
//   68은 `-100.00%`(8자 × 13px 등폭 7.8px = 62px)에 여백을 더한 값이다
const FIT_W = 68;
const FIT_H = 54;

export const Measures = memo(function Measures({
  measures, selectedMeasureId, measureDraft,
  scales, IW, IH, candles,
}) {
  const { isDark } = useTheme();
  if (!scales || !candles?.length) return null;
  const { xScale, yScale } = scales;
  const halo = isDark ? "#0d1117" : "#f9fafb";

  // 그리는 중(draft)은 저장된 것과 **같은 모양**으로 그린다 — 놓는 순간 모양이
  // 바뀌면 "방금 본 값이 그대로 남았나"를 다시 확인해야 한다.
  // 다른 점은 점선 테두리(아직 확정 아님)와 선택 핸들이 없다는 것뿐이다
  const items = [
    ...measures.map(m => ({ m, draft: false })),
    ...(measureDraft ? [{ m: measureDraft, draft: true }] : []),
  ];

  return (
    <g style={{ pointerEvents: "none" }}>
      {items.map(({ m, draft }) => {
        const i1 = tsToIdx(m.t1, candles), i2 = tsToIdx(m.t2, candles);
        const rx1 = xScale(i1), rx2 = xScale(i2);
        const ry1 = yScale(m.p1), ry2 = yScale(m.p2);

        // ⚠ 좌표를 **화면 근처로 자른다.** 도형 좌표가 timestamp라 로드된 캔들보다
        //   과거에 그린 박스는 x가 수만 px 밖으로 나간다 (chart/svgGeom.js의 5m 실측).
        //   클립(#cc)이 어차피 가리므로 보이는 모양은 그대로다
        const xa = Math.min(rx1, rx2), xb = Math.max(rx1, rx2);
        const ya = Math.min(ry1, ry2), yb = Math.max(ry1, ry2);
        if (xb < -VIEW_PAD || xa > IW + VIEW_PAD) return null;
        const cx1 = Math.max(xa, -VIEW_PAD), cx2 = Math.min(xb, IW + VIEW_PAD);
        const cy1 = Math.max(ya, -VIEW_PAD), cy2 = Math.min(yb, IH + VIEW_PAD);

        const st = measureStats({ p1: m.p1, p2: m.p2, t1: m.t1, t2: m.t2 });
        const selected = !draft && m.id === selectedMeasureId;
        const color    = st.up ? PALETTE.long : PALETTE.short;
        const stroke   = selected ? SEL_COLOR : color;
        const opacity  = draft ? 0.9 : (m.opacity ?? 1.0);

        // 글자는 **잘린 사각형의 한가운데**에 둔다 — 박스가 화면에 걸쳐 있을 때
        // 진짜 중심을 쓰면 정작 측정값이 화면 밖으로 나간다
        const tx = (cx1 + cx2) / 2;
        const fits = (cx2 - cx1) >= FIT_W && (cy2 - cy1) >= FIT_H;
        // 안 들어가면 박스 위에 얹고, 위도 좁으면 아래에 (화면 밖으로 밀지 않는다)
        const above = cy1 - (LINE_H * 2 + 8) >= 0;
        const ty = fits ? (cy1 + cy2) / 2 - LINE_H
                        : above ? cy1 - LINE_H * 2 - 8 : cy2 + 14;
        const rows = [
          { text: fmtPct(st.pct),                                fs: PCT_FS, fill: color },
          { text: fmtPriceDiff(st.diff),                         fs: SUB_FS, fill: color },
          { text: fmtDuration(st.ms),                            fs: SUB_FS, fill: isDark ? "#94a3b8" : "#64748b" },
        ];

        return (
          <g key={draft ? "draft" : m.id} opacity={opacity}>
            <rect x={cx1} y={cy1} width={cx2 - cx1} height={cy2 - cy1}
              fill={color} fillOpacity={FILL_ALPHA}
              stroke={stroke} strokeWidth={1.5}
              strokeDasharray={draft ? "4,3" : undefined} />
            {/* 자물쇠 — 사각형 **윗변**을 선분처럼 넘긴다 (원이 가로 지름을 넘기는 것과 같다).
                왼쪽이 잘려 있어도 같은 헬퍼가 화면 안 지점을 찾아 준다 */}
            {!draft && m.locked && <LockMark pts={[{ x: xa, y: ya }, { x: xb, y: ya }]} IW={IW} />}
            {rows.map((r, k) => (
              <text key={k} x={tx} y={ty + k * LINE_H}
                textAnchor="middle" dominantBaseline="central"
                fontSize={r.fs} fontWeight={k === 0 ? 700 : 600}
                fontFamily="'JetBrains Mono','Fira Code','Courier New',monospace"
                fill={r.fill} stroke={halo} strokeWidth={3} paintOrder="stroke"
              >{r.text}</text>
            ))}
            {/* 선택 핸들 — **네 모서리 전부**. 사각형은 어느 귀퉁이를 잡아도 크기를
                고칠 수 있어야 한다 (원이 중심·반지름 두 점인 것과 다른 점) */}
            {selected && [[xa, ya], [xb, ya], [xa, yb], [xb, yb]].map(([hx, hy], k) => (
              <circle key={k} cx={hx} cy={hy} r={SEL_HANDLE_R} fill={SEL_COLOR} opacity={0.9} />
            ))}
          </g>
        );
      })}
    </g>
  );
});
