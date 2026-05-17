import { memo, useState } from "react";
import { PALETTE } from "../../constants";

function inView(px, IH) { return px !== null && px >= -20 && px <= IH + 20; }

const CL = PALETTE.long;  // LONG 계열 (초록)
const CS = PALETTE.short; // SHORT 계열 (빨강)

// 좌측 핸들 + 우측 라벨 + 가로선으로 구성된 가격 마커.
// TP/SL, 추가진입 대기, 분할TP 마커가 모두 동일 골격을 공유한다.
function PriceLineMarker({
  yPx, color, IW, IH,
  rightLabelWidth, rightLabelText, handleChar,
  isActive, isDragging,
  showHandle = true,
  dragCenterText, dragCenterWidth = 40,
  onHandleEnter, onHandleLeave,
}) {
  if (!inView(yPx, IH)) return null;
  const lineOpacity  = isActive ? (isDragging ? 1 : 0.8) : 0;
  const labelOpacity = isActive ? 0.85 : 0;
  return (
    <g>
      <line x1={0} x2={IW} y1={yPx} y2={yPx}
        stroke={color} strokeWidth={isActive ? 2 : 1} opacity={lineOpacity} />
      <rect x={IW-rightLabelWidth} y={yPx-9} width={rightLabelWidth} height={16} rx={2}
        fill={color} opacity={labelOpacity} />
      <text x={IW-4} y={yPx+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700"
        opacity={isActive ? 1 : 0}>
        {rightLabelText}
      </text>
      {showHandle && (
        <g style={{ cursor:"ns-resize" }}
          onMouseEnter={onHandleEnter} onMouseLeave={onHandleLeave}>
          <rect x={0} y={yPx-10} width={60} height={20} fill="transparent" />
          <polygon points={`14,${yPx-6} 24,${yPx} 14,${yPx+6}`} fill={color} opacity={0.9} />
          <text x={28} y={yPx+3.5} fill={color} fontSize={10} fontWeight="700"
            style={{ pointerEvents:"none" }}>{handleChar}</text>
        </g>
      )}
      {isDragging && dragCenterText && (
        <g>
          <rect x={IW/2 - dragCenterWidth/2} y={yPx-13} width={dragCenterWidth} height={18} rx={3}
            fill="#0b1120" stroke={color} strokeWidth={1} />
          <text x={IW/2} y={yPx+1} fill={color} fontSize={12} textAnchor="middle" fontWeight="700">
            {dragCenterText}
          </text>
        </g>
      )}
    </g>
  );
}

function EntryLine({ yPx, color, label, IW, IH }) {
  if (!inView(yPx, IH)) return null;
  return (
    <>
      <line x1={0} x2={IW} y1={yPx} y2={yPx} stroke={color} strokeWidth={1} opacity={0.7} />
      <rect x={IW-46} y={yPx-9} width={46} height={16} rx={2} fill={color} opacity={0.85} />
      <text x={IW-4} y={yPx+4} fill="#fff" fontSize={11} textAnchor="end" fontWeight="700">
        {label}
      </text>
    </>
  );
}

export const PositionLines = memo(function PositionLines({ position, tpsl, dragTpsl, tpslSaving, scaleInOrders, dragScaleIn, splitTps, dragSplitTp, scales, IW, IH }) {
  if (!position || !scales) return null;
  const { yScale } = scales;

  const [hoveredTpSide, setHoveredTpSide]   = useState(null);
  const [hoveredSlSide, setHoveredSlSide]   = useState(null);
  const [hoveredScaleIn, setHoveredScaleIn] = useState(null);
  const [hoveredSplitTp, setHoveredSplitTp] = useState(null);

  const splitTpList = splitTps ?? [];

  // 롱/숏 × TP/SL = 4개의 동일 골격 마커. 호버 상태는 type별로 묶어 단일 setter로 처리
  const tpslMarkers = [
    { side: "LONG",  type: "tp", color: CL, hovered: hoveredTpSide === "LONG",  setHover: setHoveredTpSide, label: "TP" },
    { side: "LONG",  type: "sl", color: CL, hovered: hoveredSlSide === "LONG",  setHover: setHoveredSlSide, label: "SL" },
    { side: "SHORT", type: "tp", color: CS, hovered: hoveredTpSide === "SHORT", setHover: setHoveredTpSide, label: "TP" },
    { side: "SHORT", type: "sl", color: CS, hovered: hoveredSlSide === "SHORT", setHover: setHoveredSlSide, label: "SL" },
  ];

  return (
    <g>
      {/* 진입선 */}
      {position.long  && <EntryLine yPx={yScale(position.long.entryPrice)}  color={CL} label="롱진입" IW={IW} IH={IH} />}
      {position.short && <EntryLine yPx={yScale(position.short.entryPrice)} color={CS} label="숏진입" IW={IW} IH={IH} />}

      {/* 롱/숏 × TP/SL 마커 */}
      {tpslMarkers.map(m => {
        const sideKey    = m.side === "LONG" ? "long" : "short";
        const isDragging = dragTpsl?.type === m.type && dragTpsl?.side === m.side;
        const price      = isDragging ? dragTpsl.price : tpsl[sideKey]?.[m.type]?.price ?? null;
        if (price === null) return null;
        const isActive = m.hovered || isDragging;
        return (
          <PriceLineMarker
            key={`${m.side}-${m.type}`}
            yPx={yScale(price)} color={m.color} IW={IW} IH={IH}
            rightLabelWidth={28} rightLabelText={m.label} handleChar={m.label}
            isActive={isActive} isDragging={isDragging}
            showHandle={!tpslSaving}
            dragCenterText={m.label} dragCenterWidth={40}
            onHandleEnter={() => m.setHover(m.side)}
            onHandleLeave={() => m.setHover(null)}
          />
        );
      })}

      {/* 추가 진입 대기 */}
      {scaleInOrders?.map(o => {
        const isDragging = dragScaleIn?.orderId === o.orderId;
        const price      = isDragging ? dragScaleIn.price : o.price;
        const isActive   = isDragging || hoveredScaleIn === o.orderId;
        const color      = o.side === "BUY" ? CL : CS; // BUY = 롱 추가진입(초록), SELL = 숏 추가진입(빨강)
        return (
          <PriceLineMarker
            key={o.orderId}
            yPx={yScale(price)} color={color} IW={IW} IH={IH}
            rightLabelWidth={52} rightLabelText="추가대기" handleChar="+"
            isActive={isActive} isDragging={isDragging}
            dragCenterText="추가진입" dragCenterWidth={72}
            onHandleEnter={() => setHoveredScaleIn(o.orderId)}
            onHandleLeave={() => setHoveredScaleIn(null)}
          />
        );
      })}

      {/* 분할 TP */}
      {splitTpList.map(o => {
        const isDragging = dragSplitTp?.orderId === o.orderId;
        const price      = isDragging ? dragSplitTp.price : o.price;
        const isActive   = isDragging || hoveredSplitTp === o.orderId;
        const color      = o.side === "SELL" ? CL : CS; // SELL = 롱 청산(초록), BUY = 숏 청산(빨강)
        return (
          <PriceLineMarker
            key={o.orderId}
            yPx={yScale(price)} color={color} IW={IW} IH={IH}
            rightLabelWidth={44} rightLabelText="분할TP" handleChar="TP"
            isActive={isActive} isDragging={isDragging}
            dragCenterText="분할TP" dragCenterWidth={60}
            onHandleEnter={() => setHoveredSplitTp(o.orderId)}
            onHandleLeave={() => setHoveredSplitTp(null)}
          />
        );
      })}
    </g>
  );
});
