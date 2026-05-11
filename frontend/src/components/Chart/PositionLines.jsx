import { memo, useState } from "react";

function inView(px, IH) { return px !== null && px >= -20 && px <= IH + 20; }

const CL = "#0ecb81"; // LONG 계열 (초록)
const CS = "#f6465d"; // SHORT 계열 (빨강)

export const PositionLines = memo(function PositionLines({ position, tpsl, dragTpsl, tpslSaving, scaleInOrders, dragScaleIn, splitTps, dragSplitTp, scales, IW, IH }) {
  if (!position || !scales) return null;
  const { yScale } = scales;

  const [hoveredTpSide, setHoveredTpSide]   = useState(null);
  const [hoveredSlSide, setHoveredSlSide]   = useState(null);
  const [hoveredScaleIn, setHoveredScaleIn] = useState(null);
  const [hoveredSplitTp, setHoveredSplitTp] = useState(null);

  const splitTpList = splitTps ?? [];

  const longTpPrice  = dragTpsl?.type === "tp" && dragTpsl?.side === "LONG"  ? dragTpsl.price : tpsl.long?.tp?.price  ?? null;
  const longSlPrice  = dragTpsl?.type === "sl" && dragTpsl?.side === "LONG"  ? dragTpsl.price : tpsl.long?.sl?.price  ?? null;
  const shortTpPrice = dragTpsl?.type === "tp" && dragTpsl?.side === "SHORT" ? dragTpsl.price : tpsl.short?.tp?.price ?? null;
  const shortSlPrice = dragTpsl?.type === "sl" && dragTpsl?.side === "SHORT" ? dragTpsl.price : tpsl.short?.sl?.price ?? null;

  const longEntryPx  = position.long  ? yScale(position.long.entryPrice)  : null;
  const shortEntryPx = position.short ? yScale(position.short.entryPrice) : null;
  const longTpPx     = longTpPrice  !== null ? yScale(longTpPrice)  : null;
  const longSlPx     = longSlPrice  !== null ? yScale(longSlPrice)  : null;
  const shortTpPx    = shortTpPrice !== null ? yScale(shortTpPrice) : null;
  const shortSlPx    = shortSlPrice !== null ? yScale(shortSlPrice) : null;

  const longTpActive  = hoveredTpSide === "LONG"  || (dragTpsl?.type === "tp" && dragTpsl?.side === "LONG");
  const longSlActive  = hoveredSlSide === "LONG"  || (dragTpsl?.type === "sl" && dragTpsl?.side === "LONG");
  const shortTpActive = hoveredTpSide === "SHORT" || (dragTpsl?.type === "tp" && dragTpsl?.side === "SHORT");
  const shortSlActive = hoveredSlSide === "SHORT" || (dragTpsl?.type === "sl" && dragTpsl?.side === "SHORT");

  return (
    <g>
      {/* 진입선 */}
      {longEntryPx !== null && inView(longEntryPx, IH) && <>
        <line x1={0} x2={IW} y1={longEntryPx} y2={longEntryPx}
          stroke="#0ecb81" strokeWidth={1} opacity={0.7} />
        <rect x={IW-46} y={longEntryPx-9} width={46} height={16} rx={2} fill="#0ecb81" opacity={0.85} />
        <text x={IW-4} y={longEntryPx+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700">
          롱진입
        </text>
      </>}
      {shortEntryPx !== null && inView(shortEntryPx, IH) && <>
        <line x1={0} x2={IW} y1={shortEntryPx} y2={shortEntryPx}
          stroke="#f6465d" strokeWidth={1} opacity={0.7} />
        <rect x={IW-46} y={shortEntryPx-9} width={46} height={16} rx={2} fill="#f6465d" opacity={0.85} />
        <text x={IW-4} y={shortEntryPx+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700">
          숏진입
        </text>
      </>}

      {/* 롱 TP */}
      {longTpPx !== null && (
        <g>
          <line x1={0} x2={IW} y1={longTpPx} y2={longTpPx}
            stroke={CL} strokeWidth={longTpActive ? 2 : 1}
            opacity={longTpActive ? 0.8 : 0} />
          <rect x={IW-28} y={longTpPx-9} width={28} height={16} rx={2} fill={CL}
            opacity={longTpActive ? 0.85 : 0} />
          <text x={IW-4} y={longTpPx+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700"
            opacity={longTpActive ? 1 : 0}>
            TP
          </text>
          {!tpslSaving && inView(longTpPx, IH) && (
            <g style={{ cursor:"ns-resize" }}
              onMouseEnter={() => setHoveredTpSide("LONG")}
              onMouseLeave={() => setHoveredTpSide(null)}>
              <rect x={0} y={longTpPx-10} width={60} height={20} fill="transparent" />
              <polygon points={`14,${longTpPx-6} 24,${longTpPx} 14,${longTpPx+6}`} fill={CL} opacity={0.9} />
              <text x={28} y={longTpPx+3.5} fill={CL} fontSize={10} fontWeight="700"
                style={{ pointerEvents:"none" }}>TP</text>
            </g>
          )}
        </g>
      )}

      {/* 롱 SL */}
      {longSlPx !== null && (
        <g>
          <line x1={0} x2={IW} y1={longSlPx} y2={longSlPx}
            stroke={CL} strokeWidth={longSlActive ? 2 : 1}
            opacity={longSlActive ? 0.8 : 0} />
          <rect x={IW-28} y={longSlPx-9} width={28} height={16} rx={2} fill={CL}
            opacity={longSlActive ? 0.85 : 0} />
          <text x={IW-4} y={longSlPx+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700"
            opacity={longSlActive ? 1 : 0}>
            SL
          </text>
          {!tpslSaving && inView(longSlPx, IH) && (
            <g style={{ cursor:"ns-resize" }}
              onMouseEnter={() => setHoveredSlSide("LONG")}
              onMouseLeave={() => setHoveredSlSide(null)}>
              <rect x={0} y={longSlPx-10} width={60} height={20} fill="transparent" />
              <polygon points={`14,${longSlPx-6} 24,${longSlPx} 14,${longSlPx+6}`} fill={CL} opacity={0.9} />
              <text x={28} y={longSlPx+3.5} fill={CL} fontSize={10} fontWeight="700"
                style={{ pointerEvents:"none" }}>SL</text>
            </g>
          )}
        </g>
      )}

      {/* 숏 TP */}
      {shortTpPx !== null && (
        <g>
          <line x1={0} x2={IW} y1={shortTpPx} y2={shortTpPx}
            stroke={CS} strokeWidth={shortTpActive ? 2 : 1}
            opacity={shortTpActive ? 0.8 : 0} />
          <rect x={IW-28} y={shortTpPx-9} width={28} height={16} rx={2} fill={CS}
            opacity={shortTpActive ? 0.85 : 0} />
          <text x={IW-4} y={shortTpPx+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700"
            opacity={shortTpActive ? 1 : 0}>
            TP
          </text>
          {!tpslSaving && inView(shortTpPx, IH) && (
            <g style={{ cursor:"ns-resize" }}
              onMouseEnter={() => setHoveredTpSide("SHORT")}
              onMouseLeave={() => setHoveredTpSide(null)}>
              <rect x={0} y={shortTpPx-10} width={60} height={20} fill="transparent" />
              <polygon points={`14,${shortTpPx-6} 24,${shortTpPx} 14,${shortTpPx+6}`} fill={CS} opacity={0.9} />
              <text x={28} y={shortTpPx+3.5} fill={CS} fontSize={10} fontWeight="700"
                style={{ pointerEvents:"none" }}>TP</text>
            </g>
          )}
        </g>
      )}

      {/* 숏 SL */}
      {shortSlPx !== null && (
        <g>
          <line x1={0} x2={IW} y1={shortSlPx} y2={shortSlPx}
            stroke={CS} strokeWidth={shortSlActive ? 2 : 1}
            opacity={shortSlActive ? 0.8 : 0} />
          <rect x={IW-28} y={shortSlPx-9} width={28} height={16} rx={2} fill={CS}
            opacity={shortSlActive ? 0.85 : 0} />
          <text x={IW-4} y={shortSlPx+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700"
            opacity={shortSlActive ? 1 : 0}>
            SL
          </text>
          {!tpslSaving && inView(shortSlPx, IH) && (
            <g style={{ cursor:"ns-resize" }}
              onMouseEnter={() => setHoveredSlSide("SHORT")}
              onMouseLeave={() => setHoveredSlSide(null)}>
              <rect x={0} y={shortSlPx-10} width={60} height={20} fill="transparent" />
              <polygon points={`14,${shortSlPx-6} 24,${shortSlPx} 14,${shortSlPx+6}`} fill={CS} opacity={0.9} />
              <text x={28} y={shortSlPx+3.5} fill={CS} fontSize={10} fontWeight="700"
                style={{ pointerEvents:"none" }}>SL</text>
            </g>
          )}
        </g>
      )}

      {/* 추가 진입 대기 */}
      {scaleInOrders?.map(o => {
        const isDragging = dragScaleIn?.orderId === o.orderId;
        const isHovered = hoveredScaleIn === o.orderId;
        const isActive = isDragging || isHovered;
        const displayPrice = isDragging ? dragScaleIn.price : o.price;
        const px = yScale(displayPrice);
        const C = o.side === "BUY" ? CL : CS; // BUY = 롱 추가진입(초록), SELL = 숏 추가진입(빨강)
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

      {/* 분할 TP */}
      {splitTpList.map(o => {
        const isDragging = dragSplitTp?.orderId === o.orderId;
        const isHovered = hoveredSplitTp === o.orderId;
        const isActive = isDragging || isHovered;
        const displayPrice = isDragging ? dragSplitTp.price : o.price;
        const px = yScale(displayPrice);
        const C = o.side === "SELL" ? CL : CS; // SELL = 롱 청산(초록), BUY = 숏 청산(빨강)
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

      {/* 드래그 중 레이블 */}
      {dragTpsl && (() => {
        const dpx = yScale(dragTpsl.price);
        const DC = dragTpsl.side === "LONG" ? CL : CS;
        if (!inView(dpx, IH)) return null;
        return (
          <g>
            <rect x={IW/2-20} y={dpx-13} width={40} height={18} rx={3}
              fill="#0b1120" stroke={DC} strokeWidth={1} />
            <text x={IW/2} y={dpx+1} fill={DC} fontSize={12} textAnchor="middle" fontWeight="700">
              {dragTpsl.type.toUpperCase()}
            </text>
          </g>
        );
      })()}
    </g>
  );
});
