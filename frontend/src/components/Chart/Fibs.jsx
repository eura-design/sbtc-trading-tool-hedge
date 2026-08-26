import { memo } from "react";
import { useTheme } from "../../ThemeContext";
import { SEL_HANDLE_R } from "../../constants";
import { tsToIdx } from "../../chart/scales";
import { clipSegmentX, VIEW_PAD } from "../../chart/svgGeom";
import { FIB_COLOR, FIB_DEFAULT_LEVELS, fibPrice, fmtFibRatio, fibLevelsOf } from "../../chart/fib";
import { LockMark } from "./LockMark";

/**
 * 레벨 가로선 하나 + 비율 라벨. 화면 밖이면 null.
 *
 * ⚠ 모듈 스코프에 둘 것 — Fibs 안에 정의하면 렌더마다 새 컴포넌트 타입이 되어
 *   React가 선 7~10개 × 도형 수만큼을 매번 언마운트·리마운트한다.
 */
function FibLevel({ r, y, xl, xr, color, opacity, dashed, IW, haloColor }) {
  const seg = clipSegmentX(xl, y, xr, y, -VIEW_PAD, IW + VIEW_PAD);
  if (!seg) return null;
  const a = Math.min(seg.x1, seg.x2), b = Math.max(seg.x1, seg.x2);
  // 선이 화면 왼쪽으로 잘려나가도 라벨은 보이는 쪽 끝에 붙여 둔다 —
  // 안 그러면 과거로 스크롤했을 때 어느 선이 0.618인지 알 수 없다
  const lx = Math.max(a, 2);
  return (
    <g>
      <line x1={a} y1={y} x2={b} y2={y}
        stroke={color} strokeWidth={dashed ? 1.5 : 1} opacity={opacity}
        strokeDasharray={dashed ? "6,3" : undefined} />
      {lx < b - 6 && (
        <text x={lx} y={y - 3}
          fontSize={10} fontWeight={600}
          fontFamily="'JetBrains Mono','Fira Code','Courier New',monospace"
          fill={color} opacity={opacity}
          stroke={haloColor} strokeWidth={2.5} paintOrder="stroke">
          {fmtFibRatio(r)}
        </text>
      )}
    </g>
  );
}

/**
 * 피보나치 되돌림 SVG.
 *
 * 데이터: `{ id, t1, p1, t2, p2, opacity, locked, alert, levels }`
 *   (t1,p1) = 추세 시작 = 레벨 1 / (t2,p2) = 추세 끝 = 레벨 0  — chart/fib.js [F5]
 *
 * ── 사용자 확정 사양 (2026-08-14) ────────────────────────────────────────────
 *   [F1] 표시할 레벨은 **도형별**이다 (더블클릭 팝업). 전역 값을 만들지 말 것 (2026-08-15)
 *   [F2] **구간 채우기 없음.** 반투명 밴드를 깔지 말 것 (트뷰 기본값이지만 거절됐다)
 *   [F3] **라벨은 비율만.** 가격·현재가 대비 %를 붙이지 말 것 — 가격은 크로스헤어가 답한다
 *   [F4] **레벨 선은 두 앵커 사이에만.** 오른쪽/양쪽 화면 끝까지 연장하지 말 것
 *
 * 뷰포트 클리핑은 트렌드라인·채널과 같은 이유로 필수다 — 좌표가 timestamp라
 * 로드 범위보다 과거에 그린 도형은 화면 밖 수만 px에 찍히고, 알림 ON의 점선이
 * 그 길이만큼 조각으로 펼쳐진다 (chart/svgGeom.js의 5m 실측 참고).
 * 여기는 도형 하나가 **선 7~10개**라 트렌드라인보다 배율이 그만큼 더 크다.
 */
