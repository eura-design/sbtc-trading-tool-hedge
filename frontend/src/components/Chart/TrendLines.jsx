import { memo } from "react";
import { useTheme } from "../../ThemeContext";
import { tsToIdx } from "../../chart/scales";
import { clipPolylineX, clipSegmentX, VIEW_PAD } from "../../chart/svgGeom";

// 로그 모드: bar index 기반 지수 보간 폴리라인 → [{ x, y }]
// (문자열이 아니라 좌표 배열로 낸다 — 그려지기 전에 뷰포트로 잘라야 하므로)
function logPoints(i1, p1, i2, p2, xScale, yScale, N = 50) {
  const pts = [];
  for (let k = 0; k <= N; k++) {
    const a = k / N;
    pts.push({ x: xScale(i1 + (i2 - i1) * a), y: yScale(p1 * Math.pow(p2 / p1, a)) });
  }
  return pts;
}
const toPolyStr = pts => pts.map(q => `${q.x},${q.y}`).join(" ");

export const TrendLines = memo(function TrendLines({ lines, selectedLineId, lineStart, linePreview, scales, IW, IH, isLog, candles }) {
  const { isDark } = useTheme();
  const lineColor = "#888888";
  if (!scales) return null;
  const { xScale, yScale } = scales;

  // timestamp → 현재 타임프레임의 bar index → pixel
  function toXY(t, p) {
    const idx = tsToIdx(t, candles);
    return { x: xScale(idx), y: yScale(p) };
  }

  return (
    <g style={{ pointerEvents: "none" }}>
      {lines.map((ln) => {
        const i1 = tsToIdx(ln.t1, candles);
        const i2 = tsToIdx(ln.t2, candles);
        const a        = { x: xScale(i1), y: yScale(ln.p1) };
        const b        = { x: xScale(i2), y: yScale(ln.p2) };
        const selected = ln.id === selectedLineId;
        const alert    = !!ln.alert;
        const color    = selected ? "#f0b90b" : alert ? "#fbbf24" : lineColor;
        const opacity  = selected ? 0.9 : (ln.opacity ?? 1.0);
        // 뷰포트로 자른다 — 좌표가 timestamp라 로드 범위보다 과거에 그린 선은
        // 화면 밖 수만 px에 찍히고, 알림 ON의 점선이 그 길이만큼 조각으로 펼쳐진다
        // (5m에서 8,000조각 넘게 나온다 — chart/svgGeom.js 주석의 실측 참고)
        const seg = clipSegmentX(a.x, a.y, b.x, b.y, -VIEW_PAD, IW + VIEW_PAD);
        const vis = isLog
          ? clipPolylineX(logPoints(i1, ln.p1, i2, ln.p2, xScale, yScale), IW)
          : null;
        if (isLog ? vis.length < 2 : !seg) return null;      // 완전히 화면 밖
        const pts = isLog ? toPolyStr(vis) : null;
        const A   = isLog ? vis[0] : { x: seg.x1, y: seg.y1 };
        const Bp  = isLog ? vis[vis.length - 1] : { x: seg.x2, y: seg.y2 };
        return (
          <g key={ln.id}>
            {(alert || selected) && (
              isLog
                ? <polyline points={pts} fill="none" stroke={color} strokeWidth={6} opacity={0.18} />
                : <line x1={A.x} y1={A.y} x2={Bp.x} y2={Bp.y} stroke={color} strokeWidth={6} opacity={0.18} />
            )}
            {isLog
              ? <polyline points={pts} fill="none" stroke={color}
                  strokeWidth={selected ? 1.5 : alert ? 1.5 : 1}
                  opacity={opacity}
                  strokeDasharray={alert && !selected ? "6,3" : undefined} />
              : <line x1={A.x} y1={A.y} x2={Bp.x} y2={Bp.y}
                  stroke={color}
                  strokeWidth={selected ? 1.5 : alert ? 1.5 : 1}
                  opacity={opacity}
                  strokeDasharray={alert && !selected ? "6,3" : undefined} />
            }
            {/* ※ 알림 ON을 나타내던 🔔 아이콘은 2026-08-14 사용자 요청으로 제거했다.
                알림 여부는 **호박색 + 점선**만으로 나타낸다 (채널/원/수동 구조도 동일 —
                한쪽만 되살리면 같은 🔔인데 도형 종류마다 다르게 보인다).
                켜고 끄는 곳은 더블클릭 팝업의 🔔 토글이다 — 그건 그대로 있다 */}
            {selected && <>
              <circle cx={a.x} cy={a.y} r={5} fill="#f0b90b" opacity={0.9} />
              <circle cx={b.x} cy={b.y} r={5} fill="#f0b90b" opacity={0.9} />
            </>}
          </g>
        );
      })}

      {/* 프리뷰 선 */}
      {lineStart && linePreview && (() => {
        const a = toXY(lineStart.t, lineStart.p);
        const b = toXY(linePreview.t, linePreview.p);
        const i1 = tsToIdx(lineStart.t, candles);
        const i2 = tsToIdx(linePreview.t, candles);
        // 프리뷰도 점선이라 자른다 (한쪽 끝이 과거 도형 위에 스냅되면 멀리 나갈 수 있다)
        const vis = isLog ? clipPolylineX(logPoints(i1, lineStart.p, i2, linePreview.p, xScale, yScale), IW) : null;
        const seg = isLog ? null : clipSegmentX(a.x, a.y, b.x, b.y, -VIEW_PAD, IW + VIEW_PAD);
        return (
          <g>
            {isLog
              ? vis.length >= 2 && <polyline points={toPolyStr(vis)} fill="none" stroke={lineColor} strokeWidth={1} opacity={0.4} strokeDasharray="4,3" />
              : seg && <line x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} stroke={lineColor} strokeWidth={1} opacity={0.4} strokeDasharray="4,3" />
            }
            <circle cx={a.x} cy={a.y} r={3} fill={lineColor} opacity={0.7} />
          </g>
        );
      })()}
    </g>
  );
});
