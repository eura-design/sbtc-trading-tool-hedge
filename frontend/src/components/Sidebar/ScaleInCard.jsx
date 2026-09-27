import { useState } from "react";
import { useTheme } from "../../ThemeContext";
import { PALETTE } from "../../constants";
import { usePersistedNum, PercentSlider, CountSlider, ChartPickButton, useChartPick, SubmitButton, CardWrapper, CancelAllButton } from "./cardControls";
import { iconBtn } from "../sidebarBtn";
import { floorQty, qtyLabel } from "../../utils/qty";
import { minEntryQty } from "../../utils/calc";
import { useStore } from "../../store";

/**
 * 추가 진입.
 *
 * ⚠ **지정가 가격은 차트에서 정한다** (2026-08-27 사용자 요청) — `차트에서 지정`을
 *   켜고 차트를 **클릭하면 1개**, **세로로 끌면 개수만큼 균등**하게 걸린다.
 *
 *   그전에는 숫자 입력칸에 `현재가 −3%`가 자동으로 채워졌고(5초마다 다시 계산,
 *   사용자가 만지면 60초 잠금 — `useAutoUpdatedPrice`), 방향이 틀리면 빨간 문구로
 *   알려줬다. **그 셋이 전부 사라졌다** — 차트를 누른 자리가 곧 가격이라
 *   자동 갱신할 값도, 잘못 칠 자리도 없다.
 *   ⚠ 입력칸을 되살리지 말 것: 되살리면 "가격을 정하는 곳"이 둘이 되고,
 *     `차트에서 지정`을 켜 둔 채 숫자를 고치면 어느 쪽이 나갈지 알 수 없다
 *
 * ⚠ **MARKET은 그대로 버튼이다.** 지금 가격에 바로 나가는 주문이라 정할 가격이 없다 —
 *   차트를 누르게 하면 누른 자리가 뜻이 없어서 오히려 헷갈린다
 */
