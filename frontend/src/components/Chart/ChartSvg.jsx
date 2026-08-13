import { M, VOL_GAP } from "../../constants";
import { useTheme } from "../../ThemeContext";
import { TrendLines }   from "./TrendLines";
import { Channels }     from "./Channels";
import { Circles }      from "./Circles";
import { Structures }   from "./Structures";
import { PositionLines } from "./PositionLines";
import { BoxOverlay, DrawingCurrent, BoxLabels } from "./BoxOverlay";

// 지그재그 레그 hover 라벨의 거래량 줄 머리말. 공백은 U+00A0 —
// 일반 공백은 SVG 기본 공백 처리에서 사라진다 (useCrosshair 참고).
// ※ 아래에 있던 "테이커"(체결 주체 기준) 줄은 2026-08-13 제거 — legVolume.js [LV5]
const LEG_VOL_LABEL = "피크 ";

export function ChartSvg({
  svgRef,
  containerW, containerH, IW, IH,
  onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onContextMenu, onDoubleClick,
  // 오버레이 데이터 (FVG/OB/SR은 Canvas로 이동)
  scales, candles, candlesRef,
  showRsi, rsiH, onDividerMouseDown,
  showVol, volH, onVolDividerMouseDown,
  vLineRef, hLineMainRef, hLineRsiRef, priceTextRef, bodyPctRef,
  legRefs,
  hasPos, hasLong, hasShort, position, tpsl, dragTpsl, tpslSaving, scaleInOrders, dragScaleIn, splitTps, dragSplitTp,
  lines, selectedLineId, lineStart, linePreview, isLog,
  drawing, current, locked, selectedBox,
  channels, selectedChannelId, channelStep, channelPoints, channelPreview,
  circles, selectedCircleId, circleCenter, circlePreview,
  structures, selectedStructId, structPart, structDraft, structPreview,
}) {
  const { isDark } = useTheme();
  const crosshairColor = isDark ? "#d1d5db" : "#374151";

  return (
    <svg ref={svgRef} width={containerW} height={containerH}
      style={{ position:"absolute", top:0, left:0, display:"block", cursor: "none", userSelect:"none", zIndex:1 }}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave} onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}>

      <defs>
        <clipPath id="cc"><rect x={0} y={0} width={IW} height={IH}/></clipPath>
      </defs>

      {/* React SVG 오버레이 (클립) — 인터랙션 요소만 */}
      <g transform={`translate(${M.left},${M.top})`} clipPath="url(#cc)">
        <Circles circles={circles} selectedCircleId={selectedCircleId}
          circleCenter={circleCenter} circlePreview={circlePreview}
          scales={scales} IW={IW} IH={IH} candles={candles} />
        <Channels channels={channels} selectedChannelId={selectedChannelId}
          channelStep={channelStep} channelPoints={channelPoints} channelPreview={channelPreview}
          scales={scales} IW={IW} IH={IH} candles={candles} isLog={isLog} />
        <Structures structures={structures} selectedStructId={selectedStructId} structPart={structPart}
          structDraft={structDraft} structPreview={structPreview}
          scales={scales} candles={candles} candlesRef={candlesRef} IW={IW} />
        <TrendLines lines={lines} selectedLineId={selectedLineId}
          lineStart={lineStart} linePreview={linePreview}
          scales={scales} IW={IW} IH={IH} isLog={isLog} candles={candles} />
        {hasPos && (
          <PositionLines
            position={position} tpsl={tpsl} dragTpsl={dragTpsl}
            tpslSaving={tpslSaving} scaleInOrders={scaleInOrders} dragScaleIn={dragScaleIn}
            splitTps={splitTps} dragSplitTp={dragSplitTp}
            scales={scales} IW={IW} IH={IH}
          />
        )}
        <BoxOverlay drawing={drawing} scales={scales} IW={IW} hasLong={hasLong} hasShort={hasShort} selectedBox={selectedBox} candles={candles} />
        <DrawingCurrent current={current} scales={scales} IW={IW} IH={IH} />
      </g>

      {/* 라벨 (클립 밖) */}
      <g transform={`translate(${M.left},${M.top})`}>
        <BoxLabels drawing={drawing} scales={scales} IW={IW} candles={candles} />
      </g>

      {/* RSI 패널은 전부 canvas (ChartArea rsiCanvasRef) — SVG 오버레이 없음 */}

      {/* 크로스헤어 (ref 기반 imperative 업데이트 — React 리렌더 없음) */}
      <g style={{ pointerEvents: "none" }}>
        <line ref={vLineRef}     display="none" stroke={crosshairColor} strokeWidth={0.5} strokeDasharray="3,3" opacity={0.7} x1={0} x2={0} y1={0} y2={0} />
        <line ref={hLineMainRef} display="none" stroke={crosshairColor} strokeWidth={0.5} strokeDasharray="3,3" opacity={0.7} x1={0} x2={0} y1={0} y2={0} />
        <line ref={hLineRsiRef}  display="none" stroke={crosshairColor} strokeWidth={0.5} strokeDasharray="3,3" opacity={0.7} x1={0} x2={0} y1={0} y2={0} />
        <text ref={priceTextRef} display="none" x={0} y={0}
          fontSize={13} fontWeight={600}
          fontFamily="'JetBrains Mono','Fira Code','Courier New',monospace"
          fill={crosshairColor}
          stroke={isDark ? "#0d1117" : "#f9fafb"}
          strokeWidth={3} paintOrder="stroke"
        />
        <text ref={bodyPctRef} display="none" x={0} y={0}
          fontSize={13} fontWeight={600}
          fontFamily="'JetBrains Mono','Fira Code','Courier New',monospace"
          fill="#0ecb81"
          stroke={isDark ? "#0d1117" : "#f9fafb"}
          strokeWidth={3} paintOrder="stroke"
        />
        {/* 지그재그 레그 hover 라벨 — 캔들 등락률(bodyPct)보다 작게, 한 줄 아래.
            요소가 11개라 ref를 객체 하나(legRefs)에 콜백으로 모은다 (useCrosshair 참고) */}
        <text ref={el => (legRefs.current.pct = el)} display="none" x={0} y={0}
          fontSize={11} fontWeight={700}
          fontFamily="'JetBrains Mono','Fira Code','Courier New',monospace"
          fill="#0ecb81"
          stroke={isDark ? "#0d1117" : "#f9fafb"}
          strokeWidth={3} paintOrder="stroke"
        />
        {/* 오른쪽 한 줄 — 캔들 색 기준 피크 거래량.
            값의 초록/빨강 = 양봉 쪽/음봉 쪽(고정), 증감률 색 = 증가/감소(매번 설정).
            tspan으로 나눠야 색을 달리하면서도 가로 위치가 자동으로 이어진다 */}
        <text ref={el => (legRefs.current.volText = el)}
          display="none" x={0} y={0}
          fontSize={11} fontWeight={600}
          fontFamily="'JetBrains Mono','Fira Code','Courier New',monospace"
          stroke={isDark ? "#0d1117" : "#f9fafb"}
          strokeWidth={3} paintOrder="stroke"
        >
          <tspan fill={isDark ? "#94a3b8" : "#64748b"}>{LEG_VOL_LABEL}</tspan>
          <tspan ref={el => (legRefs.current.volUp  = el)} fill="#0ecb81" />
          <tspan ref={el => (legRefs.current.volUpD = el)} />
          <tspan ref={el => (legRefs.current.volDn  = el)} fill="#f6465d" />
          <tspan ref={el => (legRefs.current.volDnD = el)} />
        </text>
      </g>

      {/* 거래량 구분선 드래그 히트 영역 */}
      {showVol && (
        <rect
          x={M.left} y={containerH - (showRsi ? rsiH + VOL_GAP : 0) - volH - 4}
          width={IW} height={8}
          fill="transparent"
          style={{ cursor: "row-resize" }}
          onMouseDown={onVolDividerMouseDown}
        />
      )}

      {/* RSI 구분선 드래그 히트 영역 */}
      {showRsi && (
        <rect
          x={M.left} y={containerH - rsiH - 4}
          width={IW} height={8}
          fill="transparent"
          style={{ cursor: "row-resize" }}
          onMouseDown={onDividerMouseDown}
        />
      )}
    </svg>
  );
}
