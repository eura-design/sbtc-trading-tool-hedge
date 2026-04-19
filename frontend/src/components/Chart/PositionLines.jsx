import { memo, useState } from "react";

function inView(px, IH) { return px !== null && px >= -20 && px <= IH + 20; }

const C = "#888888";
const ENTRY_C = "#60a5fa";

export const PositionLines = memo(function PositionLines({ position, tpsl, dragTpsl, tpslSaving, scaleInOrders, dragScaleIn, splitTps, dragSplitTp, scales, IW, IH }) {
  if (!position || !scales) return null;
  const { yScale } = scales;

  const [hoveredTp, setHoveredTp] = useState(false);
  const [hoveredSl, setHoveredSl] = useState(false);
  const [hoveredScaleIn, setHoveredScaleIn] = useState(null);
  const [hoveredSplitTp, setHoveredSplitTp] = useState(null);

  const splitTpList = splitTps ?? [];
  const tpPrice  = dragTpsl?.type === "tp" ? dragTpsl.price : tpsl.tp?.price ?? null;
  const slPrice  = dragTpsl?.type === "sl" ? dragTpsl.price : tpsl.sl?.price ?? null;
  const entryPx  = yScale(position.entryPrice);
  const tpPx     = tpPrice !== null ? yScale(tpPrice) : null;
  const slPx     = slPrice !== null ? yScale(slPrice) : null;

  const tpActive = hoveredTp || dragTpsl?.type === "tp";
  const slActive = hoveredSl || dragTpsl?.type === "sl";

  return (
    <g>
      {inView(entryPx, IH) && <>
        <line x1={0} x2={IW} y1={entryPx} y2={entryPx}
          stroke={ENTRY_C} strokeWidth={1} opacity={0.7} />
        <rect x={IW-36} y={entryPx-9} width={36} height={16} rx={2} fill={ENTRY_C} opacity={0.85} />
        <text x={IW-4} y={entryPx+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700">
          진입
        </text>
      </>}

      {tpPx !== null && (
        <g>
          <line x1={0} x2={IW} y1={tpPx} y2={tpPx}
            stroke={C} strokeWidth={tpActive ? 2 : 1}
            opacity={tpActive ? 0.8 : 0} />
          <rect x={IW-28} y={tpPx-9} width={28} height={16} rx={2} fill={C}
            opacity={tpActive ? 0.85 : 0} />
          <text x={IW-4} y={tpPx+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700"
            opacity={tpActive ? 1 : 0}>
            TP
          </text>
          {!tpslSaving && inView(tpPx, IH) && (
            <g style={{ cursor:"ns-resize" }}
              onMouseEnter={() => setHoveredTp(true)}
              onMouseLeave={() => setHoveredTp(false)}>
              <rect x={0} y={tpPx-10} width={60} height={20} fill="transparent" />
              <polygon points={`14,${tpPx-6} 24,${tpPx} 14,${tpPx+6}`} fill={C} opacity={0.9} />
              <text x={28} y={tpPx+3.5} fill={C} fontSize={10} fontWeight="700"
                style={{ pointerEvents:"none" }}>TP</text>
            </g>
          )}
        </g>
      )}

      {slPx !== null && (
        <g>
          <line x1={0} x2={IW} y1={slPx} y2={slPx}
            stroke={C} strokeWidth={slActive ? 2 : 1}
            opacity={slActive ? 0.8 : 0} />
          <rect x={IW-28} y={slPx-9} width={28} height={16} rx={2} fill={C}
            opacity={slActive ? 0.85 : 0} />
          <text x={IW-4} y={slPx+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700"
            opacity={slActive ? 1 : 0}>
            SL
          </text>
          {!tpslSaving && inView(slPx, IH) && (
            <g style={{ cursor:"ns-resize" }}
              onMouseEnter={() => setHoveredSl(true)}
              onMouseLeave={() => setHoveredSl(false)}>
              <rect x={0} y={slPx-10} width={60} height={20} fill="transparent" />
              <polygon points={`14,${slPx-6} 24,${slPx} 14,${slPx+6}`} fill={C} opacity={0.9} />
              <text x={28} y={slPx+3.5} fill={C} fontSize={10} fontWeight="700"
                style={{ pointerEvents:"none" }}>SL</text>
            </g>
          )}
        </g>
      )}

      {scaleInOrders?.map(o => {
        const isDragging = dragScaleIn?.orderId === o.orderId;
        const isHovered = hoveredScaleIn === o.orderId;
        const isActive = isDragging || isHovered;
        const displayPrice = isDragging ? dragScaleIn.price : o.price;
        const px = yScale(displayPrice);
        if (!inView(px, IH)) return null;
        return (
          <g key={o.orderId}>
            <line x1={0} x2={IW} y1={px} y2={px}
              stroke={C} strokeWidth={isDragging ? 2 : 1}
              opacity={isActive ? (isDragging ? 1 : 0.8) : 0} />
            <rect x={IW-52} y={px-9} width={52} height={16} rx={2} fill={C}
              opacity={isActive ? 0.85 : 0} />
            <text x={IW-4} y={px+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700"
              opacity={isActive ? 1 : 0}>
              추가대기
            </text>
            <g style={{ cursor:"ns-resize" }}
              onMouseEnter={() => setHoveredScaleIn(o.orderId)}
              onMouseLeave={() => setHoveredScaleIn(null)}>
              <rect x={0} y={px-10} width={60} height={20} fill="transparent" />
              <polygon points={`14,${px-6} 24,${px} 14,${px+6}`} fill={C} opacity={0.9} />
              <text x={28} y={px+3.5} fill={C} fontSize={10} fontWeight="700"
                style={{ pointerEvents:"none" }}>+</text>
            </g>
            {isDragging && (
              <g>
                <rect x={IW/2-36} y={px-13} width={72} height={18} rx={3}
                  fill="#0b1120" stroke={C} strokeWidth={1} />
                <text x={IW/2} y={px+1} fill={C} fontSize={12} textAnchor="middle" fontWeight="700">
                  추가진입
                </text>
              </g>
            )}
          </g>
        );
      })}

      {splitTpList.map(o => {
        const isDragging = dragSplitTp?.orderId === o.orderId;
        const isHovered = hoveredSplitTp === o.orderId;
        const isActive = isDragging || isHovered;
        const displayPrice = isDragging ? dragSplitTp.price : o.price;
        const px = yScale(displayPrice);
        if (!inView(px, IH)) return null;
        return (
          <g key={o.orderId}>
            <line x1={0} x2={IW} y1={px} y2={px}
              stroke={C} strokeWidth={isDragging ? 2 : 1}
              opacity={isActive ? (isDragging ? 1 : 0.85) : 0} />
            <rect x={IW-44} y={px-9} width={44} height={16} rx={2} fill={C}
              opacity={isActive ? 0.85 : 0} />
            <text x={IW-4} y={px+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700"
              opacity={isActive ? 1 : 0}>
              분할TP
            </text>
            <g style={{ cursor: "ns-resize" }}
              onMouseEnter={() => setHoveredSplitTp(o.orderId)}
              onMouseLeave={() => setHoveredSplitTp(null)}>
              <rect x={0} y={px-10} width={60} height={20} fill="transparent" />
              <polygon points={`14,${px-6} 24,${px} 14,${px+6}`} fill={C} opacity={0.9} />
              <text x={28} y={px+3.5} fill={C} fontSize={10} fontWeight="700"
                style={{ pointerEvents: "none" }}>TP</text>
            </g>
            {isDragging && (
              <g>
                <rect x={IW/2-30} y={px-13} width={60} height={18} rx={3}
                  fill="#0b1120" stroke={C} strokeWidth={1} />
                <text x={IW/2} y={px+1} fill={C} fontSize={12} textAnchor="middle" fontWeight="700">
                  분할TP
                </text>
              </g>
            )}
          </g>
        );
      })}

      {dragTpsl && (() => {
        const dpx = yScale(dragTpsl.price);
        if (!inView(dpx, IH)) return null;
        return (
          <g>
            <rect x={IW/2-20} y={dpx-13} width={40} height={18} rx={3}
              fill="#0b1120" stroke={C} strokeWidth={1} />
            <text x={IW/2} y={dpx+1} fill={C} fontSize={12} textAnchor="middle" fontWeight="700">
              {dragTpsl.type.toUpperCase()}
            </text>
          </g>
        );
      })()}
    </g>
  );
});
