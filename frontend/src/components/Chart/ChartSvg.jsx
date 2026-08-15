import { M, VOL_GAP } from "../../constants";
import { useTheme } from "../../ThemeContext";
import { TrendLines }   from "./TrendLines";
import { Channels }     from "./Channels";
import { Circles }      from "./Circles";
import { Fibs }         from "./Fibs";
import { Structures }   from "./Structures";
import { PositionLines } from "./PositionLines";
import { BoxOverlay, DrawingCurrent } from "./BoxOverlay";
import { LEG_VOL_METRICS } from "../../chart/legVolume";

// 지그재그 레그 hover 라벨의 거래량 줄 머리말 (상위3 / 평균 / 총량 — legVolume.js [LV9]).
// 공백은 U+00A0 — 일반 공백은 SVG 기본 공백 처리에서 사라진다 (useCrosshair 참고).
//
// 세 줄의 **값 시작 위치를 맞추려면** 머리말 폭이 같아야 한다. 모노스페이스라도 한글은
// 폴백 폰트라 반각 2칸을 차지해서("평균" 4칸 vs "상위3" 5칸) 글자 수로는 안 맞는다.
// → 반각 환산 폭을 재서 가장 넓은 것에 맞춘 뒤, 구분 공백을 하나 더 붙인다.
// ※ 아래에 있던 "테이커"(체결 주체 기준) 줄은 2026-08-13 제거 — legVolume.js [LV5]
const NB = " ";
const halfWidth = s => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
const LABEL_W   = Math.max(...LEG_VOL_METRICS.map(m => halfWidth(m.label)));
const legLabel  = label => label + NB.repeat(LABEL_W - halfWidth(label) + 1);

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
  hasPos, hasLong, hasShort, position, tpsl, dragTpsl, tpslSaving, scaleInOrders, dragScaleIn, splitTps, dragSplitTp, closeConfirm,
  lines, selectedLineId, lineStart, linePreview, isLog,
  drawing, current, locked, selectedBox,
  channels, selectedChannelId, channelStep, channelPoints, channelPreview,
  circles, selectedCircleId, circleCenter, circlePreview,
  fibs, selectedFibId, fibStart, fibPreview, fibLevels,
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
        <Fibs fibs={fibs} selectedFibId={selectedFibId}
          fibStart={fibStart} fibPreview={fibPreview} levels={fibLevels}
          scales={scales} IW={IW} candles={candles} isLog={isLog} />
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
            closeConfirm={closeConfirm}
            scales={scales} candles={candles} IW={IW} IH={IH}
          />
        )}
        <BoxOverlay drawing={drawing} scales={scales} IW={IW} selectedBox={selectedBox} candles={candles} />
        <DrawingCurrent current={current} scales={scales} IW={IW} IH={IH} />
      </g>

      {/* ※ 박스 오른쪽의 가격 라벨(BoxLabels)은 2026-08-14 사용자 요청으로 제거 —
          사이드바 플랜 카드와 중복이었다 (BoxOverlay.jsx 주석 참고) */}

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
            요소가 16개라 ref를 객체 하나(legRefs)에 콜백으로 모은다 (useCrosshair 참고) */}
        <text ref={el => (legRefs.current.pct = el)} display="none" x={0} y={0}
          fontSize={11} fontWeight={700}
          fontFamily="'JetBrains Mono','Fira Code','Courier New',monospace"
          fill="#0ecb81"
          stroke={isDark ? "#0d1117" : "#f9fafb"}
          strokeWidth={3} paintOrder="stroke"
        />
        {/* 오른쪽 세 줄 — 캔들 색 기준 거래량 (상위3봉 평균 / 봉당 평균 / 총량).
            값의 초록/빨강 = 양봉 쪽/음봉 쪽(고정), 증감률 색 = 증가/감소(매번 설정).
            tspan으로 나눠야 색을 달리하면서도 가로 위치가 자동으로 이어진다.
            줄 순서·개수는 LEG_VOL_METRICS 하나가 정한다 — 여기서 따로 늘리지 말 것 */}
        {LEG_VOL_METRICS.map(({ key, label }) => (
          <text key={key} ref={el => (legRefs.current[`${key}Text`] = el)}
            display="none" x={0} y={0}
            fontSize={11} fontWeight={600}
            fontFamily="'JetBrains Mono','Fira Code','Courier New',monospace"
            stroke={isDark ? "#0d1117" : "#f9fafb"}
            strokeWidth={3} paintOrder="stroke"
          >
            <tspan fill={isDark ? "#94a3b8" : "#64748b"}>{legLabel(label)}</tspan>
            <tspan ref={el => (legRefs.current[`${key}Up`]  = el)} fill="#0ecb81" />
            <tspan ref={el => (legRefs.current[`${key}UpD`] = el)} />
            <tspan ref={el => (legRefs.current[`${key}Dn`]  = el)} fill="#f6465d" />
            <tspan ref={el => (legRefs.current[`${key}DnD`] = el)} />
          </text>
        ))}
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
