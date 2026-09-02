import { useTheme } from "../../ThemeContext";
import { PALETTE } from "../../constants";
import { usePersistedNum, PercentSlider, CountSlider, ChartPickButton, useChartPick, CardWrapper, CancelAllButton } from "./cardControls";
import { iconBtn } from "../sidebarBtn";
import { qtyLabel } from "../../utils/qty";
import { useStore } from "../../store";

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
 *   경보가 `일부만 덮습니다 (0.140 / 0.190)`으로 알려준다
 *
 * ⚠ **가격은 차트에서 정한다** (2026-08-27 사용자 요청). 예전에는 기본값이 **평단가**였고
 *   (이 카드의 출발점이 본전 청산이라), 평단이 현재가 반대편이면 현재가에서 3% 떨어뜨렸다.
 *   그 계산(`useAutoUpdatedPrice`의 compute)은 통째로 사라졌다 — 차트를 누른 자리가 곧
 *   가격이라 기본값이라 할 게 없다.
 *   방향 검증(롱은 현재가 아래·숏은 위, 아니면 -2021 거절)은 `placeSplitOrders`가
 *   **주문을 내는 순간** 살아 있는 현재가로 한다
 *
 * ⚠ 개수를 늘릴수록 **찌꺼기도 늘어난다** — 수량을 지정한 트리거 주문은 포지션이
 *   0이 돼도 거래소에 남는다(2026-08-24 ETH 실측). 정리는 orderWatcher의
 *   `STALE_TRIGGER_CANCELED`가 맡지만 그만큼 여러 건이 생긴다
 */
export function SplitSLCard({ posData, side, tpsl, onCancelPartialSl, embedded }) {
  const { theme } = useTheme();
  // 수량 자릿수와 코인 이름은 심볼마다 다르다 (SOL 0.01 / DOGE 1)
  const { step: qStep, base: qBase } = useStore(s => s.symbolFilters);
  const isLong = side === "LONG";
  const [pct, setPct]     = usePersistedNum("partialSlPct", 50);
  const [count, setCount] = usePersistedNum("partialSlCount", 3);

  const color      = isLong ? PALETTE.long : PALETTE.short;
  const partialSls = tpsl?.partialSls ?? [];
  const allocQty   = partialSls.reduce((s, o) => s + o.qty, 0);
  const remaining  = Math.max(0, (posData?.size ?? 0) - allocQty);

  // 슬라이더는 **잔여 대비 %** — 분할 TP와 같은 규칙이다. 끝까지 밀면 "남은 것 전부"
  const floor3 = (v) => Math.floor(v * 1000) / 1000;
  const addQty = Math.min(parseFloat((remaining * pct / 100).toFixed(3)), floor3(remaining));

  const pick = useChartPick({ kind: "partial_sl", side, count, qty: addQty });

  if (!posData) return null;

  return (
    <CardWrapper embedded={embedded} title="분할 SL">
      {partialSls.map(o => (
        <div key={o.orderId} style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "5px 8px", marginBottom: "4px",
          borderRadius: "4px", background: `${color}18`, border: `1px solid ${color}44` }}>
          <span style={{ fontSize: "11px", color }}>
            ${o.price?.toLocaleString()} · {qtyLabel(o.qty, qStep, qBase)}
          </span>
          <button onClick={() => onCancelPartialSl(o.orderId)}
            style={iconBtn(PALETTE.short, "12px")}>✕</button>
        </div>
      ))}

      <CancelAllButton kind="partial_sl" side={side} count={partialSls.length} />

      {partialSls.length > 0 && remaining > 0.0001 && (
        <div style={{ fontSize: "10px", color: theme.textFaint,
          marginBottom: "6px", padding: "2px 2px" }}>
          잔여 {qtyLabel(remaining, qStep, qBase)}
        </div>
      )}

      {/* ⚠ 잔여가 0일 때 띄우던 `분할 SL이 포지션 전체를 덮고 있습니다` 안내는
             2026-08-24 사용자 요청으로 제거했다. 슬라이더는 그대로 두고 버튼만
             비활성이 된다. ※ 분할 TP 카드에는 같은 안내가 아직 남아 있다 */}
      <PercentSlider
        pct={pct} onChange={setPct} color={color}
        label="수량" secondaryText={`${pct}% (${addQty} BTC)`}
      />
      <CountSlider count={count} onChange={setCount} qty={addQty} color={color} />

      <ChartPickButton active={pick.active} onToggle={pick.toggle}
        disabled={addQty < 0.001} color={color} count={count} qty={addQty} />
    </CardWrapper>
  );
}
