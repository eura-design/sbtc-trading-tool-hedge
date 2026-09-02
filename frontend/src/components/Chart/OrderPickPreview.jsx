import { PALETTE } from "../../constants";
import { useStore } from "../../store";
import { splitPlan } from "../../utils/splitLevels";
import { fmtQty } from "../../utils/qty";

/**
 * 분할 주문 미리보기 (2026-08-27 사용자 요청) — **세로로 끄는 동안에만** 뜬다.
 *
 * 놓는 순간 실제로 어디에 얼마가 걸릴지를 그대로 보여준다.
 *
 * ⚠ 가격·수량을 여기서 다시 계산하지 말 것 — `utils/splitLevels.js`의
 *   `splitPlan` 하나를 `store/orderSlice.placeSplitOrders`와 **같이 쓴다**.
 *   ⚠ `splitOrders`를 직접 부르면 큰 조각이 **드래그를 시작한 쪽**으로 가서,
 *     미리보기에 뜬 배분과 실제로 나가는 배분이 어긋난다
 *   각자 계산하면 화면에 뜬 것과 실제로 나가는 것이 어긋나고,
 *   그 어긋남은 **체결된 뒤에야** 보인다
 *
 * ⚠ 클릭(1개)에는 미리보기가 없다 — 마우스 이동마다 상태를 갱신하면 오버레이가
 *   매번 리렌더된다. 그 자리 가격은 크로스헤어의 가격축 태그가 이미 말해 준다
 *   (DRAG_HANDLERS.order_pick이 클릭 범위 안에서는 draft를 null로 둔다)
 *
 * ⚠ **점선이다.** 이 시스템에서 점선은 "아직 확정 아님"이라는 뜻이고
 *   (미체결 대기선·자동 이어그리기), 손을 떼기 전까지가 정확히 그 상태다
 * ⚠ 색은 **포지션 사이드 색**이다 — 주문 종류 색이 아니다. 롱의 분할 TP와 분할 SL은
 *   둘 다 청산 방향이라 PositionLines에서도 같은 초록으로 그려진다.
 *   여기만 다른 규칙을 만들면 미리보기와 등록 후 선의 색이 달라진다
 */
export function OrderPickPreview({ orderPick, pickDraft, scales, IW }) {
  // ⚠ 훅은 조기 반환보다 **앞**이어야 한다 (React 규칙)
  const { step: qStep } = useStore(s => s.symbolFilters);
  if (!orderPick || !pickDraft || !scales) return null;

  // ⚠ 실주문(orderSlice.placeSplitOrders)과 **같은 인자**로 부를 것 — 수량 단위가
  //   다르면 미리보기에 뜬 조각과 실제로 나가는 조각이 어긋난다
  const orders = splitPlan(pickDraft.p1, pickDraft.p2, orderPick.count, orderPick.qty,
                           orderPick.side === "LONG", orderPick.kind, qStep);
  if (!orders.length) return null;

  const color = orderPick.side === "LONG" ? PALETTE.long : PALETTE.short;

  return (
    <g pointerEvents="none">
      {orders.map((o, i) => {
        const y = scales.yScale(o.price);
        if (!Number.isFinite(y)) return null;
        return (
          <g key={i}>
            <line x1={0} y1={y} x2={IW} y2={y}
              stroke={color} strokeWidth={1} strokeDasharray="4,3" opacity={0.85} />
            {/* 수량은 **숫자만** — BTCUSDT 하나만 다뤄서 단위를 붙이면 줄마다
                같은 세 글자가 반복될 뿐이다 (진입선 수량 배지와 같은 규칙) */}
            <text x={IW - 6} y={y - 3} textAnchor="end"
              fontSize="10" fill={color} opacity={0.95}>
              {fmtQty(o.qty, qStep)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
