import { useTheme } from "../../ThemeContext";
import { PALETTE } from "../../constants";
import { useAutoUpdatedPrice } from "../../hooks/useAutoUpdatedPrice";
import { usePersistedPct, PercentSlider, PriceField, SubmitButton, CardWrapper } from "./cardControls";

export function SplitTPCard({ posData, side, tpsl, lastPrice, onAddSplitTp, onCancelSplitTp, embedded }) {
  const { theme } = useTheme();
  const isLong = side === "LONG";
  const [pct, setPct] = usePersistedPct("splitTpPct");
  const [price, setPrice] = useAutoUpdatedPrice(
    lastPrice || posData?.entryPrice || 0,
    () => lastPrice ? lastPrice * (isLong ? 1.03 : 0.97) : null,
  );

  if (!posData) return null;

  const color      = isLong ? PALETTE.long : PALETTE.short;
  const splitTps   = tpsl?.splitTps ?? [];
  const allocQty   = splitTps.reduce((s, o) => s + o.qty, 0);
  const remaining  = Math.max(0, posData.size - allocQty);
  const trueAddQty = posData.size * pct / 100;
  const rawAddQty  = parseFloat(trueAddQty.toFixed(3));
  const addQty     = rawAddQty > remaining ? remaining : rawAddQty;
  const priceNum   = parseFloat(price);
  const directionOk = isLong ? priceNum > posData.entryPrice : priceNum < posData.entryPrice;
  const valid      = priceNum > 0 && addQty >= 0.001 && trueAddQty <= remaining + 0.0005 && directionOk;

  const extraTitle = !embedded && tpsl?.tp && (
    <span style={{ fontSize: "10px", color: PALETTE.warn, marginLeft: "6px" }}>
      (등록 시 단일 TP 취소됨)
    </span>
  );

  return (
    <CardWrapper embedded={embedded} title="분할 TP" extra={extraTitle}>
      {splitTps.map(o => (
        <div key={o.orderId} style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "5px 8px", marginBottom: "4px",
          borderRadius: "4px", background: `${color}18`, border: `1px solid ${color}44` }}>
          <span style={{ fontSize: "11px", color }}>
            ${o.price?.toLocaleString()} · {o.qty.toFixed(3)} BTC{o.pct ? ` (${o.pct}%)` : ""}
          </span>
          <button onClick={() => onCancelSplitTp(o.orderId)} style={{
            background: "none", border: "none", color: PALETTE.short,
            cursor: "pointer", fontSize: "12px", fontWeight: "700", padding: "0 2px",
          }}>✕</button>
        </div>
      ))}

      {splitTps.length > 0 && (
        <div style={{ marginBottom: "6px" }}>
          {allocQty > posData.size + 0.0001 && (
            <div style={{ fontSize: "10px", color: PALETTE.short, marginBottom: "4px",
              padding: "4px 6px", background: `${PALETTE.short}18`, borderRadius: "3px" }}>
              ⚠ 분할 TP 합계 {allocQty.toFixed(3)} BTC &gt; 포지션 {posData.size} BTC
              — 부분 청산 후 초과분은 바이낸스에서 자동 취소됩니다
            </div>
          )}
          {remaining > 0.0001 && allocQty > 0.0001 && (
            <div style={{ fontSize: "10px", color: PALETTE.warn, marginBottom: "4px",
              padding: "4px 6px", background: `${PALETTE.warn}18`, borderRadius: "3px" }}>
              ⚠ {remaining.toFixed(3)} BTC 미커버 — 추매 등으로 포지션이 늘었다면 분할 TP를 추가 등록하세요
            </div>
          )}
          <div style={{ fontSize: "11px", color: theme.textFaint, textAlign: "right" }}>
            잔여: {remaining.toFixed(3)} BTC ({((remaining / posData.size) * 100).toFixed(0)}%)
          </div>
        </div>
      )}

      <PriceField
        price={price} onChange={setPrice}
        error={priceNum > 0 && !directionOk
          ? (isLong ? "▲ LONG TP는 진입가보다 높아야 합니다"
                    : "▼ SHORT TP는 진입가보다 낮아야 합니다")
          : null}
      />

      <PercentSlider
        pct={pct} onChange={setPct} color={color}
        label="수량" secondaryText={`${pct}% (${addQty.toFixed(3)} BTC)`}
      />

      <SubmitButton
        disabled={!valid} color={color}
        onClick={() => onAddSplitTp(side, parseFloat(price), addQty, pct)}
      >
        {isLong ? "▲ 분할 TP 지정가 추가" : "▼ 분할 TP 지정가 추가"}
      </SubmitButton>
    </CardWrapper>
  );
}
