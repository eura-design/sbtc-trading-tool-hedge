import { memo, useMemo } from "react";
import * as d3 from "d3";
import { useTheme } from "../../ThemeContext";

const C_OB  = "#f6465d";
const C_OS  = "#0ecb81";
const C_MID = "#888888";

function getColor(v, ob, os) {
  return v >= ob ? C_OB : v <= os ? C_OS : C_MID;
}

// RSI threshold 교차 지점을 bar index로 보간
function interpolateCross(prev, curr, thresh) {
  const ratio = (thresh - prev.rsi) / (curr.rsi - prev.rsi);
  if (ratio < 0 || ratio > 1) return null;
  const i = prev.i + (curr.i - prev.i) * ratio;
  return { i, rsi: thresh };
}

function buildSegments(rsiData, ob, os) {
  if (!rsiData.length) return [];
  const segments = [];
  let cur = { color: getColor(rsiData[0].rsi, ob, os), points: [rsiData[0]] };

  for (let k = 1; k < rsiData.length; k++) {
    const prev = rsiData[k - 1];
    const next = rsiData[k];
    const prevColor = getColor(prev.rsi, ob, os);
    const nextColor = getColor(next.rsi, ob, os);

    if (prevColor === nextColor) { cur.points.push(next); continue; }

    const thresh = Math.abs(next.rsi - ob) < Math.abs(next.rsi - os) ? ob : os;
    const cross  = interpolateCross(prev, next, thresh);

    if (cross) {
      cur.points.push(cross);
      segments.push(cur);
      cur = { color: nextColor, points: [cross, next] };
    } else {
      segments.push(cur);
      cur = { color: nextColor, points: [next] };
    }
  }
  segments.push(cur);
  return segments;
}

export const RSIPanel = memo(function RSIPanel({ rsiData, xScale, IW, rsiH, rsiParams = {} }) {
  const { theme, isDark } = useTheme();
  const ob = rsiParams.overbought ?? 70;
  const os = rsiParams.oversold   ?? 30;
  const period = rsiParams.period ?? 14;

  if (!rsiData?.length || !xScale) return null;

  const yScale   = d3.scaleLinear().domain([0, 100]).range([rsiH, 0]);
  const lineFn   = d3.line().x(d => xScale(d.i)).y(d => yScale(d.rsi));
  // rsiData/ob/os가 바뀔 때만 재계산 (xScale 변경과 독립)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const segments = useMemo(() => buildSegments(rsiData, ob, os), [rsiData, ob, os]);
  const last      = rsiData[rsiData.length - 1]?.rsi;
  const lastColor = getColor(last, ob, os);

  return (
    <>
      <line x1={0} x2={IW} y1={0} y2={0}
        stroke={theme.borderSec} strokeWidth={1} opacity={0.4} />
      <rect x={0} y={1} width={IW} height={rsiH - 1}
        fill={isDark ? "#060a12" : "#f8fafc"} opacity={0.55} />
      <line x1={0} x2={IW} y1={yScale(ob)} y2={yScale(ob)}
        stroke={C_OB} strokeWidth={0.5} strokeDasharray="3,4" opacity={0.4} />
      <line x1={0} x2={IW} y1={yScale(50)} y2={yScale(50)}
        stroke={theme.textFaint} strokeWidth={0.5} strokeDasharray="2,4" opacity={0.3} />
      <line x1={0} x2={IW} y1={yScale(os)} y2={yScale(os)}
        stroke={C_OS} strokeWidth={0.5} strokeDasharray="3,4" opacity={0.4} />
      {segments.map((seg, i) => (
        <path key={i} d={lineFn(seg.points)} fill="none"
          stroke={seg.color} strokeWidth={seg.color === C_MID ? 0.8 : 1.2} opacity={1} />
      ))}
      <text x={4} y={8} fill={theme.textFaint} fontSize={10} opacity={0.55}>RSI {period}</text>
      <text x={4} y={yScale(ob) + 3.5} fill={C_OB} fontSize={9} opacity={0.5}>{ob}</text>
      <text x={4} y={yScale(os) + 3.5} fill={C_OS} fontSize={9} opacity={0.5}>{os}</text>
      {last != null && (
        <text x={IW - 2} y={Math.max(yScale(last) + 3.5, 10)}
          fill={lastColor} fontSize={11} textAnchor="end" fontWeight="700">
          {last.toFixed(1)}
        </text>
      )}
    </>
  );
});
