import { useState, useEffect, useRef } from "react";
import { useTheme } from "../../ThemeContext";

export function SplitTPCard({ position, tpsl, lastPrice, onAddSplitTp, onCancelSplitTp }) {
  const { theme } = useTheme();
  const [price, setPrice] = useState(() => String(Math.round(lastPrice || position?.entryPrice || 0)));
  const [pct,   setPct]   = useState(() => Number(localStorage.getItem("splitTpPct")) || 50);

  if (!position?.open) return null;

  const isLong         = position.side === "LONG";
  const userEditedRef  = useRef(false);
  const lastPriceRef   = useRef(lastPrice);
  const resumeTimerRef = useRef(null);
  lastPriceRef.current = lastPrice;

  // 5초마다 현재가 ±2% 자동 계산 (TP: LONG=+2%, SHORT=-2%)
  // 사용자가 직접 입력하면 1분 후 자동 계산 재개
  useEffect(() => {
    userEditedRef.current = false;
    clearTimeout(resumeTimerRef.current);
    const calc = () => {
      if (!userEditedRef.current && lastPriceRef.current) {
        setPrice(String(Math.round(lastPriceRef.current * (isLong ? 1.03 : 0.97))));
      }
    };
    calc();
    const id = setInterval(calc, 5000);
    return () => { clearInterval(id); clearTimeout(resumeTimerRef.current); };
  }, [isLong]);
  const color     = isLong ? "#0ecb81" : "#f6465d";
  const splitTps  = tpsl?.splitTps ?? [];
  const allocQty    = splitTps.reduce((s, o) => s + o.qty, 0);
  const remaining   = Math.max(0, position.size - allocQty);
  // trueAddQty: 반올림 전 정확한 수량 (활성화 판단용)
  const trueAddQty  = position.size * pct / 100;
  // rawAddQty: toFixed(3) 반올림 적용 (실제 주문 수량 기반)
  const rawAddQty   = parseFloat(trueAddQty.toFixed(3));
  // addQty: 잔여를 초과하면 잔여로 클램프 (반올림 오차 보정)
  const addQty      = rawAddQty > remaining ? remaining : rawAddQty;
  const priceNum    = parseFloat(price);
  const directionOk = isLong ? priceNum > position.entryPrice : priceNum < position.entryPrice;
  // trueAddQty 기준 비교: toFixed(3) 단일 반올림 최대 오차(0.0005)만 허용
  // → 50%+50% 같이 비대칭 반올림으로 생기는 미세 오차는 허용
  // → 75%/100% 처럼 잔여를 명확히 초과하는 경우는 비활성
  const valid       = priceNum > 0 && addQty >= 0.001 && trueAddQty <= remaining + 0.0005 && directionOk;

  const btnStyle = (active) => ({
    flex: 1, padding: "4px 0", borderRadius: "3px", cursor: "pointer",
    fontFamily: "inherit", fontSize: "11px", fontWeight: "600", border: "none",
    background: active ? `${color}33` : "transparent",
    color: active ? color : theme.textFaint,
  });

  return (
    <div style={{ padding: "10px", border: `1px solid ${theme.borderSec}`,
      borderRadius: "5px", marginBottom: "10px" }}>

      <div style={{ fontSize: "12px", color: theme.textMuted, fontWeight: "600",
        letterSpacing: "0.05em", marginBottom: "8px" }}>
        분할 TP
        {tpsl?.tp && (
          <span style={{ fontSize: "10px", color: "#f0b90b", marginLeft: "6px" }}>
            (등록 시 단일 TP 취소됨)
          </span>
        )}
      </div>

      {/* 등록된 분할 TP 목록 */}
      {splitTps.map(o => (
        <div key={o.orderId} style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "5px 8px", marginBottom: "4px",
          borderRadius: "4px", background: `${color}18`, border: `1px solid ${color}44` }}>
          <span style={{ fontSize: "11px", color }}>
            ${o.price?.toLocaleString()} · {o.qty.toFixed(3)} BTC{o.pct ? ` (${o.pct}%)` : ""}
          </span>
          <button onClick={() => onCancelSplitTp(o.orderId)} style={{
            background: "none", border: "none", color: "#f6465d",
            cursor: "pointer", fontSize: "12px", fontWeight: "700", padding: "0 2px",
          }}>✕</button>
        </div>
      ))}

      {/* 잔여 수량 표시 */}
      {splitTps.length > 0 && (
        <div style={{ marginBottom: "6px" }}>
          {allocQty > position.size + 0.0001 && (
            <div style={{ fontSize: "10px", color: "#f6465d", marginBottom: "4px",
              padding: "4px 6px", background: "#f6465d18", borderRadius: "3px" }}>
              ⚠ 분할 TP 합계 {allocQty.toFixed(3)} BTC &gt; 포지션 {position.size} BTC
              — 부분 청산 후 초과분은 바이낸스에서 자동 취소됩니다
            </div>
          )}
          {remaining > 0.0001 && allocQty > 0.0001 && (
            <div style={{ fontSize: "10px", color: "#f0b90b", marginBottom: "4px",
              padding: "4px 6px", background: "#f0b90b18", borderRadius: "3px" }}>
              ⚠ {remaining.toFixed(3)} BTC 미커버 — 추매 등으로 포지션이 늘었다면 분할 TP를 추가 등록하세요
            </div>
          )}
          <div style={{ fontSize: "11px", color: theme.textFaint, textAlign: "right" }}>
            잔여: {remaining.toFixed(3)} BTC ({((remaining / position.size) * 100).toFixed(0)}%)
          </div>
        </div>
      )}

      {/* 가격 입력 */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: priceNum > 0 && !directionOk ? "4px" : "8px" }}>
        <span style={{ fontSize: "11px", color: theme.textMuted, flexShrink: 0 }}>가격</span>
        <input
          type="number" value={price}
          onChange={e => {
                userEditedRef.current = true;
                setPrice(e.target.value);
                clearTimeout(resumeTimerRef.current);
                resumeTimerRef.current = setTimeout(() => {
                  userEditedRef.current = false;
                }, 60000);
              }}
          style={{
            flex: 1, padding: "4px 6px", borderRadius: "4px",
            background: theme.bgCard,
            border: `1px solid ${priceNum > 0 && !directionOk ? "#f6465d" : theme.borderSec}`,
            color: theme.textPrimary, fontSize: "12px", fontFamily: "inherit", outline: "none",
          }}
        />
      </div>
      {priceNum > 0 && !directionOk && (
        <div style={{ fontSize: "10px", color: "#f6465d", marginBottom: "8px" }}>
          {isLong ? "▲ LONG TP는 진입가보다 높아야 합니다" : "▼ SHORT TP는 진입가보다 낮아야 합니다"}
        </div>
      )}

      {/* 수량 슬라이더 */}
      <div style={{ marginBottom: "6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
          <span style={{ fontSize: "11px", color: theme.textMuted }}>수량</span>
          <span style={{ fontSize: "12px", color, fontWeight: "600" }}>
            {pct}% ({addQty.toFixed(3)} BTC)
          </span>
        </div>
        <input
          type="range" min={0} max={100} step={5} value={pct}
          onChange={e => {
            const v = Math.max(5, Number(e.target.value));
            setPct(v);
            localStorage.setItem("splitTpPct", v);
          }}
          style={{ width: "100%", accentColor: color, cursor: "pointer", height: "3px" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between",
          fontSize: "11px", color: theme.textBare, marginTop: "2px" }}>
          <span>0%</span><span>100%</span>
        </div>
      </div>

      <button
        disabled={!valid}
        onClick={() => onAddSplitTp(parseFloat(price), addQty, pct)}
        style={{
          width: "100%", padding: "8px 0", borderRadius: "5px",
          cursor: valid ? "pointer" : "not-allowed",
          background: "transparent",
          border: `1px solid ${valid ? color : theme.borderSec}`,
          color: valid ? color : theme.textFaint,
          fontSize: "13px", fontFamily: "inherit", fontWeight: "700",
          transition: "background 0.15s",
        }}
        onMouseEnter={e => { if (valid) e.currentTarget.style.background = `${color}22`; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      >
        {isLong ? "▲ 분할 TP 지정가 추가" : "▼ 분할 TP 지정가 추가"}
      </button>
    </div>
  );
}
