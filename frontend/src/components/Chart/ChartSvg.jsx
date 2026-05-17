import { M, VOL_GAP } from "../../constants";
import { useTheme } from "../../ThemeContext";
import { TrendLines }   from "./TrendLines";
import { Channels }     from "./Channels";
import { Circles }      from "./Circles";
import { PositionLines } from "./PositionLines";
import { BoxOverlay, DrawingCurrent, BoxLabels } from "./BoxOverlay";
import { DivergenceLines } from "./DivergenceLines";

export function ChartSvg({
  svgRef,
  containerW, containerH, IW, IH,
  onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onContextMenu, onDoubleClick,
  // 오버레이 데이터 (FVG/OB/SR은 Canvas로 이동)
  scales, candles, divData,
  showRsi, showDiv, rsiH, onDividerMouseDown,
  showVol, volH, onVolDividerMouseDown,
  vLineRef, hLineMainRef, hLineRsiRef, priceTextRef, bodyPctRef,
  hasPos, hasLong, hasShort, position, tpsl, dragTpsl, tpslSaving, scaleInOrders, dragScaleIn, splitTps, dragSplitTp,
  lines, selectedLineId, lineStart, linePreview, isLog,
  drawing, current, locked, selectedBox,
  channels, selectedChannelId, channelStep, channelPoints, channelPreview,
  circles, selectedCircleId, circleCenter, circlePreview,
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
        <clipPath id="rsi-cc"><rect x={0} y={0} width={IW} height={rsiH}/></clipPath>
      </defs>

      {/* React SVG 오버레이 (클립) — 인터랙션 요소만 */}
      <g transform={`translate(${M.left},${M.top})`} clipPath="url(#cc)">
        <Circles circles={circles} selectedCircleId={selectedCircleId}
          circleCenter={circleCenter} circlePreview={circlePreview}
          scales={scales} IW={IW} IH={IH} candles={candles} />
        <Channels channels={channels} selectedChannelId={selectedChannelId}
          channelStep={channelStep} channelPoints={channelPoints} channelPreview={channelPreview}
          scales={scales} IW={IW} IH={IH} candles={candles} isLog={isLog} />
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

      {/* RSI 패널 — canvas로 이전 (App.jsx rsiCanvasRef), SVG에는 다이버전스 라인만 유지 */}
      {showRsi && showDiv && (
        <g transform={`translate(${M.left},${containerH - rsiH})`} clipPath="url(#rsi-cc)">
          <DivergenceLines divData={divData} xScale={scales?.xScale} rsiH={rsiH} />
        </g>
      )}

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
