import { memo } from "react";
import { tsToIdx } from "../../chart/scales";

const CIRCLE_COLOR = "#60a5fa"; // 진입선과 동일

export const Circles = memo(function Circles({
  circles, selectedCircleId,
  circleCenter, circlePreview,
  scales, IW, IH, candles,
}) {
  if (!scales || !candles?.length) return null;
  const { xScale, yScale } = scales;

  function toXY(t, p) {
    const idx = tsToIdx(t, candles);
    return { x: xScale(idx), y: yScale(p) };
  }

  // 픽셀 반지름: 중심과 끝점 사이의 유클리드 거리
  function calcR(cx, cy, rx, ry) {
    return Math.hypot(rx - cx, ry - cy);
  }

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* 저장된 원들 */}
      {circles.map(ci => {
        const c  = toXY(ci.cx_t, ci.cx_p);
        const re = toXY(ci.rx_t, ci.rx_p);
        const r  = calcR(c.x, c.y, re.x, re.y);
        if (r < 2) return null;
        const selected = ci.id === selectedCircleId;
        const alert    = !!ci.alert;
        const color    = selected ? "#f0b90b" : alert ? "#fbbf24" : CIRCLE_COLOR;
        const opacity  = ci.opacity ?? 1.0;
        const sw       = selected || alert ? 1.5 : 1;

        return (
          <g key={ci.id}>
            {/* 채우기 */}
            <circle cx={c.x} cy={c.y} r={r}
              fill={color} opacity={selected ? 0.06 : alert ? 0.05 : 0.03} />
            {/* 테두리 */}
            <circle cx={c.x} cy={c.y} r={r}
              fill="none" stroke={color}
              strokeWidth={sw} opacity={opacity}
              strokeDasharray={alert && !selected ? "6,3" : undefined} />
            {/* 알림 아이콘 (원 상단) */}
            {alert && !selected && (
              <text x={c.x} y={c.y - r - 4} textAnchor="middle"
                fontSize="11" fill="#fbbf24" opacity={opacity}
                style={{ pointerEvents: "none" }}>🔔</text>
            )}
            {/* 선택 핸들 */}
            {selected && <>
              <circle cx={c.x}  cy={c.y}  r={5} fill="#f0b90b" opacity={0.9} />
              <circle cx={re.x} cy={re.y} r={5} fill="#f0b90b" opacity={0.9} />
            </>}
          </g>
        );
      })}

      {/* 그리기 프리뷰: 중심 찍힌 후 반지름 드래그 */}
      {circleCenter && circlePreview && (() => {
        const c  = toXY(circleCenter.t, circleCenter.p);
        const re = toXY(circlePreview.t, circlePreview.p);
        const r  = calcR(c.x, c.y, re.x, re.y);
        return (
          <g>
            <circle cx={c.x} cy={c.y} r={Math.max(r, 2)}
              fill={CIRCLE_COLOR} fillOpacity={0.03}
              stroke={CIRCLE_COLOR} strokeWidth={1} opacity={0.5} strokeDasharray="4,3" />
            <circle cx={c.x} cy={c.y} r={3} fill={CIRCLE_COLOR} opacity={0.7} />
          </g>
        );
      })()}
    </g>
  );
});
