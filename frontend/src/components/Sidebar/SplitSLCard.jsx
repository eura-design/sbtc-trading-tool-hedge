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
  // ── 기본 가격 (2026-08-24) ────────────────────────────────────────────────
  //
  // **평단가를 쓰되, 그게 유효하지 않으면 현재가에서 3% 떨어뜨린다.**
  //
  //   수익 중  -> 평단가        이 카드의 목적이 "본전까지 오면 절반 청산"이다
  //   손실 중  -> 현재가 ∓3%    평단이 현재가 반대편이라 그대로 두면 즉시 발동으로 거절된다
  //
  // ⚠ 손절은 **현재가 반대편**이어야 한다 (롱은 아래·숏은 위). 분할 TP가 유리한 쪽으로
  //   3% 떨어뜨리는 것과 **방향이 반대다** — 한쪽을 보고 다른 쪽을 맞추지 말 것
  // ⚠ 손실 중에는 애초에 "본전 청산"이 성립하지 않는다. 그 자리에 걸고 싶으면
  //   그건 익절이므로 분할 TP 카드다 (가격을 잘못 넣으면 아래 안내가 그렇게 알려준다)
  const [price, setPrice] = useAutoUpdatedPrice(
    posData?.entryPrice || lastPrice || 0,
    () => {
      const entry = posData?.entryPrice;
      const mark  = lastPrice;
      if (!mark) return entry ?? null;
      const entryUsable = entry != null && (isLong ? entry < mark : entry > mark);
      return entryUsable ? entry : mark * (isLong ? 0.97 : 1.03);
    },
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

      {/* ⚠ 잔여가 0일 때 띄우던 `분할 SL이 포지션 전체를 덮고 있습니다 — 추가하려면
             기존 항목을 지우세요` 안내는 2026-08-24 사용자 요청으로 제거했다.
             슬라이더는 그대로 두고 `추가` 버튼만 비활성이 된다 (`valid` 가 addQty 를 본다).
             ※ 분할 TP 카드에는 같은 안내가 아직 남아 있다 — 여기만 뺀 것이다 */}
      <PercentSlider
        pct={pct} onChange={setPct} color={color}
        label="수량" secondaryText={`${pct}% (${addQty} BTC)`}
      />

      <SubmitButton
        disabled={!valid} color={color}
        onClick={() => onAddPartialSl(side, parseFloat(price), addQty)}
      >
        {isLong ? "▲ 분할 SL 추가" : "▼ 분할 SL 추가"}
      </SubmitButton>
    </CardWrapper>
  );
}
