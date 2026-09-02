import { memo, useState } from "react";
import { PALETTE } from "../../constants";
import { posEntryRows, TPSL_BTN, closeBtnRect, qtyBadgeRect, pctBadgeRect, pendingEntryLines }
  from "../../chart/hitDetection";
import { tsToIdx } from "../../chart/scales";
import { entryPathSegments } from "../../chart/entryPath";
import { fmtQty as qtyFmt } from "../../utils/qty";
import { useStore } from "../../store";

function inView(px, IH) { return px !== null && px >= -20 && px <= IH + 20; }

const CL = PALETTE.long;  // LONG 계열 (초록)
const CS = PALETTE.short; // SHORT 계열 (빨강)
// 강제청산선 — **사이드바 포지션 카드의 `청산가`와 같은 색**(PositionCard.jsx).
// PALETTE.short(#f6465d)를 쓰지 않는 이유: 그건 "숏"이라는 뜻이라 롱 포지션의
// 청산선에 쓰면 사이드 색으로 읽힌다. 청산은 롱·숏 공통의 **위험** 표시다
const C_LIQ = "#ff4444";

// 버튼 면의 기본 진하기. 진입선 라벨과 TP/SL 핸들이 **같은 값을 봐야** 나란히 놓였을 때
// 한쪽만 더 진해 보이지 않는다 (2026-08-15: 라벨만 0.9라 유독 진하다는 지적으로 통일)
const BTN_REST_OPACITY = 0.7;

// 좌측 버튼 공통 모양 (2026-08-15).
//
// ⚠ **크기·가로 위치를 `TPSL_BTN`에서 가져온다.** 기존 TP/SL 핸들과 신규 등록용
//   `+TP`/`+SL`이 같은 레인에 세로로 정렬돼야 한 종류의 컨트롤로 읽힌다.
//   여기만 리터럴로 바꾸면 같은 줄에 크기가 다른 버튼 두 개가 생긴다.
// ※ 예전엔 삼각형(▶) + 옆 글자였다. 사용자 요청으로 버튼으로 통일했다 —
//   되돌리려면 아래 네 종류(TP/SL/추가대기/분할TP)를 **같이** 바꿀 것
function MarkerButton({ x, y, color, text, opacity, onEnter, onLeave, draggable = true, children }) {
  return (
    <g style={{ cursor: draggable ? "ns-resize" : "default" }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
      <rect x={x} y={y} width={TPSL_BTN.w} height={TPSL_BTN.h} rx={3}
        fill="#0b1120" stroke={color} strokeWidth={1} opacity={opacity} />
      <text x={x + TPSL_BTN.w / 2} y={y + TPSL_BTN.h / 2 + 3.5} fill={color}
        fontSize={9.5} fontWeight="700" textAnchor="middle"
        opacity={opacity} style={{ pointerEvents: "none" }}>
        {text}
      </text>
    </g>
  );
}

// 수량 배지 — `0.173` (2026-08-22 사용자 요청).
//
// ⚠ **마커 버튼을 늘리지 않고 옆에 따로 붙인다** (사용자 확정: "버튼 크기는 지금이 좋다").
//   버튼 안에 수량을 넣으려면 폭이 28 → 60px가 되어 `TP`/`SL`/`추가`/`분할`이 전부 커진다
// ⚠ 모양은 MarkerButton과 **같은 규칙**(어두운 면 + 사이드 색 테두리·글자)이지만
//   **누를 수 없다** — 표시 전용이라 커서도 바꾸지 않고 클릭도 받지 않는다
// ⚠ 좌표는 hitDetection이 준다 (qtyBadgeRect / row.qty) — 여기서 만들지 말 것
function QtyBadge({ rect, color, text }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={3}
        fill="#0b1120" stroke={color} strokeWidth={1} opacity={BTN_REST_OPACITY} />
      <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + 3.5} fill={color}
        fontSize={9.5} fontWeight="700" textAnchor="middle" opacity={BTN_REST_OPACITY}>
        {text}
      </text>
    </g>
  );
}

