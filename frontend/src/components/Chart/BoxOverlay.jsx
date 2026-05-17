import { memo } from "react";
import * as d3 from "d3";
import { useTheme } from "../../ThemeContext";
import { calcRR } from "../../utils/format";
import { tsToIdx } from "../../chart/scales";

export const BoxOverlay = memo(function BoxOverlay({ drawing, scales, IW, hasLong, hasShort, selectedBox, candles }) {
  const { theme } = useTheme();
  if (!drawing || !scales || !candles?.length) return null;
  // 헷지모드: 박스가 그려진 사이드의 포지션만 점유 판정 (반대편 포지션과 무관)
  const sameSidePos = drawing.isLong ? hasLong : hasShort;
  const { xScale, yScale } = scales;
  const fmtI = p => `$${d3.format(",.0f")(p)}`;

  const x1 = Math.max(xScale(tsToIdx(drawing.tStart, candles)), 0);
  const x2 = Math.min(xScale(tsToIdx(drawing.tEnd, candles)), IW);
  if (x2 <= x1) return null;
  const w   = x2 - x1;
  const cx  = x1 + w / 2;
  const ePx = yScale(drawing.entry);
  const tPx = yScale(drawing.tp);
  const slPx= yScale(drawing.sl);
  const color = drawing.isLong ? "#0ecb81" : "#f6465d";

  return (
    <g>
      {selectedBox && (
        <rect x={x1-2} y={Math.min(tPx, slPx)-2} width={w+4} height={Math.abs(tPx - slPx)+4}
          fill="none" stroke="#f0b90b" strokeWidth={1.5} strokeDasharray="5,3" rx={2} opacity={0.7} />
      )}
      <rect x={x1} y={Math.min(ePx, tPx)} width={w} height={Math.abs(ePx - tPx)}
        fill={drawing.isLong ? "rgba(14,203,129,0.10)" : "rgba(246,70,93,0.10)"} />
      <rect x={x1} y={Math.min(ePx, slPx)} width={w} height={Math.abs(ePx - slPx)}
        fill={drawing.isLong ? "rgba(246,70,93,0.07)" : "rgba(14,203,129,0.07)"} />
      <rect x={x1} y={Math.min(tPx, slPx)} width={w} height={Math.abs(tPx - slPx)}
        fill="none" stroke={color} strokeWidth={0.8} strokeDasharray="5,3" strokeOpacity={0.4} />
      <line x1={x1} x2={x2} y1={tPx}  y2={tPx}  stroke={color}   strokeWidth={1.5} />
      <line x1={x1} x2={x2} y1={ePx}  y2={ePx}  stroke="#f0b90b" strokeWidth={2} />
      <line x1={x1} x2={x2} y1={slPx} y2={slPx} stroke="#f6465d" strokeWidth={1.5} strokeDasharray="5,2" />
      {!sameSidePos && <>
        <polygon points={`${cx},${tPx-9} ${cx-7},${tPx-2} ${cx+7},${tPx-2}`}
          fill={color} opacity={0.9} style={{ cursor:"ns-resize" }} />
        <circle cx={cx} cy={ePx} r={6} fill="#f0b90b" opacity={0.9} style={{ cursor:"ns-resize" }} />
        <text x={cx} y={ePx+3.5} fill="#000" fontSize={10} textAnchor="middle"
          fontWeight="700" style={{ pointerEvents:"none" }}>↕</text>
        <rect x={cx-6} y={slPx-6} width={12} height={12} rx={2}
          fill="#f6465d" opacity={0.9} style={{ cursor:"ns-resize" }}
          transform={`rotate(45,${cx},${slPx})`} />
      </>}
      <rect x={cx-28} y={ePx-10} width={56} height={18} rx={3} fill={theme.bgMain} stroke={color} strokeWidth={0.8} />
      <text x={cx} y={ePx+3} fill={color} fontSize={11} textAnchor="middle" fontWeight="700">
        1 : {calcRR(drawing.entry, drawing.tp, drawing.sl, drawing.isLong)}
      </text>
      <text x={x1+4} y={tPx+(drawing.isLong?12:-4)} fill={color} fontSize={11} fontWeight="700">
        {drawing.isLong ? "▲ LONG" : "▼ SHORT"}
      </text>
    </g>
  );
});

export const DrawingCurrent = memo(function DrawingCurrent({ current, scales, IW, IH }) {
  if (!current || !scales) return null;
  const sy = current.y1, ey = current.y2, isLong = ey > sy; // 롱=아래로 드래그
  const color = isLong ? "#0ecb81" : "#f6465d";
  const x1 = Math.min(current.x1, current.x2);
  const x2 = Math.max(current.x1, current.x2);
  const w  = x2 - x1;
  const tpPx = Math.min(Math.max(3 * sy - 2 * ey, 0), IH); // SL 거리 2배 반대 방향 = TP
  return (
    <g>
      {/* TP 구간 (수익) */}
      <rect x={x1} y={Math.min(sy, tpPx)} width={w} height={Math.abs(sy - tpPx)}
        fill={isLong ? "rgba(14,203,129,0.08)" : "rgba(246,70,93,0.08)"}
        stroke={color} strokeWidth={1} strokeDasharray="4,3" strokeOpacity={0.7} />
      {/* SL 구간 (손실) */}
      <rect x={x1} y={Math.min(sy, ey)} width={w} height={Math.abs(sy - ey)}
        fill={isLong ? "rgba(246,70,93,0.05)" : "rgba(14,203,129,0.05)"} />
      <line x1={x1} x2={x2} y1={sy}   y2={sy}   stroke="#f0b90b" strokeWidth={1.5} strokeDasharray="4,3" />
      <line x1={x1} x2={x2} y1={ey}   y2={ey}   stroke="#f6465d" strokeWidth={1} strokeDasharray="3,3" strokeOpacity={0.5} />
    </g>
  );
});

export const BoxLabels = memo(function BoxLabels({ drawing, scales, IW, candles }) {
  if (!drawing || !scales || !candles?.length) return null;
  const { xScale, yScale } = scales;
  const fmtI = p => `$${d3.format(",.0f")(p)}`;
  const lx = Math.min(xScale(tsToIdx(drawing.tEnd, candles)), IW) + 4;
  return (
    <g>
      <text x={lx} y={yScale(drawing.tp)+4}    fill={drawing.isLong?"#0ecb81":"#f6465d"} fontSize={11}>TP {fmtI(drawing.tp)}</text>
      <text x={lx} y={yScale(drawing.entry)+4}  fill="#f0b90b" fontSize={11}>진입 {fmtI(drawing.entry)}</text>
      <text x={lx} y={yScale(drawing.sl)+4}     fill="#f6465d" fontSize={11}>SL {fmtI(drawing.sl)}</text>
    </g>
  );
});
