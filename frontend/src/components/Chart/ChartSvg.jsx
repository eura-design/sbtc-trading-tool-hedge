import { M, VOL_GAP } from "../../constants";
import { useTheme } from "../../ThemeContext";
import { TrendLines }   from "./TrendLines";
import { Channels }     from "./Channels";
import { Circles }      from "./Circles";
import { Fibs }         from "./Fibs";
import { Measures }     from "./Measures";
import { Structures }   from "./Structures";
import { PositionLines } from "./PositionLines";
import { BoxOverlay, DrawingCurrent } from "./BoxOverlay";
import { LEG_VOL_METRICS } from "../../chart/legVolume";
// 레그 등락률 글자 크기 — 거래량 줄의 x 계산에도 쓰이므로 **한 곳에서 가져온다**
// (여기서 숫자를 다시 적으면 라벨과 거래량 줄이 겹친다 — useCrosshair의 rowX)
import { LEG_PCT_FS } from "../../hooks/useCrosshair";

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
  vLineRef, hLineMainRef, hLineRsiRef, bodyPctRef,
  legRefs, axisTagRefs,
  hasPos, hasLong, hasShort, position, tpsl, dragTpsl, tpslSaving, scaleInOrders, dragScaleIn, splitTps, dragSplitTp, partialSls, dragPartialSl, closeConfirm,
  lines, selectedLineId, lineStart, linePreview, isLog,
  drawings, current, locked, selectedBox,
  channels, selectedChannelId, channelStep, channelPoints, channelPreview,
  circles, selectedCircleId, circleCenter, circlePreview,
  fibs, selectedFibId, fibStart, fibPreview,
  measures, selectedMeasureId, measureDraft,
  structures, selectedStructId, structPart, structDraft, structPreview,
}) {
  const { isDark } = useTheme();
  const crosshairColor = isDark ? "#d1d5db" : "#374151";
  // 축 태그(알약)는 **크로스헤어 선과 같은 색을 배경으로** 깔고 글자를 패널 배경색으로
  // 뒤집는다. 두 색 다 이미 이 파일이 쓰던 것이라(선 색 / 글자 테두리 색) 새 토큰이 없고,
  // 다크·라이트 어느 쪽에서도 축 눈금 위에서 또렷하다
  const tagTextColor = isDark ? "#0d1117" : "#f9fafb";

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
        {/* 레벨 목록은 도형마다 다르다 — Fibs가 fibLevelsOf(fb)로 직접 읽는다 ([F1]) */}
        <Fibs fibs={fibs} selectedFibId={selectedFibId}
          fibStart={fibStart} fibPreview={fibPreview}
          scales={scales} IW={IW} candles={candles} isLog={isLog} />
        {/* 측정 박스 — 값을 읽는 도형이라 다른 도형 **위**에 온다 (글자가 가려지면 쓸모가 없다).
            지그재그·구조보다 뒤에 그려 겹쳐도 숫자가 보이게 한다 */}
        <Measures measures={measures} selectedMeasureId={selectedMeasureId}
          measureDraft={measureDraft}
          scales={scales} IW={IW} IH={IH} candles={candles} />
        <Structures structures={structures} selectedStructId={selectedStructId} structPart={structPart}
          structDraft={structDraft} structPreview={structPreview}
          scales={scales} candles={candles} candlesRef={candlesRef} IW={IW} />
        <TrendLines lines={lines} selectedLineId={selectedLineId}
          lineStart={lineStart} linePreview={linePreview}
          scales={scales} IW={IW} IH={IH} isLog={isLog} candles={candles} />
        {/* ⚠ hasPos만 보면 안 된다 — **포지션이 없어도 미체결 진입 주문의 대기선**을
            그려야 한다 (2026-08-23). 이 컴포넌트가 그리는 것 중 유일하게
            포지션과 무관한 항목이다 */}
        {(hasPos || position?.pending?.long || position?.pending?.short) && (
          <PositionLines
            position={position} tpsl={tpsl} dragTpsl={dragTpsl}
            tpslSaving={tpslSaving} scaleInOrders={scaleInOrders} dragScaleIn={dragScaleIn}
            splitTps={splitTps} dragSplitTp={dragSplitTp}
            partialSls={partialSls} dragPartialSl={dragPartialSl}
            closeConfirm={closeConfirm} drawings={drawings}
            scales={scales} candles={candles} IW={IW} IH={IH}
          />
        )}
        {/* 플랜 박스는 **롱·숏 각각 하나**다 (2026-08-19).
            ⚠ 그리는 순서를 히트 판정(hitDetection의 `boxOrder`)과 **같게 유지할 것**:
              선택된 박스가 맨 위 · 아니면 롱이 위. 어긋나면 겹친 자리에서
              "위에 보이는 박스를 눌렀는데 아래 것이 잡힌다"가 된다 */}
        {/* 히트 순서가 [선택, 롱, 숏]이므로 그리는 순서는 그 **역순**이다 (뒤에 그린 게 위) */}
        {(selectedBox === "short" ? ["long", "short"] : ["short", "long"]).map(k => (
          <BoxOverlay key={k} drawing={drawings?.[k]} scales={scales} IW={IW}
            selected={selectedBox === k} candles={candles} />
        ))}
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
        {/* 축 위의 태그 — 가격은 **오른쪽 가격축**, 시각은 **아래 날짜축**
            (2026-08-24 사용자 요청, 트레이딩뷰와 같은 자리).
            ⚠ 커서 옆에 떠 있던 가격 라벨(`62.9k`)은 이때 제거됐다 — 되살리지 말 것.
              축 눈금과 나란히 있어야 견주기 쉽고, 커서 옆 라벨은 보려던 캔들을 가렸다.
            ⚠ 클립(`#cc`) **바깥**에 있어야 한다 — 태그는 차트 안쪽(IW×IH)이 아니라
              여백(M.right / M.bottom)에 그려지므로 클립 안에 넣으면 통째로 잘린다.
            좌표·글자는 전부 useCrosshair가 imperative로 채운다 (React 리렌더 없음) */}
        <rect ref={el => (axisTagRefs.current.priceBg = el)} display="none"
          x={0} y={0} width={0} height={0} rx={2} fill={crosshairColor} />
        <text ref={el => (axisTagRefs.current.priceText = el)} display="none" x={0} y={0}
          fontSize={12} fontWeight={600} dominantBaseline="central"
          fontFamily="'JetBrains Mono','Fira Code','Courier New',monospace"
          fill={tagTextColor}
        />
        <rect ref={el => (axisTagRefs.current.timeBg = el)} display="none"
          x={0} y={0} width={0} height={0} rx={2} fill={crosshairColor} />
        <text ref={el => (axisTagRefs.current.timeText = el)} display="none" x={0} y={0}
          fontSize={12} fontWeight={600} textAnchor="middle" dominantBaseline="central"
          fontFamily="'JetBrains Mono','Fira Code','Courier New',monospace"
          fill={tagTextColor}
        />
        <text ref={bodyPctRef} display="none" x={0} y={0}
          fontSize={13} fontWeight={600}
          fontFamily="'JetBrains Mono','Fira Code','Courier New',monospace"
          fill="#0ecb81"
          stroke={isDark ? "#0d1117" : "#f9fafb"}
          strokeWidth={3} paintOrder="stroke"
        />
        {/* 지그재그 레그 hover 라벨 — 캔들 등락률(bodyPct) **한 줄 아래**.
            등락률(%) 글자는 그 캔들 등락률과 **같은 크기**다 (2026-08-24 사용자 요청) —
            같은 `%`인데 크기가 달랐고, 둘은 줄이 나뉘어 있어 크기로 구분할 필요가 없다.
            거래량 세 줄은 그대로 11px — 저건 성격이 다른 값이고 줄 수도 많다.
            요소가 16개라 ref를 객체 하나(legRefs)에 콜백으로 모은다 (useCrosshair 참고) */}
        <text ref={el => (legRefs.current.pct = el)} display="none" x={0} y={0}
          fontSize={LEG_PCT_FS} fontWeight={700}
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
