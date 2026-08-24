import { useTheme } from "../../ThemeContext";
import { PALETTE } from "../../constants";
import { useAutoUpdatedPrice } from "../../hooks/useAutoUpdatedPrice";
import { usePersistedPct, PercentSlider, PriceField, SubmitButton, CardWrapper } from "./cardControls";
import { iconBtn } from "../sidebarBtn";

/**
 * 분할 SL — 수량을 지정한 조건부 시장가 손절. 분할 TP의 손절 쪽 짝이다.
 *
 * 만든 이유: "평단까지 내려오면 절반만 청산"을 예약할 방법이 없었다. 수익 중인 롱에서
 * 평단은 **현재가 아래**라, 분할 TP(지정가 SELL)로 걸면 호가창에 앉지 않고 **즉시 체결된다**.
 * 아래쪽을 기다리는 주문은 트리거 주문이어야 한다.
 *
 * ⚠ **전량 손절과 공존한다.** 합계가 포지션을 채우면 "덮였다"로 판정하므로
 *   (backend `utils/orderKind.js`의 `coversPosition`) 전량 손절 없이 분할 SL만으로도 된다.
 *   다만 수량이 고정이라 **추가 진입이 체결되면 덮는 비율이 떨어진다** — 그때는 무방비
 *   경보가 `일부만 덮습니다 (0.140 / 0.190)`으로 알려준다. 전량 손절(`closePosition`)은
 *   "남은 전부"라 그 문제가 없다
 *
 * ⚠ **기본 가격이 평단가다** (분할 TP는 현재가 ±3%). 이 카드의 출발점이 본전 청산이라
 *   그렇고, 값은 자유롭게 바꿀 수 있다
 */
export function SplitSLCard({ posData, side, tpsl, lastPrice, onAddPartialSl, onCancelPartialSl, embedded }) {
  const { theme } = useTheme();
  const isLong = side === "LONG";
  const [pct, setPct] = usePersistedPct("partialSlPct");
  // 평단가를 기본값으로 — 사용자가 고치면 60초 잠기는 건 다른 카드와 같다
  const [price, setPrice] = useAutoUpdatedPrice(
    posData?.entryPrice || lastPrice || 0,
    () => posData?.entryPrice ?? null,
  );

  if (!posData) return null;

  const color      = isLong ? PALETTE.long : PALETTE.short;
  const partialSls = tpsl?.partialSls ?? [];
  const allocQty   = partialSls.reduce((s, o) => s + o.qty, 0);
  const remaining  = Math.max(0, posData.size - allocQty);

  // 슬라이더는 **잔여 대비 %** — 분할 TP와 같은 규칙이다. 끝까지 밀면 "남은 것 전부"
  const floor3     = (v) => Math.floor(v * 1000) / 1000;
  const addQty     = Math.min(parseFloat((remaining * pct / 100).toFixed(3)), floor3(remaining));
  const priceNum   = parseFloat(price);

  // ⚠ 판정 기준이 **현재가**다 (분할 TP는 진입가 기준). 손절은 트리거 주문이라
  //   잘못된 쪽에 걸면 바이낸스가 "즉시 발동할 주문"이라며 -2021로 거절한다.
  //   롱 손절은 현재가 아래, 숏 손절은 위여야 한다
  const mark        = lastPrice || 0;
  const directionOk = mark > 0 && (isLong ? priceNum < mark : priceNum > mark);
  const valid       = priceNum > 0 && addQty >= 0.001 && directionOk;
  const full        = remaining < 0.001;   // 분할 SL이 포지션을 다 덮은 상태

  return (
    <CardWrapper embedded={embedded} title="분할 SL">
      {partialSls.map(o => (
        <div key={o.orderId} style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "5px 8px", marginBottom: "4px",
          borderRadius: "4px", background: `${color}18`, border: `1px solid ${color}44` }}>
          <span style={{ fontSize: "11px", color }}>
            ${o.price?.toLocaleString()} · {o.qty.toFixed(3)} BTC
          </span>
          <button onClick={() => onCancelPartialSl(o.orderId)}
            style={iconBtn(PALETTE.short, "12px")}>✕</button>
        </div>
      ))}

      {partialSls.length > 0 && remaining > 0.0001 && (
        <div style={{ fontSize: "10px", color: theme.textFaint,
          marginBottom: "6px", padding: "2px 2px" }}>
          잔여 {remaining.toFixed(3)} BTC
        </div>
      )}

      <PriceField
        price={price} onChange={setPrice}
        error={priceNum > 0 && !directionOk
          ? (isLong ? "▲ LONG 분할 SL은 현재가보다 낮아야 합니다 (위는 분할 TP)"
                    : "▼ SHORT 분할 SL은 현재가보다 높아야 합니다 (아래는 분할 TP)")
          : null}
      />

      {full ? (
        <div style={{ fontSize: "11px", color: theme.textFaint, textAlign: "center",
          padding: "8px 6px", marginBottom: "6px",
          background: theme.bgCard, borderRadius: "4px" }}>
          분할 SL이 포지션 전체를 덮고 있습니다 — 추가하려면 기존 항목을 지우세요
        </div>
      ) : (
        <PercentSlider
          pct={pct} onChange={setPct} color={color}
          label="수량" secondaryText={`${pct}% (${addQty} BTC)`}
        />
      )}

      <SubmitButton
        disabled={!valid} color={color}
        onClick={() => onAddPartialSl(side, parseFloat(price), addQty)}
      >
        {isLong ? "▲ 분할 SL 추가" : "▼ 분할 SL 추가"}
      </SubmitButton>
    </CardWrapper>
  );
}
