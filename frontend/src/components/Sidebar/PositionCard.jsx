import * as d3 from "d3";
import { useState } from "react";
import { useTheme } from "../../ThemeContext";


export function PositionCard({ position, tpsl, tpslSaving, onClose, onSwap, lastPrice }) {
  const { theme } = useTheme();
  const [closePct, setClosePct] = useState(() => Number(localStorage.getItem("closePct")) || 100);
  const handleClosePct = v => { setClosePct(v); localStorage.setItem("closePct", v); };
  const [confirming, setConfirming]         = useState(false);
  const [swapConfirming, setSwapConfirming] = useState(false);

  if (!position?.open) return null;

  const fmtI = p => `$${d3.format(",.0f")(p)}`;
  const fmt  = p => `$${d3.format(",.2f")(p)}`;

  const isLong     = position.side === "LONG";
  const posColor   = isLong ? "#0ecb81" : "#f6465d";
  const tpPrice    = tpsl.tp?.price ?? null;
  const slPrice    = tpsl.sl?.price ?? null;
  const slInProfit = slPrice !== null && (isLong ? slPrice >= position.entryPrice : slPrice <= position.entryPrice);
  const rrVal      = (tpPrice && slPrice)
    ? slInProfit ? "∞"
    : (Math.abs(tpPrice - position.entryPrice) / Math.abs(slPrice - position.entryPrice)).toFixed(2)
    : null;
  const slPnl = slPrice
    ? position.size * (isLong ? slPrice - position.entryPrice : position.entryPrice - slPrice)
    : null;

  const closeQty = parseFloat((position.size * closePct / 100).toFixed(3));

  return (
    <div style={{ marginBottom:"12px" }}>
      <div style={{ padding:"10px",
        border:`1px solid ${posColor}33`, borderLeft:`2px solid ${posColor}`,
        borderRadius:"5px", marginBottom:"10px" }}>
        <div style={{ fontSize:"13px", color:posColor, fontWeight:"700", marginBottom:"8px" }}>
          {isLong ? "▲ LONG" : "▼ SHORT"} 포지션
        </div>
        {[
          ["청산가",     position.liquidationPrice ? fmtI(position.liquidationPrice) : "—",                      "#ff4444"],
          ["손익비 R:R", rrVal ? `1 : ${rrVal}` : "—",                                                           "#a78bfa"],
          ["수량",       `${position.size} BTC`,                                                                   "#94a3b8"],
          ["포지션 USD", fmtI(position.size * position.entryPrice),                                               "#94a3b8"],
          ["예상 손실",  slPnl !== null ? `${slPnl >= 0 ? "+" : ""}${fmt(slPnl)}` : "—",                         slPnl !== null && slPnl >= 0 ? "#0ecb81" : "#f6465d"],
          ["예상 수익",  tpPrice ? `+${fmt(position.size * Math.abs(tpPrice - position.entryPrice))}` : "—",     "#0ecb81"],
          ["미실현",     `${position.unrealizedPnl>=0?"+":""}${fmt(position.unrealizedPnl)}`,                    position.unrealizedPnl >= 0 ? "#0ecb81" : "#f6465d"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ display:"flex", justifyContent:"space-between",
            padding:"3px 0", borderBottom:`1px solid ${theme.border}` }}>
            <span style={{ fontSize:"12px", color:theme.textMuted }}>{l}</span>
            <span style={{ fontSize:"13px", color:c, fontWeight:"600" }}>{v}</span>
          </div>
        ))}

      </div>

      {/* 청산 슬라이더 */}
      <div style={{ marginBottom:"8px", display:"flex", flexDirection:"column", gap:"6px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:"12px", color:theme.textMuted, letterSpacing:"0.06em" }}>시장가 청산</span>
          <span style={{ fontSize:"15px", color:posColor, fontWeight:"700" }}>
            {closePct}%
            <span style={{ fontSize:"11px", color:theme.textMuted, fontWeight:"400", marginLeft:"6px" }}>
              ({closeQty} BTC)
            </span>
          </span>
        </div>
        <input
          type="range" min={0} max={100} step={5} value={closePct}
          onChange={e => { handleClosePct(Math.max(5, Number(e.target.value))); setConfirming(false); }}
          style={{ width:"100%", accentColor:posColor, cursor:"pointer", height:"3px" }}
        />
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:"11px", color:theme.textBare }}>
          <span>0%</span><span>100%</span>
        </div>
        {confirming ? (
          <div style={{ display:"flex", gap:"6px" }}>
            <button
              onClick={() => { setConfirming(false); onClose(position.side, closeQty, closePct < 100); }}
              style={{
                flex:1, padding:"9px 0", borderRadius:"5px",
                cursor:"pointer", fontFamily:"inherit",
                fontSize:"13px", fontWeight:"700",
                background:"#60a5fa", border:"1px solid #60a5fa", color:"#fff",
              }}
            >✓ 확인</button>
            <button
              onClick={() => setConfirming(false)}
              style={{
                flex:1, padding:"9px 0", borderRadius:"5px",
                cursor:"pointer", fontFamily:"inherit",
                fontSize:"13px", fontWeight:"700",
                background:"transparent", border:`1px solid ${theme.borderSec}`, color:theme.textMuted,
              }}
            >✕ 취소</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            style={{
              width:"100%", padding:"9px 0", borderRadius:"5px",
              cursor:"pointer", fontFamily:"inherit",
              fontSize:"13px", fontWeight:"700",
              background:"transparent", border:"1px solid #60a5fa", color:"#60a5fa",
              transition:"background 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background="#60a5fa22"; }}
            onMouseLeave={e => { e.currentTarget.style.background="transparent"; }}
          >
            청산 {closePct === 100 ? "(전체)" : `(${closePct}%)`}
          </button>
        )}
      </div>

      {/* 스왑 */}
      {swapConfirming ? (
        <div style={{ marginBottom:"8px", padding:"10px", borderRadius:"5px",
          background: theme.bgCardAlt, border:`1px solid #a78bfa44` }}>
          <div style={{ fontSize:"12px", color:"#a78bfa", fontWeight:"700", marginBottom:"6px" }}>
            ⇄ {isLong ? "LONG → SHORT" : "SHORT → LONG"} 스왑
          </div>
          <div style={{ fontSize:"11px", color:theme.textMuted, marginBottom:"8px", lineHeight:"1.8" }}>
            수량 {position.size} BTC<br />
            TP {lastPrice ? `$${Math.round(lastPrice * (isLong ? 0.98 : 1.02)).toLocaleString()}` : "—"}<br />
            SL {lastPrice ? `$${Math.round(lastPrice * (isLong ? 1.02 : 0.98)).toLocaleString()}` : "—"}
          </div>
          <div style={{ display:"flex", gap:"6px" }}>
            <button
              onClick={() => { setSwapConfirming(false); onSwap(lastPrice); }}
              style={{
                flex:1, padding:"8px 0", borderRadius:"5px",
                cursor:"pointer", fontFamily:"inherit",
                fontSize:"12px", fontWeight:"700",
                background:"#a78bfa", border:"none", color:"#000",
              }}
            >✓ 확인</button>
            <button
              onClick={() => setSwapConfirming(false)}
              style={{
                flex:1, padding:"8px 0", borderRadius:"5px",
                cursor:"pointer", fontFamily:"inherit",
                fontSize:"12px", fontWeight:"700",
                background:"transparent", border:`1px solid ${theme.borderSec}`, color:theme.textMuted,
              }}
            >✕ 취소</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setConfirming(false); setSwapConfirming(true); }}
          style={{
            width:"100%", padding:"8px 0", borderRadius:"5px", marginBottom:"8px",
            cursor:"pointer", fontFamily:"inherit",
            fontSize:"12px", fontWeight:"700",
            background:"transparent", border:`1px solid #a78bfa66`, color:"#a78bfa",
            transition:"background 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background="#a78bfa22"; }}
          onMouseLeave={e => { e.currentTarget.style.background="transparent"; }}
        >
          ⇄ {isLong ? "LONG → SHORT" : "SHORT → LONG"} 스왑
        </button>
      )}

      {tpslSaving && (
        <div style={{ padding:"8px 10px", background:theme.bgWarning, border:"1px solid #f0b90b33",
          borderRadius:"5px", fontSize:"12px", color:"#f0b90b", textAlign:"center" }}>
          ⏳ TP/SL 수정 중...
        </div>
      )}
    </div>
  );
}

export function PendingCard({ pending }) {
  const { theme } = useTheme();
  if (!pending) return null;
  return (
    <div style={{ padding:"10px", background:theme.bgCardAlt, border:"1px solid #f0b90b33",
      borderLeft:"2px solid #f0b90b", borderRadius:"5px", marginBottom:"12px" }}>
      <div style={{ fontSize:"13px", color:"#f0b90b", fontWeight:"700", marginBottom:"6px" }}>
        ⏳ 체결 대기중
      </div>
      <div style={{ fontSize:"12px", color:"#4b5563" }}>
        방향 <span style={{ color: pending.side==="BUY" ? "#0ecb81" : "#f6465d", fontWeight:"600" }}>
          {pending.side==="BUY" ? "LONG" : "SHORT"}
        </span> / {pending.qty} BTC
      </div>
      {pending.price && (
        <div style={{ fontSize:"11px", color:"#6b7280", marginTop:"4px" }}>
          진입가 ${pending.price.toLocaleString()}
        </div>
      )}
      <div style={{ marginTop:"6px", fontSize:"11px", color:theme.textFaint }}>
        체결 시 TP/SL 자동 등록
      </div>
    </div>
  );
}