// 수량 표기는 **BTC 수량 하나로 통일**한다 (2026-08-22 사용자 확정 — USD 명목가 대신).
// ⚠ USD로 바꾸지 말 것: 현재가 기준이면 **틱마다** 값이 바뀌어 PositionLines가 매 틱
//   리렌더된다(지금은 포지션이 바뀔 때만 돈다). 자릿수는 QTY_STEP(0.001)에 맞춘 3자리
// ⚠ **단위 글자는 붙이지 않는다 — 숫자만이다** (2026-08-22 사용자 요청).
//   매 배지마다 같은 글자가 반복될 뿐인데 그 세 글자가 배지 폭의 절반을 먹었다(60 → 36px).
//   심볼이 여러 개가 된 지금도 그대로 둔다 — 어느 코인인지는 상단바가 늘 보여준다
// ⚠ **1 미만이면 앞의 `0`을 뗀다** (`0.001` → `.001`, 2026-08-27 사용자 요청).
//   1 이상은 그대로다(`1.001`) — 그쪽은 뗄 정수부가 실제로 있다.
//   ⚠ 자릿수는 **심볼의 수량 단위**를 따른다 (2026-09-02) — 0.001 고정이면
//     DOGE(단위 1)에서 `123.000`이 된다
const fmtQtyBadge = (q, step) => qtyFmt(q, step).replace(/^0\./, ".");

// `추가`/`분할`이 포지션 전체의 몇 %인가 (2026-08-22 사용자 요청).
//
// ⚠ **지금 포지션 크기로 그때그때 계산한다** — 등록 시점에 저장해 둔 `pct`(사이드바
//   분할 TP 목록의 `(40%)`)를 쓰지 않는다. 저 값은 등록 당시의 비율이라 **추가 진입으로
//   포지션이 커지면 낡는다**(0.009 BTC를 5%로 걸어 둔 뒤 포지션이 두 배가 되면 실제론 2.6%인데
//   저장값은 5% 그대로다). 바로 옆에 수량이 같이 떠 있으므로 두 숫자가 어긋나면 안 된다
// ⚠ 포지션이 없으면 null — 나눌 수가 없다 (0%로 찍으면 "없다"는 뜻으로 읽힌다)
// ⚠ **`%` 글자는 붙이지 않는다 — 숫자만이다** (2026-08-27 사용자 요청).
//   `BTC`를 뗀 것과 같은 이유다: 이 배지는 늘 비율만 담아서 매 배지마다 같은 글자가
//   반복될 뿐인데, 그 한 글자가 배지 폭을 그만큼 넓혔다 (PCT_BADGE 28 → 24).
//   무엇의 숫자인지는 **자리**가 말한다 — 바로 왼쪽이 수량 배지다
// 1% 미만은 `<1` — 반올림하면 `0`이 되어 수량이 0인 것처럼 보인다
function fmtPct(qty, size) {
  if (!size || !(size > 0)) return null;
  const pct = (Number(qty) / size) * 100;
  return pct < 1 ? "<1" : `${Math.round(pct)}`;
}

// 마커 옆 `×` — 눌러서 지운다. 모양은 MarkerButton과 같은 규칙이고 폭만 좁다.
// ⚠ 사각형은 hitDetection이 준 값을 그대로 쓴다 (직접 계산 금지 — 클릭 판정과 어긋난다)
// confirm=true면 청산 확인 대기 상태 → `✓`로 바뀌고 호박색이 된다
function CloseButton({ rect, color, hovered, confirm, onEnter, onLeave }) {
  const c  = confirm ? "#fbbf24" : color;
  const op = confirm ? 1 : (hovered ? 1 : BTN_REST_OPACITY);
  return (
    <g style={{ cursor: "pointer" }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={3}
        fill="#0b1120" stroke={c} strokeWidth={1} opacity={op} />
      <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + 3.5} fill={c}
        fontSize={confirm ? 9.5 : 11} fontWeight="700" textAnchor="middle"
        opacity={op} style={{ pointerEvents: "none" }}>
        {confirm ? "✓" : "×"}
      </text>
    </g>
  );
}

