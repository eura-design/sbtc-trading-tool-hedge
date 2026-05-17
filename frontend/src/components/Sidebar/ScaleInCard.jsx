import { useState } from "react";
import { useTheme } from "../../ThemeContext";
import { PALETTE } from "../../constants";
import { isLongToSide } from "../../utils/side";
import { useAutoUpdatedPrice } from "../../hooks/useAutoUpdatedPrice";
import { usePersistedPct, PercentSlider, PriceField, SubmitButton, CardWrapper } from "./cardControls";

export function ScaleInCard({ posData, side, lastPrice, onScaleIn, scaleInOrders, onCancelScaleIn, embedded }) {
  const { theme } = useTheme();
  const isLong = side === "LONG";
  const [orderType, setOrderType] = useState("LIMIT");
  const [pct, setPct] = usePersistedPct("scaleInPct");
  const [price, setPrice] = useAutoUpdatedPrice(
    lastPrice || posData?.entryPrice || 0,
    () => lastPrice ? lastPrice * (isLong ? 0.97 : 1.03) : null,
    { enabled: orderType === "LIMIT" },
  );

  if (!posData) return null;

  const color    = isLong ? PALETTE.long : PALETTE.short;
  const addQty   = parseFloat((posData.size * pct / 100).toFixed(3));
  const refPrice = orderType === "MARKET" ? (lastPrice || 0) : (parseFloat(price) || 0);
  const avgPrice = refPrice > 0
    ? (posData.size * posData.entryPrice + addQty * refPrice) / (posData.size + addQty)
    : null;
  const priceNum    = parseFloat(price);
  const directionOk = orderType === "MARKET" || (
    isLong ? priceNum < (lastPrice || Infinity) : priceNum > (lastPrice || 0)
  );
  const valid = orderType === "MARKET"
    ? addQty >= 0.001
    : priceNum > 0 && addQty >= 0.001 && directionOk;

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
            대기중 ${o.price?.toLocaleString()} · {o.qty} BTC
          </span>
          <button onClick={() => onCancelScaleIn(o.orderId)} style={{
            background: "none", border: "none", color: PALETTE.short,
            cursor: "pointer", fontSize: "12px", fontWeight: "700", padding: "0 2px",
          }}>✕</button>
        </div>
      ))}

      <div style={{ display: "flex", gap: "4px", marginBottom: "8px",
        background: theme.bgCard, borderRadius: "4px", padding: "2px" }}>
        <button style={btnStyle(orderType === "LIMIT")}  onClick={() => setOrderType("LIMIT")}>LIMIT</button>
        <button style={btnStyle(orderType === "MARKET")} onClick={() => setOrderType("MARKET")}>MARKET</button>
      </div>

      {orderType === "LIMIT" && (
        <PriceField
          price={price} onChange={setPrice}
          error={priceNum > 0 && !directionOk
            ? (isLong ? "▲ LONG 추가 진입은 현재가보다 낮아야 합니다"
                      : "▼ SHORT 추가 진입은 현재가보다 높아야 합니다")
            : null}
        />
      )}

      <PercentSlider
        pct={pct} onChange={setPct} color={color}
        label="추가 수량" secondaryText={`${pct}% (${addQty} BTC)`}
      />

      {avgPrice && (
        <div style={{ display: "flex", justifyContent: "space-between",
          padding: "3px 0", marginBottom: "6px", borderBottom: `1px solid ${theme.border}` }}>
          <span style={{ fontSize: "11px", color: theme.textMuted }}>예상 평균가</span>
          <span style={{ fontSize: "12px", color: PALETTE.warn, fontWeight: "600" }}>
            ${avgPrice.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
        </div>
      )}

      <SubmitButton
        disabled={!valid} color={color}
        onClick={() => onScaleIn(isLongToSide(isLong), orderType, parseFloat(price) || null, addQty)}
      >
        {orderType === "MARKET"
          ? (isLong ? "▲ 시장가 추가 매수" : "▼ 시장가 추가 매도")
          : (isLong ? "▲ 지정가 추가 매수" : "▼ 지정가 추가 매도")}
      </SubmitButton>
    </CardWrapper>
  );
}
