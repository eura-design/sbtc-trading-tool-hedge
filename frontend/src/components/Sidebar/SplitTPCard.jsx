import { useTheme } from "../../ThemeContext";
import { PALETTE } from "../../constants";
import { usePersistedNum, PercentSlider, CountSlider, ChartPickButton, useChartPick, CardWrapper, CancelAllButton } from "./cardControls";
import { iconBtn } from "../sidebarBtn";

/**
 * 분할 TP — 수량을 지정한 청산 방향 지정가.
 *
 * ⚠ **가격은 차트에서 정한다** (2026-08-27 사용자 요청) — `차트에서 지정`을 켜고
 *   차트를 **클릭하면 1개**, **세로로 끌면 개수만큼 균등**하게 걸린다.
 *   숫자 입력칸(`현재가 +3%` 자동 채움)과 방향 오류 문구는 그때 사라졌다.
 *   방향 검증은 `store/orderSlice.placeSplitOrders`가 **주문을 내는 순간** 한다 —
 *   버튼을 누른 시점과 손을 뗀 시점 사이에 가격이 움직이기 때문이다
 *
 * ⚠ **단일 TP를 내리지 않는다 — 둘은 공존한다** (2026-08-23 사용자 확정).
 *   `(등록 시 단일 TP 취소됨)` 경고를 되살리지 말 것: 틀린 말이 되고,
 *   "일부 익절 + 나머지 전량 익절"을 못 하는 줄 알게 된다
 */
export function SplitTPCard({ posData, side, tpsl, onCancelSplitTp, embedded }) {
  const { theme } = useTheme();
  const isLong = side === "LONG";
  const [pct, setPct]     = usePersistedNum("splitTpPct", 50);
  const [count, setCount] = usePersistedNum("splitTpCount", 3);

  const color      = isLong ? PALETTE.long : PALETTE.short;
  const splitTps   = tpsl?.splitTps ?? [];
  const allocQty   = splitTps.reduce((s, o) => s + o.qty, 0);
  const remaining  = Math.max(0, (posData?.size ?? 0) - allocQty);

  // ── ⚠ 슬라이더는 **잔여 대비 %**다 (2026-08-19 사용자 요청) ─────────────
  // 예전에는 **포지션 전체 대비 %**였다. 그래서 40%짜리를 하나 걸어 두면 슬라이더
  // 60~100 구간이 통째로 죽은 구간이 됐다 — 끌 수는 있는데 버튼이 비활성이고,
  // 표시도 "80% (0.600 BTC)"처럼 **숫자와 수량이 어긋났다**(0.600은 포지션의 60%다).
  // 지금은 어느 위치든 뜻이 있고, 끝까지 밀면 "남은 것 전부"가 된다.
  //
  // ⚠ 다만 **저장·표시되는 `pct`는 포지션 대비 그대로 둔다.** 목록의 `(40%)`와
  //   부분 청산 후 재계산(backend/utils/splitTp.js)이 전부 포지션 기준이라,
  //   여기만 잔여 기준으로 저장하면 같은 화면에서 뜻이 둘이 된다
  //   → 그 환산은 이제 `placeSplitOrders`가 **주문 하나하나마다** 한다
  //     (분할이면 조각마다 비율이 다르므로 카드에서 미리 하나로 낼 수 없다)
  const floor3 = (v) => Math.floor(v * 1000) / 1000;
  const addQty = Math.min(parseFloat((remaining * pct / 100).toFixed(3)), floor3(remaining));

  // ⚠ 훅은 early return **앞**이어야 한다 (React 규칙). 포지션이 사라지는 순간에도
  //   훅 개수가 같아야 하고, 그때 useChartPick의 정리 이펙트가 차트에 남은 주문 모드를 끈다
  const pick = useChartPick({ kind: "split_tp", side, count, qty: addQty });

  if (!posData) return null;

  const full = remaining < 0.001;   // 분할 TP가 포지션을 다 덮은 상태

  return (
    <CardWrapper embedded={embedded} title="분할 TP">
      {splitTps.map(o => (
        <div key={o.orderId} style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "5px 8px", marginBottom: "4px",
          borderRadius: "4px", background: `${color}18`, border: `1px solid ${color}44` }}>
          <span style={{ fontSize: "11px", color }}>
            ${o.price?.toLocaleString()} · {o.qty.toFixed(3)} BTC{o.pct ? ` (${o.pct}%)` : ""}
          </span>
          <button onClick={() => onCancelSplitTp(o.orderId)}
            style={iconBtn(PALETTE.short, "12px")}>✕</button>
        </div>
      ))}

      <CancelAllButton kind="split_tp" side={side} count={splitTps.length} />

      {splitTps.length > 0 && (
        <div style={{ marginBottom: "6px" }}>
          {allocQty > posData.size + 0.0001 && (
            <div style={{ fontSize: "10px", color: PALETTE.short, marginBottom: "4px",
              padding: "4px 6px", background: `${PALETTE.short}18`, borderRadius: "3px" }}>
              ⚠ 분할 TP 합계 {allocQty.toFixed(3)} BTC &gt; 포지션 {posData.size} BTC
              — 부분 청산 후 초과분은 바이낸스에서 자동 취소됩니다
            </div>
          )}
          {/* ⚠ **경고가 아니라 정보다** (2026-08-23 사용자 요청). 미커버는 추매가
                 아니어도 생긴다(처음부터 100%를 안 채우면 그만큼) — "모자라는 건 두는
                 게 맞다"가 이 앱의 원칙인데(backend/utils/splitTp.js) 그 정상 상태를
                 경고로 띄우고 있었다.
              ⚠ **지우지는 말 것** — 여기가 잔여를 보여주는 유일한 자리다 */}
          {remaining > 0.0001 && allocQty > 0.0001 && (
            <div style={{ fontSize: "10px", color: theme.textFaint, marginBottom: "4px",
              padding: "2px 2px" }}>
              잔여 {remaining.toFixed(3)} BTC
            </div>
          )}
        </div>
      )}

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
            label="수량" secondaryText={`${pct}% (${addQty} BTC)`}
          />
          <CountSlider count={count} onChange={setCount} qty={addQty} color={color} />
        </>
      )}

      <ChartPickButton active={pick.active} onToggle={pick.toggle}
        disabled={full || addQty < 0.001} color={color} count={count} qty={addQty} />
    </CardWrapper>
  );
}