// 좌측 핸들 + 우측 라벨 + 가로선으로 구성된 가격 마커.
// TP/SL, 추가진입 대기, 분할TP 마커가 모두 동일 골격을 공유한다.
// ⚠ **우측 라벨은 없다** (2026-08-15 사용자 요청). 예전엔 오른쪽 끝에 `TP`/`SL`/
//   `추가대기`/`분할TP` 배지가 붙었는데, 왼쪽 버튼이 이미 같은 말을 하고 있어 지웠다.
//   되살리려면 네 종류를 같이 — 하나만 두면 그 줄만 라벨이 있다.
//   ※ 진입선(EntryLine)의 라벨은 남아 있다. 저긴 왼쪽에 버튼이 없어서 유일한 표시다
function PriceLineMarker({
  yPx, color, IW, IH,
  handleChar,
  isActive, isDragging,
  showHandle = true,
  // 대기선 전용 — 항상 보이는 점선. 나머지 마커는 호버할 때만 가로선이 뜬다
  // (버튼이 이미 가격을 짚어주므로). 대기선은 그 사이드에 다른 표시가 없어서 선이 곧 표시다
  dashed = false, draggable = true,
  qtyText, pctText,
  dragCenterText, dragCenterWidth = 40,
  onHandleEnter, onHandleLeave,
  closeHovered, onCloseEnter, onCloseLeave,
}) {
  if (!inView(yPx, IH)) return null;
  // ⚠ 점선(=미체결)은 **쉬는 중에도 보인다**(0.35). 이 앱에서 점선은 "아직 확정 아님"의
  //   뜻이고 미체결 주문이 정확히 그것이다 (진입선의 세로 단차·알림 ON 도형과 같은 규칙)
  const lineOpacity  = isActive ? (isDragging ? 1 : 0.8) : (dashed ? 0.35 : 0);
  return (
    <g>
      {/* ⚠ 굵기는 **항상 1**이다 (2026-08-15 사용자 요청). 예전엔 호버·드래그 때 2였는데
          바로 옆 진입선(EntryLine)이 1이라 유독 굵어 보였다.
          "지금 이 선을 만지고 있다"는 표시는 **투명도**가 한다 (0 → 0.8 → 드래그 1) */}
      <line x1={0} x2={IW} y1={yPx} y2={yPx}
        stroke={color} strokeWidth={1} opacity={lineOpacity}
        strokeDasharray={dashed ? "4,3" : undefined} />
      {showHandle && (
        // 버튼은 보이는 표시일 뿐 — 잡히는 범위는 예전 그대로 **왼쪽 60px 전체**다
        // (hitDetection의 `pos.x >= 0 && pos.x <= 60`와 같은 값). 버튼 크기로 좁히면
        // 잡기가 더 어려워진다 — 모양만 바꾼 것이지 조작성은 그대로다
        <MarkerButton
          x={TPSL_BTN.x0} y={yPx - TPSL_BTN.h / 2}
          color={color} text={handleChar}
          opacity={isActive ? 1 : BTN_REST_OPACITY}
          onEnter={onHandleEnter} onLeave={onHandleLeave}
          draggable={draggable}
        >
          {/* 끌 수 없는 마커(대기선)엔 이 판정 사각형을 두지 않는다 —
              깔아 두면 잡히지도 않는 자리에서 커서만 ns-resize로 바뀐다 */}
          {draggable && <rect x={0} y={yPx-10} width={60} height={20} fill="transparent" />}
        </MarkerButton>
      )}
      {/* ⚠ 끄는 중에는 × 를 감춘다. 클릭 판정(markerCloseButtons)은 **저장된 가격** 기준이라
          끌려가는 선을 따라가지 않는다 — 보이는 자리와 눌리는 자리가 어긋난다 */}
      {showHandle && !isDragging && (
        <CloseButton rect={closeBtnRect(yPx)} color={color}
          hovered={closeHovered} onEnter={onCloseEnter} onLeave={onCloseLeave} />
      )}
      {/* 수량 배지 — 끄는 중에는 `×`와 같이 감춘다. 그때 값은 가운데 라벨이 말해준다 */}
      {showHandle && !isDragging && qtyText && (
        <QtyBadge rect={qtyBadgeRect(yPx)} color={color} text={qtyText} />
      )}
      {/* 비율 배지 — 수량 배지 오른쪽. `추가`/`분할`에만 붙는다 (TP/SL·진입은 늘 전량이다) */}
      {showHandle && !isDragging && qtyText && pctText && (
        <QtyBadge rect={pctBadgeRect(yPx)} color={color} text={pctText} />
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

// 진입선 옆의 `+TP` / `+SL` — 그 항목이 **없을 때만** 뜬다.
// 잡고 위아래로 끌면 놓은 가격에 새로 등록된다 (드래그 자체는 pos_tp/pos_sl 핸들러가 처리).
//
// ⚠ 좌표를 여기서 만들지 말 것 — hitDetection의 posEntryRows가 유일한 출처다.
//   따로 계산하면 보이는 자리와 잡히는 자리가 어긋난다
// ⚠ **클릭만으로는 아무 일도 일어나지 않는다(의도).** 실주문이 나가는 동작이라
//   "기본 거리에 자동 생성"은 넣지 않았다 — 오클릭 한 번이 곧 주문이 된다
function AddTpSlButton({ btn, color, hovered, onEnter, onLeave }) {
  return (
    <MarkerButton
      x={btn.x} y={btn.y} color={color}
      text={`+${btn.type.toUpperCase()}`}
      // 아직 주문이 아니라서 기존 핸들(0.7)보다 흐리게 둔다 — "걸린 것"과 "걸 수 있는 것"의 구분
      opacity={hovered ? 1 : 0.45}
      onEnter={onEnter} onLeave={onLeave}
    />
  );
}

// 진입선의 우측 라벨 — 여기만 남는다. 진입선은 왼쪽에 버튼이 없어서 유일한 표시다.
// 모양은 MarkerButton과 같은 규칙(어두운 면 + 사이드 색 테두리·글자, 높이 TPSL_BTN.h)이지만
// **누를 수 없다** — 진입선은 드래그 대상이 아니라 커서도 바꾸지 않는다
//
/**
 * 강제청산선 (2026-08-24 사용자 요청) — **빨간 점선 + 은은한 글로우**.
 *
 * 스타일 기준은 **알림 켠 추세선**이다 (호박색 점선 + 글로우, TrendLines.jsx).
 * 색만 빨강으로 바꿨다: 이 앱에서 그 모양은 "여기 닿으면 무슨 일이 난다"는 뜻이고,
 * 청산선이 정확히 그 뜻이다.
 *
 * ⚠ **오른쪽 끝은 마지막 봉까지**다 (2026-08-24 사용자 요청) — 차트 오른쪽 끝(IW)까지
 *   늘이면 아직 오지 않은 구간에도 선이 깔린다. FVG·오더블록 박스와 같은 이유·같은 계산이다.
 *   ※ 진입선은 여전히 IW까지 간다 (사용자가 청산선만 지정했다)
 *
 * ⚠ **왼쪽 끝은 진입선과 같은 자리**다. 청산가는 포지션이 생긴 뒤에만 뜻이 있는 값이라,
 *   진입 전 구간까지 그으면 그 자리에 의미 없는 선이 깔린다. 그래서 좌표를 따로
 *   만들지 않고 **진입선이 쓴 첫 가로 구간의 x1을 그대로 가져온다**(entryPathSegments) —
 *   각자 계산하면 두 선의 시작점이 어긋난다.
 *
 * ⚠ **라벨도 × 버튼도 없다** (같은 날 사용자 확정). 이건 주문이 아니라 거래소가 계산한
 *   값이라 끌 수도, 지울 수도 없다 — 마커를 붙이면 조작할 수 있는 것처럼 보인다.
 *   숫자는 사이드바 포지션 카드의 `청산가`가 이미 보여준다.
 *
 * ⚠ 화면 밖으로 벗어나면 **저절로 잘린다** — ChartSvg가 이 레이어를 클립(`#cc`)한다.
 *   레버리지가 낮으면 청산가가 화면 밖인 게 정상이다 (5배면 약 20% 떨어진 곳).
 */
function LiqLine({ yPx, x1, x2 }) {
  if (!Number.isFinite(yPx) || !(x2 > x1)) return null;
  return (
    <>
      {/* 글로우 — 알림 추세선과 같은 값(굵기 6 / 투명도 0.18) */}
      <line x1={x1} x2={x2} y1={yPx} y2={yPx}
        stroke={C_LIQ} strokeWidth={6} opacity={0.18} />
      <line x1={x1} x2={x2} y1={yPx} y2={yPx}
        stroke={C_LIQ} strokeWidth={1.5} opacity={0.9} strokeDasharray="6,3" />
    </>
  );
}

// ⚠ `row`(hitDetection.posEntryRows)가 라벨·×·수량 배지 자리를 전부 정한다 —
//   `+TP`/`+SL`도 같은 행에서 나온다. 여기서 좌표를 만들면 그 넷이 따로 논다.
//   오른쪽 여백은 왼쪽 버튼과 **같은 값**(TPSL_BTN.x0) — 양끝이 대칭으로 보이게
function EntryLine({ yPx, color, label, row, qtyText, IH, path, confirm, closeHovered, onCloseEnter, onCloseLeave }) {
  if (!inView(yPx, IH) || !row) return null;
  return (
    <>
      {/* 진입선 — 진입봉부터 오른쪽 끝까지. 추가 매수로 평단이 바뀐 지점에서 꺾인다.
          ⚠ **세로 단차는 점선 + 더 흐리게** 그린다 (2026-08-15). 가로선과 똑같이 그리면
            캔들 심지로 읽힌다 — 진입선 색이 캔들 색과 같은 계열이라 특히 그렇다.
            심지는 실선이므로 점선이면 한눈에 갈린다. 자세한 근거는 chart/entryPath.js */}
      {path.h.map((s, k) => (
        <line key={`h${k}`} x1={s.x1} x2={s.x2} y1={s.y} y2={s.y}
          stroke={color} strokeWidth={1} opacity={0.7} />
      ))}
      {path.v.map((s, k) => (
        <line key={`v${k}`} x1={s.x} x2={s.x} y1={s.y1} y2={s.y2}
          stroke={color} strokeWidth={1} opacity={0.35} strokeDasharray="2,2" />
      ))}
      {/* 수량 배지 — **TP·SL이 둘 다 없을 때만** 뜬다 (2026-08-22 사용자 확정).
          하나라도 걸려 있으면 그 좌측 마커가 같은 숫자를 들고 있어 두 번 보인다
          (단일 TP/SL은 closePosition이라 대상 수량 = 포지션 전체) */}
      {row.qty && qtyText && <QtyBadge rect={row.qty} color={color} text={qtyText} />}
      {/* × 는 라벨 **왼쪽**에 — 오른쪽은 여백뿐이라 자리가 없다.
          한 번 누르면 ✓(호박색)로 바뀌고, 그 상태에서 다시 눌러야 시장가 청산이 나간다 */}
      <CloseButton rect={row.close} color={color} confirm={confirm}
        hovered={closeHovered} onEnter={onCloseEnter} onLeave={onCloseLeave} />
      <rect x={row.label.x} y={row.label.y} width={row.label.w} height={row.label.h} rx={3}
        fill="#0b1120" stroke={color} strokeWidth={1} opacity={BTN_REST_OPACITY} />
      {/* ⚠ 진입선 라벨만 **굵지 않다**(400, 2026-08-15 사용자 요청).
          나머지 버튼(TP/SL/추가/분할/+TP)은 700 그대로 — 저건 누르는 것이고 이건 표시다 */}
      <text x={row.label.x + row.label.w / 2} y={row.label.y + row.label.h / 2 + 3.5} fill={color}
        fontSize={9.5} fontWeight="400" textAnchor="middle">
        {label}
      </text>
    </>
  );
}

export const PositionLines = memo(function PositionLines({ position, tpsl, dragTpsl, tpslSaving, scaleInOrders, dragScaleIn, splitTps, dragSplitTp, partialSls, dragPartialSl, closeConfirm, drawings, scales, candles, IW, IH }) {
  // 배지 수량의 자릿수는 심볼의 수량 단위를 따른다 (DOGE는 1이라 소수가 없다)
  const qStep = useStore(s => s.symbolFilters.step);
  if (!position || !scales) return null;
  const { yScale, xScale } = scales;

  const [hoveredTpSide, setHoveredTpSide]   = useState(null);
  const [hoveredSlSide, setHoveredSlSide]   = useState(null);
  const [hoveredScaleIn, setHoveredScaleIn] = useState(null);
  const [hoveredSplitTp, setHoveredSplitTp] = useState(null);
  const [hoveredPartialSl, setHoveredPartialSl] = useState(null);
  const [hoveredPending, setHoveredPending] = useState(null);
  const [hoveredAddBtn, setHoveredAddBtn]   = useState(null);
  // × 버튼 호버는 한 곳에 모은다 — 화면에 한 번에 하나만 호버되므로 키 하나면 충분하다
  const [hoveredClose, setHoveredClose]     = useState(null);
  const closeProps = (key) => ({
    closeHovered: hoveredClose === key,
    onCloseEnter: () => setHoveredClose(key),
    onCloseLeave: () => setHoveredClose(null),
  });

  const splitTpList   = splitTps ?? [];
  const partialSlList = partialSls ?? [];

  // 진입 시각 → 그 봉의 **왼쪽 가장자리** x. 봉 한가운데(fractional idx)가 아니라
  // 가장자리로 맞춰야 "이 봉에서 들어갔다"가 캔들과 나란히 읽힌다
  // (FVG/OB 박스가 봉 절반을 더해 오른쪽 끝에 맞추는 것과 같은 계산).
  // 화면 밖이면 0~IW로 클램프 — 잘린 구간의 보이는 부분은 그대로 그려진다
  const entryX = (t) => {
    if (!t || !candles?.length || !xScale) return 0;
    const px = xScale(Math.floor(tsToIdx(t, candles)) - 0.5);
    return Math.min(Math.max(px, 0), IW);
  };

  // 진입선 좌표 — **계단**이다 (2026-08-15 사용자 지적으로 직선에서 바뀜).
  // 계산은 chart/entryPath.js의 순수 함수 — 이유와 실측은 그 파일 주석 참고
  const entryPath = (pos) =>
    entryPathSegments(pos.entrySteps, pos.entryPrice, entryX, yScale, IW);

  // 강제청산선 — 진입선과 **같은 x에서 시작**해야 한다. 그래서 좌표를 새로 만들지 않고
  // 진입선이 쓴 첫 가로 구간의 x1을 그대로 가져온다 (h가 비는 일은 없다 —
  // entryPathPoints는 항상 IW까지 가는 가로 구간을 하나는 만든다)
  // 청산선 오른쪽 끝 = **마지막 봉의 오른쪽 가장자리** (2026-08-24 사용자 요청).
  // ⚠ 차트 오른쪽 끝(IW)까지 늘이지 말 것 — 그러면 **아직 오지 않은 구간**에도 선이 깔린다.
  //   청산가는 "지금까지의 사실"이지 미래에 대한 예약이 아니다.
  //   FVG·오더블록 박스가 같은 이유로 같은 계산을 쓴다 (overlayRenderers의 boxRightEdge).
  // ※ 진입선은 여전히 IW까지 간다 — 사용자가 청산선만 지정했다
  const lastBarX = (() => {
    if (!candles?.length || !xScale) return IW;
    const half = (xScale(1) - xScale(0)) / 2;
    return Math.min(IW, xScale(candles.length - 1) + half);
  })();

  const liqOf = (pos) => {
    const price = pos?.liquidationPrice;
    if (!pos || !price) return null;                 // 청산가를 못 받았으면 그리지 않는다
    return { yPx: yScale(price), x1: entryPath(pos).h[0]?.x1 ?? 0, x2: lastBarX };
  };
  const liqLong  = liqOf(position.long);
  const liqShort = liqOf(position.short);

  // 우측 진입 행 — `+TP`/`+SL` · 수량 배지 · `×` · `LONG/SHORT`가 한 덩어리다.
  // 좌표는 hitDetection이 정한다 (렌더와 클릭 판정이 같은 함수를 봐야 어긋나지 않는다)
  const entryRows = posEntryRows(position, tpsl, yScale, IW, IH);
  const rowOf = (sideKey) => entryRows.find(r => r.sideKey === sideKey) ?? null;

  // TP/SL이 아직 없는 자리에 뜨는 `+TP` / `+SL`.
  // 저장 중이거나 지금 그걸 끌고 있는 중이면 감춘다 — 끄는 순간 선이 이미 그 자리에 보인다
  const addButtons = (tpslSaving ? [] : entryRows.flatMap(r => r.add))
    .filter(b => !(dragTpsl?.side === b.side && dragTpsl?.type === b.type));

  // 롱/숏 × TP/SL = 4개의 동일 골격 마커. 호버 상태는 type별로 묶어 단일 setter로 처리
  const tpslMarkers = [
    { side: "LONG",  type: "tp", color: CL, hovered: hoveredTpSide === "LONG",  setHover: setHoveredTpSide, label: "TP" },
    { side: "LONG",  type: "sl", color: CL, hovered: hoveredSlSide === "LONG",  setHover: setHoveredSlSide, label: "SL" },
    { side: "SHORT", type: "tp", color: CS, hovered: hoveredTpSide === "SHORT", setHover: setHoveredTpSide, label: "TP" },
    { side: "SHORT", type: "sl", color: CS, hovered: hoveredSlSide === "SHORT", setHover: setHoveredSlSide, label: "SL" },
  ];

  return (
    <g>
      {/* 강제청산선 — 진입선보다 **먼저** 그린다. 겹치는 일은 거의 없지만
          (청산가는 진입가에서 멀다) 순서가 곧 위아래라, 확정된 사실인 진입선이 위에 온다 */}
      {liqLong  && <LiqLine yPx={liqLong.yPx}  x1={liqLong.x1}  x2={liqLong.x2} />}
      {liqShort && <LiqLine yPx={liqShort.yPx} x1={liqShort.x1} x2={liqShort.x2} />}

      {/* 진입선 — **진입봉부터 차트 오른쪽 끝까지**, 평단이 바뀐 지점에서 꺾이는 계단
          (2026-08-15 사용자 요청). 전 폭 가로선이면 "언제 들어갔나"가 안 보인다 —
          왼쪽 끝이 진입 시점이라 보유 기간이 선 길이로 읽힌다. 좌표는 entryPath() 참고 */}
      {position.long  && <EntryLine yPx={yScale(position.long.entryPrice)}  color={CL} label="LONG"  IH={IH}
        row={rowOf("long")}  qtyText={fmtQtyBadge(position.long.size, qStep)}
        path={entryPath(position.long)}
        confirm={closeConfirm === "LONG"}  {...closeProps("entry-LONG")} />}
      {position.short && <EntryLine yPx={yScale(position.short.entryPrice)} color={CS} label="SHORT" IH={IH}
        row={rowOf("short")} qtyText={fmtQtyBadge(position.short.size, qStep)}
        path={entryPath(position.short)}
        confirm={closeConfirm === "SHORT"} {...closeProps("entry-SHORT")} />}

      {/* TP/SL 신규 등록 버튼 (없을 때만) */}
      {addButtons.map(b => {
        const key = `${b.side}-${b.type}`;
        return (
          <AddTpSlButton
            key={key} btn={b} color={b.side === "LONG" ? CL : CS}
            hovered={hoveredAddBtn === key}
            onEnter={() => setHoveredAddBtn(key)}
            onLeave={() => setHoveredAddBtn(null)}
          />
        );
      })}

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
            handleChar={m.label}
            isActive={isActive} isDragging={isDragging}
            showHandle={!tpslSaving}
            // ⚠ 단일 TP/SL은 `closePosition`이라 대상 수량이 곧 **포지션 전체**다.
            //   그래서 이 값이 보이면 진입 라벨은 수량을 감춘다 (posEntryRows의 showQty)
            qtyText={position[sideKey] ? fmtQtyBadge(position[sideKey].size, qStep) : null}
            dragCenterText={m.label} dragCenterWidth={40}
            onHandleEnter={() => m.setHover(m.side)}
            onHandleLeave={() => m.setHover(null)}
            {...closeProps(`${m.type}-${m.side}`)}
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
            // ⚠ 핸들 글자는 `+`가 아니라 `추가`다 — 버튼 모양이 되면서 신규 등록용
            //   `+TP`/`+SL`과 같은 뜻("여기를 누르면 생긴다")으로 읽히기 때문.
            //   이건 **이미 걸린 주문을 옮기는** 핸들이다
            handleChar="추가"
            isActive={isActive} isDragging={isDragging}
            qtyText={fmtQtyBadge(o.qty, qStep)}
            pctText={fmtPct(o.qty, position[o.side === "BUY" ? "long" : "short"]?.size)}
            dragCenterText="추가진입" dragCenterWidth={72}
            onHandleEnter={() => setHoveredScaleIn(o.orderId)}
            onHandleLeave={() => setHoveredScaleIn(null)}
            {...closeProps(`scale_in-${o.orderId}`)}
          />
        );
      })}

      {/* 미체결 진입 주문 대기선 (2026-08-23 사용자 요청).
          ⚠ **박스가 없는 사이드만** 뜬다 — 우리가 낸 주문은 플랜 박스가 그 가격을 이미
            보여준다. 그래서 실제로 보이는 건 밖에서 낸 주문이 거의 전부다.
            대상 판정과 좌표는 hitDetection.pendingEntryLines 하나가 정한다
          ⚠ 끌 수 없다(draggable=false) — 옮기려면 취소 후 재등록이라 주문번호가 바뀌고,
            외부 주문은 수량·TP/SL을 우리가 정할 근거가 없다. 우측 ×로 취소만 된다 */}
      {pendingEntryLines({ position, drawings, yScale, IH }).map(p => (
        <PriceLineMarker
          key={`pending-${p.orderId}`}
          yPx={p.y} color={p.side === "LONG" ? CL : CS} IW={IW} IH={IH}
          handleChar="대기"
          dashed draggable={false}
          isActive={hoveredPending === p.orderId} isDragging={false}
          qtyText={fmtQtyBadge(p.qty, qStep)}
          onHandleEnter={() => setHoveredPending(p.orderId)}
          onHandleLeave={() => setHoveredPending(null)}
          {...closeProps(`pending-${p.orderId}`)}
        />
      ))}

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
            // ⚠ 핸들 글자는 `TP`가 아니라 `분TP` (2026-08-24 사용자 요청).
            //   ① 전량 TP 버튼과 색까지 같아(SELL/LONG = 초록) 구분이 안 된다
            //   ② `분할`이던 것을 `분TP`로 바꿨다 — 같은 날 분할 SL이 생기면서
            //      `분할`만으로는 익절인지 손절인지 알 수 없게 됐다.
            //      네 글자가 한 벌이다: `TP` `SL` `분TP` `분SL`
            handleChar="분TP"
            isActive={isActive} isDragging={isDragging}
            qtyText={fmtQtyBadge(o.qty, qStep)}
            pctText={fmtPct(o.qty, position[o.side === "SELL" ? "long" : "short"]?.size)}
            dragCenterText="분할TP" dragCenterWidth={60}
            onHandleEnter={() => setHoveredSplitTp(o.orderId)}
            onHandleLeave={() => setHoveredSplitTp(null)}
            {...closeProps(`split_tp-${o.orderId}`)}
          />
        );
      })}

      {/* 분할 SL — 분할 TP와 같은 골격 (2026-08-24 사용자 요청) */}
      {partialSlList.map(o => {
        const isDragging = dragPartialSl?.orderId === o.orderId;
        const price      = isDragging ? dragPartialSl.price : o.price;
        const isActive   = isDragging || hoveredPartialSl === o.orderId;
        const isLong     = o.positionSide === "LONG";
        const color      = isLong ? CL : CS;
        return (
          <PriceLineMarker
            key={o.orderId}
            yPx={yScale(price)} color={color} IW={IW} IH={IH}
            // ⚠ 글자가 `분할`이면 분할 TP와 구분이 안 된다 — 롱이면 둘 다 청산 방향이라
            //   **색까지 같다**(SELL/LONG = 초록). 자리도 같은 좌측 레인이라 글자가 유일한 단서다
            handleChar="분SL"
            isActive={isActive} isDragging={isDragging}
            qtyText={fmtQtyBadge(o.qty, qStep)}
            pctText={fmtPct(o.qty, position[isLong ? "long" : "short"]?.size)}
            dragCenterText="분할SL" dragCenterWidth={60}
            onHandleEnter={() => setHoveredPartialSl(o.orderId)}
            onHandleLeave={() => setHoveredPartialSl(null)}
            {...closeProps(`partial_sl-${o.orderId}`)}
          />
        );
      })}
    </g>
  );
});
