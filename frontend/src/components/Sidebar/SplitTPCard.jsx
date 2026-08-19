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

  // ── ⚠ 슬라이더는 **잔여 대비 %**다 (2026-08-19 사용자 요청) ──────────────
  // 예전에는 **포지션 전체 대비 %**였다. 그래서 40%짜리를 하나 걸어 두면 슬라이더
  // 60~100 구간이 통째로 죽은 구간이 됐다 — 끌 수는 있는데 버튼이 비활성이고
  // (`trueAddQty <= remaining` 검증), 표시도 "80% (0.600 BTC)"처럼 **숫자와 수량이
  // 어긋났다**(0.600은 포지션의 60%다). 지금은 어느 위치든 뜻이 있고, 끝까지 밀면
  // "남은 것 전부"가 된다.
  //
  // ⚠ 다만 **저장·표시되는 `pct`는 포지션 대비 그대로 둔다**(`posPct`).
  //   목록의 `(40%)`와 부분 청산 후 재계산(`qty / 잔여포지션`, backend/utils/splitTp.js)이
  //   전부 포지션 기준이라, 여기만 잔여 기준으로 저장하면 같은 화면에서 뜻이 둘이 된다.
  //   슬라이더 아래 `→ 포지션의 N%` 줄이 둘을 이어 준다
  const floor3     = (v) => Math.floor(v * 1000) / 1000;
  const addQty     = Math.min(parseFloat((remaining * pct / 100).toFixed(3)), floor3(remaining));
  const posPct     = posData.size > 0 ? Math.round((addQty / posData.size) * 100) : 0;
  const priceNum   = parseFloat(price);
  const directionOk = isLong ? priceNum > posData.entryPrice : priceNum < posData.entryPrice;
  // 잔여에서 뽑으므로 "잔여 초과" 검증이 필요 없다 — 구조적으로 넘을 수가 없다
  const valid      = priceNum > 0 && addQty >= 0.001 && directionOk;
  const full       = remaining < 0.001;   // 분할 TP가 포지션을 다 덮은 상태

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

      {full ? (
        <div style={{ fontSize: "11px", color: theme.textFaint, textAlign: "center",
          padding: "8px 6px", marginBottom: "6px",
          background: theme.bgCard, borderRadius: "4px" }}>
          분할 TP가 포지션 전체를 덮고 있습니다 — 추가하려면 기존 항목을 지우세요
        </div>
      ) : (
        <>
          <PercentSlider
            pct={pct} onChange={setPct} color={color}
            label={allocQty > 0.0001 ? "수량 (잔여 대비)" : "수량"}
            secondaryText={`${pct}% · ${addQty.toFixed(3)} BTC`}
          />
          {/* 슬라이더는 잔여 대비인데 목록·재계산은 포지션 대비다 — 그 둘을 이어 주는 줄 */}
          {allocQty > 0.0001 && (
            <div style={{ fontSize: "10px", color: theme.textFaint,
              textAlign: "right", marginTop: "-2px", marginBottom: "6px" }}>
              → 포지션의 {posPct}%
            </div>
          )}
        </>
      )}

      <SubmitButton
        disabled={!valid} color={color}
        onClick={() => onAddSplitTp(side, parseFloat(price), addQty, posPct)}
      >
        {isLong ? "▲ 분할 TP 지정가 추가" : "▼ 분할 TP 지정가 추가"}
      </SubmitButton>
    </CardWrapper>
  );
}
