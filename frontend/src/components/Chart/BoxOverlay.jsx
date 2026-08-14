import { memo } from "react";
import { tsToIdx } from "../../chart/scales";

/**
 * 진입/TP/SL 플랜 박스.
 *
 * ── ⚠ 2026-08-14 사용자 요청으로 걷어낸 것들 (되살리지 말 것) ────────────────
 *   ① **가격 텍스트** (`진입 $…` / `TP $…` / `SL $…`) — 옛 `BoxLabels` 컴포넌트째 삭제
 *   ② **TP 삼각형 ▲ / SL 다이아 ◆ 마커**
 *   ③ **손익비 배지(`1 : R`)**
 *   ④ **진입선의 노란 원(↕)**
 *   ⑤ **좌우 폭 조절 그립(금색 점 2개)** — 넣었다가 같은 날 바로 제거 요청
 *
 * ①③은 **사이드바 플랜 카드에 같은 값이 이미 있어서** 차트에 두 벌이었다.
 * ②④⑤는 전부 **장식이다 — 드래그 판정을 하지 않는다.** 판정은 hitDetection이 따로 갖고
 * 있고(가로선은 y 거리 HIT × 박스 전체 폭, 세로 모서리는 x 거리 HIT), 마커의 위치·크기와
 * 무관하다. 그래서 지워도 조작성은 그대로다 — **"핸들이 없어서 못 잡는다"며 되살리지 말 것.**
 *
 * 남긴 것은 `▲ LONG` / `▼ SHORT` 하나뿐이다 (방향 표시라 글자와 한 덩어리).
 * 즉 지금 박스는 **면 · 가로선 3개 · 방향 글자**로만 이뤄져 있다.
 *
 * ※ ④를 지우면서 `hasLong`/`hasShort` prop도 필요 없어졌다 (ChartSvg 호출부에서도 뺐다) —
 *   같은 사이드 포지션 유무로 감출 마커가 더는 없다. 되살리려면 그 배선부터 다시 필요하다.
 */
export const BoxOverlay = memo(function BoxOverlay({ drawing, scales, IW, selectedBox, candles }) {
  if (!drawing || !scales || !candles?.length) return null;
  const { xScale, yScale } = scales;

  const x1 = Math.max(xScale(tsToIdx(drawing.tStart, candles)), 0);
  const x2 = Math.min(xScale(tsToIdx(drawing.tEnd,   candles)), IW);
  if (x2 <= x1) return null;
  const w    = x2 - x1;
  const ePx  = yScale(drawing.entry);
  const tPx  = yScale(drawing.tp);
  const slPx = yScale(drawing.sl);
  const color = drawing.isLong ? "#0ecb81" : "#f6465d";

  return (
    <g>
      {selectedBox && (
        <rect x={x1-2} y={Math.min(tPx, slPx)-2} width={w+4} height={Math.abs(tPx - slPx)+4}
          fill="none" stroke="#f0b90b" strokeWidth={1.5} strokeDasharray="5,3" rx={2} opacity={0.7} />
      )}
      <rect x={x1} y={Math.min(ePx, tPx)} width={w} height={Math.abs(ePx - tPx)}
        fill={drawing.isLong ? "rgba(14,203,129,0.10)" : "rgba(246,70,93,0.10)"} />
      <rect x={x1} y={Math.min(ePx, slPx)} width={w} height={Math.abs(ePx - slPx)}
        fill={drawing.isLong ? "rgba(246,70,93,0.07)" : "rgba(14,203,129,0.07)"} />
      <rect x={x1} y={Math.min(tPx, slPx)} width={w} height={Math.abs(tPx - slPx)}
        fill="none" stroke={color} strokeWidth={0.8} strokeDasharray="5,3" strokeOpacity={0.4} />
      {/* TP·SL 둘 다 **실선**이다 (2026-08-14 사용자 요청 — SL만 점선이라 짝이 안 맞았다).
          구분은 색이 한다: TP = 방향색(롱 초록 / 숏 빨강), SL = 항상 빨강.
          SL에 strokeDasharray를 다시 넣지 말 것 */}
      <line x1={x1} x2={x2} y1={tPx}  y2={tPx}  stroke={color}   strokeWidth={1.5} />
      <line x1={x1} x2={x2} y1={ePx}  y2={ePx}  stroke="#f0b90b" strokeWidth={2} />
      <line x1={x1} x2={x2} y1={slPx} y2={slPx} stroke="#f6465d" strokeWidth={1.5} />
      {/* 좌우 폭 조절(2026-08-14 추가)은 **표식 없이** 세로 모서리를 그냥 잡아 끈다.
          커서가 모서리 위에서 ew-resize로 바뀌는 것이 유일한 신호다 (cursorRules).
          그립 점을 다시 넣지 말 것 — 넣었다가 같은 날 제거 요청을 받았다 */}
      <text x={x1+4} y={tPx+(drawing.isLong?12:-4)} fill={color} fontSize={11} fontWeight="700">
        {drawing.isLong ? "▲ LONG" : "▼ SHORT"}
      </text>
    </g>
  );
});

export const DrawingCurrent = memo(function DrawingCurrent({ current, scales, IW, IH }) {
  if (!current || !scales) return null;
  const sy = current.y1, ey = current.y2, isLong = ey > sy; // 롱=아래로 드래그
  const color = isLong ? "#0ecb81" : "#f6465d";
  const x1 = Math.min(current.x1, current.x2);
  const x2 = Math.max(current.x1, current.x2);
  const w  = x2 - x1;
  const tpPx = Math.min(Math.max(3 * sy - 2 * ey, 0), IH); // SL 거리 2배 반대 방향 = TP
  return (
    <g>
      {/* TP 구간 (수익) */}
      <rect x={x1} y={Math.min(sy, tpPx)} width={w} height={Math.abs(sy - tpPx)}
        fill={isLong ? "rgba(14,203,129,0.08)" : "rgba(246,70,93,0.08)"}
        stroke={color} strokeWidth={1} strokeDasharray="4,3" strokeOpacity={0.7} />
      {/* SL 구간 (손실) */}
      <rect x={x1} y={Math.min(sy, ey)} width={w} height={Math.abs(sy - ey)}
        fill={isLong ? "rgba(246,70,93,0.05)" : "rgba(14,203,129,0.05)"} />
      <line x1={x1} x2={x2} y1={sy}   y2={sy}   stroke="#f0b90b" strokeWidth={1.5} strokeDasharray="4,3" />
      <line x1={x1} x2={x2} y1={ey}   y2={ey}   stroke="#f6465d" strokeWidth={1} strokeDasharray="3,3" strokeOpacity={0.5} />
    </g>
  );
});

// ※ 여기 있던 `BoxLabels`(박스 오른쪽의 `TP $…` / `진입 $…` / `SL $…` 세 줄)는
//   2026-08-14 사용자 요청으로 **컴포넌트째 제거**했다. 같은 값이 사이드바 플랜 카드에
//   이미 있어서 차트에 두 벌이었다. 되살리지 말 것 — ChartSvg의 "라벨(클립 밖)" g 태그도
//   같이 지웠으므로 되살리려면 거기도 함께 필요하다.