export function ScaleInCard({ posData, side, lastPrice, onScaleIn, scaleInOrders, onCancelScaleIn, embedded }) {
  const { theme } = useTheme();
  // 수량 자릿수와 코인 이름은 심볼마다 다르다 (SOL 0.01 / DOGE 1)
  const { step: qStep, base: qBase, minQty: qMin, minNotional: qMinNotional } = useStore(s => s.symbolFilters);
  const isLong = side === "LONG";
  const [orderType, setOrderType] = useState("LIMIT");
  const [pct, setPct]     = usePersistedNum("scaleInPct", 50);
  const [count, setCount] = usePersistedNum("scaleInCount", 3);

  const color  = isLong ? PALETTE.long : PALETTE.short;
  const addQty = floorQty((posData?.size ?? 0) * pct / 100, qStep);

  // ⚠ 훅은 early return **앞**에 있어야 한다 (React 규칙) — posData가 없어지는
  //   순간(청산)에도 훅 개수가 같아야 하고, 그때 useChartPick의 정리 이펙트가
  //   차트에 남은 주문 모드를 꺼 준다
  const pick = useChartPick({ kind: "scale_in", side, count, qty: addQty });

  if (!posData) return null;

  const avgPrice = orderType === "MARKET" && lastPrice > 0 && addQty > 0
    ? (posData.size * posData.entryPrice + addQty * lastPrice) / (posData.size + addQty)
    : null;
  // ── 거래소 최소 수량 미만이면 **최소로 올린다** (2026-09-27 사용자 요청) ─────
  //
  // 거래소는 주문마다 **최소 수량과 최소 금액**을 둘 다 본다. 수량이 "지금 포지션의 %"라
  // 최소로 진입한 포지션에서는 그 %가 너무 작다 — 실측: 0.05 SOL 포지션의 50%를 5분할하면
  // 층당 0.004 SOL이라 거래소가 전부 거절했다(`Order's notional must be no smaller than 5`).
  // → 막지 않고 **모자란 조각만 최소로 올린다.** 진입의 `calcPosition`이 이미 그렇게 한다.
  //
  // ⚠ 올리면 **슬라이더가 말하는 것보다 많이 나간다** (위 예: 0.02 → 0.25, 12배).
  //   그래서 올라가는 경우 카드에 `⚠ 최소 수량으로 올림`을 띄운다 — 지우지 말 것.
  // ⚠ 여기의 기준 가격은 **현재가**다(어림). 실제로 올리는 것은 주문을 내는 자리
  //   (`orderSlice.placeSplitOrders`)가 **층마다 그 층의 가격으로** 한다 — 롱이면 아래 층일수록
  //   금액이 작아지므로 거기서 재야 정확하다. 늘 실제가 표시보다 크거나 같은 쪽이다
  const minPiece = minEntryQty({ price: lastPrice || posData.entryPrice, step: qStep,
                                 minQty: qMin, minNotional: qMinNotional });
  // 시장가는 한 번에 한 조각, 지정가는 count조각으로 나뉜다
  const raised = orderType === "MARKET"
    ? addQty < minPiece
    : addQty / Math.max(1, count) < minPiece;
  const marketQty = Math.max(addQty, minPiece);

  const btnStyle = (active) => ({
    flex: 1, padding: "4px 0", borderRadius: "3px", cursor: "pointer",
    fontFamily: "inherit", fontSize: "11px", fontWeight: "600", border: "none",
    background: active ? `${color}33` : "transparent",
    color: active ? color : theme.textFaint,
    transition: "background 0.15s",
  });

  return (
    <CardWrapper embedded={embedded} title="추가 진입">
      {scaleInOrders?.map(o => (
        <div key={o.orderId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "5px 8px", marginBottom: "4px", borderRadius: "4px",
          background: `${PALETTE.info}18`, border: `1px solid ${PALETTE.info}44` }}>
          <span style={{ fontSize: "11px", color: PALETTE.info }}>
            대기중 ${o.price?.toLocaleString()} · {qtyLabel(o.qty, qStep, qBase)}
          </span>
          <button onClick={() => onCancelScaleIn(o.orderId)}
            style={iconBtn(PALETTE.short, "12px")}>✕</button>
        </div>
      ))}

      {/* 목록에 대한 동작이라 목록 바로 아래에 둔다 */}
      <CancelAllButton kind="scale_in" side={side} count={scaleInOrders?.length ?? 0} />

      <div style={{ display: "flex", gap: "4px", marginBottom: "8px",
        background: theme.bgCard, borderRadius: "4px", padding: "2px" }}>
        <button style={btnStyle(orderType === "LIMIT")}  onClick={() => setOrderType("LIMIT")}>LIMIT</button>
        {/* ⚠ MARKET으로 넘어갈 때 **지정 모드를 끈다.** `차트에서 지정` 버튼은 LIMIT일 때만
            그려지므로, 켜 둔 채 넘어가면 화면 어디에도 켜졌다는 표시가 없는데 차트는
            무장된 상태로 남는다 — 다음 클릭이 곧 실주문이 된다 */}
        <button style={btnStyle(orderType === "MARKET")}
          onClick={() => { setOrderType("MARKET"); if (pick.active) pick.toggle(); }}>MARKET</button>
      </div>

      <PercentSlider
        pct={pct} onChange={setPct} color={color}
        label="추가 수량" secondaryText={`${pct}% (${qtyLabel(addQty, qStep, qBase)})`}
      />

      {orderType === "LIMIT" && (
        /* 개수는 1~10 전부 고를 수 있다 — 모자란 조각은 최소로 올라가므로 수량이 개수를
           제한하지 않는다 (분할 TP·SL은 예전처럼 수량이 개수를 제한한다) */
        <CountSlider count={count} onChange={setCount} qty={addQty} color={color} max={10} />
      )}

      {raised && (
        <div style={{ fontSize: "11px", color: PALETTE.warn, marginBottom: "6px" }}>
          ⚠ 최소 수량으로 올림
        </div>
      )}

      {avgPrice && (
        <div style={{ display: "flex", justifyContent: "space-between",
          padding: "3px 0", marginBottom: "6px", borderBottom: `1px solid ${theme.border}` }}>
          <span style={{ fontSize: "11px", color: theme.textMuted }}>예상 평균가</span>
          <span style={{ fontSize: "12px", color: PALETTE.warn, fontWeight: "600" }}>
            ${avgPrice.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
        </div>
      )}

      {orderType === "LIMIT" ? (
        <ChartPickButton active={pick.active} onToggle={pick.toggle}
          disabled={!(addQty > 0 || minPiece > 0)} color={color} count={count} qty={addQty} max={10} />
      ) : (
        <SubmitButton
          disabled={!(marketQty > 0)} color={color}
          onClick={() => onScaleIn(side, "MARKET", null, marketQty)}
        >
          {isLong ? "▲ 시장가 추가 매수" : "▼ 시장가 추가 매도"}
        </SubmitButton>
      )}
    </CardWrapper>
  );
}
