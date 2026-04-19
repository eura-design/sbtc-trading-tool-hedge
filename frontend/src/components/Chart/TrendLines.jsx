import { memo } from "react";
import { useTheme } from "../../ThemeContext";
import { tsToIdx } from "../../chart/scales";

// 로그 모드: bar index 기반 지수 보간 폴리라인
function logPoints(i1, p1, i2, p2, xScale, yScale, N = 50) {
  const pts = [];
  for (let k = 0; k <= N; k++) {
    const a = k / N;
    const x = xScale(i1 + (i2 - i1) * a);
    const y = yScale(p1 * Math.pow(p2 / p1, a));
    pts.push(`${x},${y}`);
  }
  return pts.join(" ");
}

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
        const mx       = (a.x + b.x) / 2;
        const my       = (a.y + b.y) / 2;
        const pts      = isLog ? logPoints(i1, ln.p1, i2, ln.p2, xScale, yScale) : null;
        return (
          <g key={ln.id}>
            {(alert || selected) && (
              isLog
                ? <polyline points={pts} fill="none" stroke={color} strokeWidth={6} opacity={0.18} />
                : <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={6} opacity={0.18} />
            )}
            {isLog
              ? <polyline points={pts} fill="none" stroke={color}
                  strokeWidth={selected ? 1.5 : alert ? 1.5 : 1}
                  opacity={opacity}
                  strokeDasharray={alert && !selected ? "6,3" : undefined} />
              : <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={color}
                  strokeWidth={selected ? 1.5 : alert ? 1.5 : 1}
                  opacity={opacity}
                  strokeDasharray={alert && !selected ? "6,3" : undefined} />
            }
            {alert && !selected && (
              <text x={mx} y={my - 7} textAnchor="middle"
                fontSize="11" fill="#fbbf24" opacity={opacity}
                style={{ pointerEvents: "none" }}>🔔</text>
            )}
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
        const pts = isLog ? logPoints(i1, lineStart.p, i2, linePreview.p, xScale, yScale) : null;
        return (
          <g>
            {isLog
              ? <polyline points={pts} fill="none" stroke={lineColor} strokeWidth={1} opacity={0.4} strokeDasharray="4,3" />
              : <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={lineColor} strokeWidth={1} opacity={0.4} strokeDasharray="4,3" />
            }
            <circle cx={a.x} cy={a.y} r={3} fill={lineColor} opacity={0.7} />
          </g>
        );
      })()}
    </g>
  );
});