export const Fibs = memo(function Fibs({
  fibs, selectedFibId, fibStart, fibPreview,
  scales, IW, candles, isLog,
}) {
  const { isDark } = useTheme();
  if (!scales || !candles?.length) return null;
  const { xScale, yScale } = scales;

  const haloColor = isDark ? "#0d1117" : "#f9fafb";
  const xOf = t => xScale(tsToIdx(t, candles));

  return (
    <g style={{ pointerEvents: "none" }}>
      {fibs.map(fb => {
        const xa = xOf(fb.t1), xb = xOf(fb.t2);
        const ya = yScale(fb.p1), yb = yScale(fb.p2);
        const xl = Math.min(xa, xb), xr = Math.max(xa, xb);

        // 완전히 화면 밖이면 레벨 계산 자체를 건너뛴다 (도형당 선 7~10개라 컬링이 남는다)
        if (xr < -VIEW_PAD || xl > IW + VIEW_PAD) return null;

        const selected = fb.id === selectedFibId;
        const alert    = !!fb.alert;
        const color    = selected ? "#f0b90b" : alert ? "#fbbf24" : FIB_COLOR;
        const opacity  = fb.opacity ?? 1.0;

        // 앵커를 잇는 대각선 — "어느 방향 추세의 되돌림인가"를 보여준다.
        // 항상 촘촘한 점선(연하게)이라 알림 여부와 무관하다: 레벨선과 굵기·질감이 같으면
        // 가격 레벨이 아닌 이 선을 레벨로 착각한다
        const conn = clipSegmentX(xa, ya, xb, yb, -VIEW_PAD, IW + VIEW_PAD);

        // 이 도형의 레벨 — 팝업에서 고른다 ([F1]). 전부 끄면 대각선만 남는다
        const levels = fibLevelsOf(fb);

        return (
          <g key={fb.id}>
            {/* 자물쇠는 **앵커 대각선**에 붙인다 — 레벨선은 전부 끌 수 있지만
                대각선은 항상 그려지므로 (chart/fib.js [F1]) */}
            {fb.locked && conn && <LockMark
              pts={[{ x: conn.x1, y: conn.y1 }, { x: conn.x2, y: conn.y2 }]} IW={IW} />}
            {conn && (
              <line x1={conn.x1} y1={conn.y1} x2={conn.x2} y2={conn.y2}
                stroke={color} strokeWidth={1} opacity={opacity * 0.45}
                strokeDasharray="2,4" />
            )}
            {levels.map(r => (
              <FibLevel key={r} r={r}
                y={yScale(fibPrice(fb.p1, fb.p2, r, isLog))}
                xl={xl} xr={xr} color={color} opacity={opacity}
                // 알림 ON = 호박색 + 점선 (선/채널/원/수동 구조와 같은 규칙).
                // ※ 저쪽에 있는 **글로우(굵기 6)는 여기만 뺐다** — 레벨이 7~10줄이라
                //   겹쳐 깔면 그 가격대가 통째로 흐릿한 띠가 되어, 거절된 [F2] 채우기와
                //   똑같이 보인다. 색과 점선만으로 이미 구분된다
                dashed={alert && !selected}
                IW={IW} haloColor={haloColor} />
            ))}
            {selected && <>
              <circle cx={xa} cy={ya} r={SEL_HANDLE_R} fill="#f0b90b" opacity={0.9} />
              <circle cx={xb} cy={yb} r={SEL_HANDLE_R} fill="#f0b90b" opacity={0.9} />
            </>}
          </g>
        );
      })}

      {/* 그리기 프리뷰 — 대각선만 띄우면 "여기서 떼면 0.618이 어디에 놓이는지"를 알 수 없어서
          결국 찍고 나서 지우고 다시 그리게 된다.
          레벨은 **기본 7개**다 — 아직 도형이 없어 고른 레벨도 없고, 확정 직후 보게 될
          모습과 정확히 같다 (신규 도형은 levels 없이 저장돼 기본값으로 읽힌다) */}
      {fibStart && fibPreview && (() => {
        const xa = xOf(fibStart.t),   ya = yScale(fibStart.p);
        const xb = xOf(fibPreview.t), yb = yScale(fibPreview.p);
        const xl = Math.min(xa, xb), xr = Math.max(xa, xb);
        const conn = clipSegmentX(xa, ya, xb, yb, -VIEW_PAD, IW + VIEW_PAD);
        return (
          <g>
            {conn && (
              <line x1={conn.x1} y1={conn.y1} x2={conn.x2} y2={conn.y2}
                stroke={FIB_COLOR} strokeWidth={1} opacity={0.4} strokeDasharray="2,4" />
            )}
            {FIB_DEFAULT_LEVELS.map(r => (
              <FibLevel key={r} r={r}
                y={yScale(fibPrice(fibStart.p, fibPreview.p, r, isLog))}
                xl={xl} xr={xr} color={FIB_COLOR} opacity={0.45}
                dashed={false} IW={IW} haloColor={haloColor} />
            ))}
            <circle cx={xa} cy={ya} r={3} fill={FIB_COLOR} opacity={0.7} />
          </g>
        );
      })()}
    </g>
  );
});
