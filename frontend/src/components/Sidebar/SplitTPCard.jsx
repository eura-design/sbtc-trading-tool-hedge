import { useState, useEffect, useRef } from "react";
import { useTheme } from "../../ThemeContext";

export function SplitTPCard({ posData, side, tpsl, lastPrice, onAddSplitTp, onCancelSplitTp, embedded }) {
  const { theme } = useTheme();
  const [price, setPrice] = useState(() => String(Math.round(lastPrice || posData?.entryPrice || 0)));
  const [pct,   setPct]   = useState(() => Number(localStorage.getItem("splitTpPct")) || 50);

  const isLong         = side === "LONG";
  const userEditedRef  = useRef(false);
  const lastPriceRef   = useRef(lastPrice);
  const resumeTimerRef = useRef(null);
  lastPriceRef.current = lastPrice;

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

  if (!posData) return null;

  const color    = isLong ? "#0ecb81" : "#f6465d";
  const splitTps = tpsl?.splitTps ?? [];
  const allocQty   = splitTps.reduce((s, o) => s + o.qty, 0);
  const remaining  = Math.max(0, posData.size - allocQty);
  const trueAddQty = posData.size * pct / 100;
  const rawAddQty  = parseFloat(trueAddQty.toFixed(3));
  const addQty     = rawAddQty > remaining ? remaining : rawAddQty;
  const priceNum   = parseFloat(price);
  const directionOk = isLong ? priceNum > posData.entryPrice : priceNum < posData.entryPrice;
  const valid      = priceNum > 0 && addQty >= 0.001 && trueAddQty <= remaining + 0.0005 && directionOk;

  const btnStyle = (active) => ({
    flex: 1, padding: "4px 0", borderRadius: "3px", cursor: "pointer",
    fontFamily: "inherit", fontSize: "11px", fontWeight: "600", border: "none",
    background: active ? `${color}33` : "transparent",
    color: active ? color : theme.textFaint,
  });

  const content = (
    <>
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

      {splitTps.length > 0 && (
        <div style={{ marginBottom: "6px" }}>
          {allocQty > posData.size + 0.0001 && (
            <div style={{ fontSize: "10px", color: "#f6465d", marginBottom: "4px",
              padding: "4px 6px", background: "#f6465d18", borderRadius: "3px" }}>
              ⚠ 분할 TP 합계 {allocQty.toFixed(3)} BTC &gt; 포지션 {posData.size} BTC
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
            잔여: {remaining.toFixed(3)} BTC ({((remaining / posData.size) * 100).toFixed(0)}%)
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: priceNum > 0 && !directionOk ? "4px" : "8px" }}>
        <span style={{ fontSize: "11px", color: theme.textMuted, flexShrink: 0 }}>가격</span>
        <input
          type="number" value={price}
          onChange={e => {
            userEditedRef.current = true;
            setPrice(e.target.value);
            clearTimeout(resumeTimerRef.current);
            resumeTimerRef.current = setTimeout(() => { userEditedRef.current = false; }, 60000);
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
        onClick={() => onAddSplitTp(side, parseFloat(price), addQty, pct)}
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
    </>
  );

  if (embedded) return content;

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
      {content}
    </div>
  );
}
