import { memo, useState } from "react";
import { PALETTE } from "../../constants";
import { posTpSlButtons, TPSL_BTN, CLOSE_BTN, ENTRY_LABEL_W, closeBtnRect, entryLabelX, entryCloseRect }
  from "../../chart/hitDetection";

function inView(px, IH) { return px !== null && px >= -20 && px <= IH + 20; }

const CL = PALETTE.long;  // LONG 계열 (초록)
const CS = PALETTE.short; // SHORT 계열 (빨강)

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
function MarkerButton({ x, y, color, text, opacity, onEnter, onLeave, children }) {
  return (
    <g style={{ cursor: "ns-resize" }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
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
  dragCenterText, dragCenterWidth = 40,
  onHandleEnter, onHandleLeave,
  closeHovered, onCloseEnter, onCloseLeave,
}) {
  if (!inView(yPx, IH)) return null;
  const lineOpacity  = isActive ? (isDragging ? 1 : 0.8) : 0;
  return (
    <g>
      {/* ⚠ 굵기는 **항상 1**이다 (2026-08-15 사용자 요청). 예전엔 호버·드래그 때 2였는데
          바로 옆 진입선(EntryLine)이 1이라 유독 굵어 보였다.
          "지금 이 선을 만지고 있다"는 표시는 **투명도**가 한다 (0 → 0.8 → 드래그 1) */}
      <line x1={0} x2={IW} y1={yPx} y2={yPx}
        stroke={color} strokeWidth={1} opacity={lineOpacity} />
      {showHandle && (
        // 버튼은 보이는 표시일 뿐 — 잡히는 범위는 예전 그대로 **왼쪽 60px 전체**다
        // (hitDetection의 `pos.x >= 0 && pos.x <= 60`와 같은 값). 버튼 크기로 좁히면
        // 잡기가 더 어려워진다 — 모양만 바꾼 것이지 조작성은 그대로다
        <MarkerButton
          x={TPSL_BTN.x0} y={yPx - TPSL_BTN.h / 2}
          color={color} text={handleChar}
          opacity={isActive ? 1 : BTN_REST_OPACITY}
          onEnter={onHandleEnter} onLeave={onHandleLeave}
        >
          <rect x={0} y={yPx-10} width={60} height={20} fill="transparent" />
        </MarkerButton>
      )}
      {/* ⚠ 끄는 중에는 × 를 감춘다. 클릭 판정(markerCloseButtons)은 **저장된 가격** 기준이라
          끌려가는 선을 따라가지 않는다 — 보이는 자리와 눌리는 자리가 어긋난다 */}
      {showHandle && !isDragging && (
        <CloseButton rect={closeBtnRect(yPx)} color={color}
          hovered={closeHovered} onEnter={onCloseEnter} onLeave={onCloseLeave} />
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
// ⚠ 좌표를 여기서 만들지 말 것 — hitDetection의 posTpSlButtons가 유일한 출처다.
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
function EntryLine({ yPx, color, label, IW, IH, confirm, closeHovered, onCloseEnter, onCloseLeave }) {
  if (!inView(yPx, IH)) return null;
  // 오른쪽 여백은 왼쪽 버튼과 **같은 값**을 쓴다(TPSL_BTN.x0) — 양끝이 대칭으로 보이게.
  // 예전엔 여백 0이라 라벨이 플롯 오른쪽 끝에 붙어 있었다
  const x = entryLabelX(IW);
  return (
    <>
      <line x1={0} x2={IW} y1={yPx} y2={yPx} stroke={color} strokeWidth={1} opacity={0.7} />
      {/* × 는 라벨 **왼쪽**에 — 오른쪽은 여백뿐이라 자리가 없다.
          한 번 누르면 ✓(호박색)로 바뀌고, 그 상태에서 다시 눌러야 시장가 청산이 나간다 */}
      <CloseButton rect={entryCloseRect(yPx, IW)} color={color} confirm={confirm}
        hovered={closeHovered} onEnter={onCloseEnter} onLeave={onCloseLeave} />
      <rect x={x} y={yPx - TPSL_BTN.h / 2} width={ENTRY_LABEL_W} height={TPSL_BTN.h} rx={3}
        fill="#0b1120" stroke={color} strokeWidth={1} opacity={BTN_REST_OPACITY} />
      {/* ⚠ 진입선 라벨만 **굵지 않다**(400, 2026-08-15 사용자 요청).
          나머지 버튼(TP/SL/추가/분할/+TP)은 700 그대로 — 저건 누르는 것이고 이건 표시다 */}
      <text x={x + ENTRY_LABEL_W / 2} y={yPx + 3.5} fill={color}
        fontSize={9.5} fontWeight="400" textAnchor="middle">
        {label}
      </text>
    </>
  );
}

export const PositionLines = memo(function PositionLines({ position, tpsl, dragTpsl, tpslSaving, scaleInOrders, dragScaleIn, splitTps, dragSplitTp, closeConfirm, scales, IW, IH }) {
  if (!position || !scales) return null;
  const { yScale } = scales;

  const [hoveredTpSide, setHoveredTpSide]   = useState(null);
  const [hoveredSlSide, setHoveredSlSide]   = useState(null);
  const [hoveredScaleIn, setHoveredScaleIn] = useState(null);
  const [hoveredSplitTp, setHoveredSplitTp] = useState(null);
  const [hoveredAddBtn, setHoveredAddBtn]   = useState(null);
  // × 버튼 호버는 한 곳에 모은다 — 화면에 한 번에 하나만 호버되므로 키 하나면 충분하다
  const [hoveredClose, setHoveredClose]     = useState(null);
  const closeProps = (key) => ({
    closeHovered: hoveredClose === key,
    onCloseEnter: () => setHoveredClose(key),
    onCloseLeave: () => setHoveredClose(null),
  });

  const splitTpList = splitTps ?? [];

  // TP/SL이 아직 없는 자리에 뜨는 `+TP` / `+SL`.
  // 저장 중이거나 지금 그걸 끌고 있는 중이면 감춘다 — 끄는 순간 선이 이미 그 자리에 보인다
  const addButtons = (tpslSaving ? [] : posTpSlButtons(position, tpsl, yScale, IH))
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
      {/* 진입선 */}
      {position.long  && <EntryLine yPx={yScale(position.long.entryPrice)}  color={CL} label="LONG"  IW={IW} IH={IH}
        confirm={closeConfirm === "LONG"}  {...closeProps("entry-LONG")} />}
      {position.short && <EntryLine yPx={yScale(position.short.entryPrice)} color={CS} label="SHORT" IW={IW} IH={IH}
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
            dragCenterText="추가진입" dragCenterWidth={72}
            onHandleEnter={() => setHoveredScaleIn(o.orderId)}
            onHandleLeave={() => setHoveredScaleIn(null)}
            {...closeProps(`scale_in-${o.orderId}`)}
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
            // ⚠ 핸들 글자는 `TP`가 아니라 `분할` — 버튼 모양에서는 색까지 같아
            //   (SELL = 롱 청산 = 초록) 진짜 TP 버튼과 구분이 안 된다
            handleChar="분할"
            isActive={isActive} isDragging={isDragging}
            dragCenterText="분할TP" dragCenterWidth={60}
            onHandleEnter={() => setHoveredSplitTp(o.orderId)}
            onHandleLeave={() => setHoveredSplitTp(null)}
            {...closeProps(`split_tp-${o.orderId}`)}
          />
        );
      })}
    </g>
  );
});
