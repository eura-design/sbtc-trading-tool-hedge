import * as d3 from "d3";
import { useState } from "react";
import { useTheme } from "../../ThemeContext";
import { ScaleInCard } from "./ScaleInCard";
import { SplitTPCard } from "./SplitTPCard";

function AccordionSection({ label, badge, isOpen, onToggle, theme, posColor, children }) {
  return (
    <>
      <button
        onClick={onToggle}
        style={{
          width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"8px 0 6px", background:"transparent", border:"none", cursor:"pointer",
          borderTop:`1px solid ${theme.border}`,
        }}
      >
        <span style={{ fontSize:"12px", color:theme.textMuted, fontWeight:"600", letterSpacing:"0.05em" }}>
          {label}
          {badge != null && badge > 0 && (
            <span style={{
              marginLeft:"6px", fontSize:"10px", fontWeight:"700",
              color:"#60a5fa", background:"#60a5fa22",
              padding:"1px 5px", borderRadius:"8px",
            }}>{badge}</span>
          )}
        </span>
        <span style={{ fontSize:"10px", color:theme.textFaint }}>{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <div style={{ paddingTop:"8px" }}>
          {children}
        </div>
      )}
    </>
  );
}

export function PositionCard({
  posData, side, tpsl, tpslSaving, onClose, lastPrice,
  scaleInOrders, onScaleIn, onCancelScaleIn,
  onAddSplitTp, onCancelSplitTp,
}) {
  const { theme } = useTheme();
  const [closePct, setClosePct] = useState(() => Number(localStorage.getItem("closePct")) || 100);
  const handleClosePct = v => { setClosePct(v); localStorage.setItem("closePct", v); };
  const [confirming, setConfirming] = useState(false);
  const [scaleInOpen, setScaleInOpen] = useState(() => localStorage.getItem(`accordion_scaleIn_${side}`) === "true");
  const [splitTPOpen, setSplitTPOpen] = useState(() => localStorage.getItem(`accordion_splitTP_${side}`) === "true");
  const [expanded, setExpanded] = useState(() => localStorage.getItem(`accordion_pos_${side}`) !== "false");
  const toggleExpanded  = () => setExpanded(v  => { const n = !v; localStorage.setItem(`accordion_pos_${side}`,     n); return n; });
  const toggleScaleIn   = () => setScaleInOpen(v => { const n = !v; localStorage.setItem(`accordion_scaleIn_${side}`, n); return n; });
  const toggleSplitTP   = () => setSplitTPOpen(v => { const n = !v; localStorage.setItem(`accordion_splitTP_${side}`, n); return n; });

  if (!posData) return null;

  const fmtI = p => `$${d3.format(",.0f")(p)}`;
  const fmt  = p => `$${d3.format(",.2f")(p)}`;

  const isLong     = side === "LONG";
  const posColor   = isLong ? "#0ecb81" : "#f6465d";
  const tpPrice    = tpsl.tp?.price ?? null;
  const slPrice    = tpsl.sl?.price ?? null;
  const slInProfit = slPrice !== null && (isLong ? slPrice >= posData.entryPrice : slPrice <= posData.entryPrice);
  const rrVal      = (tpPrice && slPrice)
    ? slInProfit ? "∞"
    : (Math.abs(tpPrice - posData.entryPrice) / Math.abs(slPrice - posData.entryPrice)).toFixed(2)
    : null;
  const slPnl = slPrice
    ? posData.size * (isLong ? slPrice - posData.entryPrice : posData.entryPrice - slPrice)
    : null;

  const closeQty = parseFloat((posData.size * closePct / 100).toFixed(3));
  const splitTpCount = tpsl?.splitTps?.length ?? 0;

  return (
    <div style={{
      marginBottom:"12px", padding:"10px",
      border:`1px solid ${posColor}33`, borderLeft:`2px solid ${posColor}`,
      borderRadius:"5px",
    }}>
      {/* 포지션 헤더 — 클릭으로 접기/펼치기 */}
      <button
        onClick={toggleExpanded}
        style={{
          width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
          background:"transparent", border:"none", cursor:"pointer", padding:0,
          marginBottom: expanded ? "8px" : 0,
        }}
      >
        <span style={{ fontSize:"13px", color:posColor, fontWeight:"700" }}>
          {isLong ? "▲ LONG" : "▼ SHORT"} 포지션
        </span>
        <span style={{ fontSize:"10px", color:theme.textFaint }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && <>
      {/* 포지션 정보 rows */}
      {[
        ["청산가",     posData.liquidationPrice ? fmtI(posData.liquidationPrice) : "—",                     "#ff4444"],
        ["손익비 R:R", rrVal ? `1 : ${rrVal}` : "—",                                                        "#a78bfa"],
        ["수량",       `${posData.size} BTC`,                                                                "#94a3b8"],
        ["포지션 USD", fmtI(posData.size * posData.entryPrice),                                              "#94a3b8"],
        ["예상 손실",  slPnl !== null ? `${slPnl >= 0 ? "+" : ""}${fmt(slPnl)}` : "—",                      slPnl !== null && slPnl >= 0 ? "#0ecb81" : "#f6465d"],
        ["예상 수익",  tpPrice ? `+${fmt(posData.size * Math.abs(tpPrice - posData.entryPrice))}` : "—",    "#0ecb81"],
        ["미실현",     `${posData.unrealizedPnl>=0?"+":""}${fmt(posData.unrealizedPnl)}`,                   posData.unrealizedPnl >= 0 ? "#0ecb81" : "#f6465d"],
      ].map(([l, v, c]) => (
        <div key={l} style={{ display:"flex", justifyContent:"space-between",
          padding:"3px 0", borderBottom:`1px solid ${theme.border}` }}>
          <span style={{ fontSize:"12px", color:theme.textMuted }}>{l}</span>
          <span style={{ fontSize:"13px", color:c, fontWeight:"600" }}>{v}</span>
        </div>
      ))}

      {/* 청산 */}
      <div style={{ marginTop:"10px", display:"flex", flexDirection:"column", gap:"6px" }}>
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
              onClick={() => { setConfirming(false); onClose(side, closeQty, closePct < 100); }}
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

      {tpslSaving && (
        <div style={{ marginTop:"8px", padding:"8px 10px", background:theme.bgWarning,
          border:"1px solid #f0b90b33", borderRadius:"5px",
          fontSize:"12px", color:"#f0b90b", textAlign:"center" }}>
          ⏳ TP/SL 수정 중...
        </div>
      )}

      {/* 아코디언: 추가 진입 */}
      <AccordionSection
        label="추가 진입"
        badge={scaleInOrders?.length}
        isOpen={scaleInOpen}
        onToggle={toggleScaleIn}
        theme={theme}
        posColor={posColor}
      >
        <ScaleInCard
          embedded
          posData={posData}
          side={side}
          lastPrice={lastPrice}
          onScaleIn={onScaleIn}
          scaleInOrders={scaleInOrders}
          onCancelScaleIn={onCancelScaleIn}
        />
      </AccordionSection>

      {/* 아코디언: 분할 TP */}
      <AccordionSection
        label="분할 TP"
        badge={splitTpCount}
        isOpen={splitTPOpen}
        onToggle={toggleSplitTP}
        theme={theme}
        posColor={posColor}
      >
        {tpsl?.tp && (
          <div style={{ fontSize:"10px", color:"#f0b90b", marginBottom:"6px" }}>
            등록 시 단일 TP 취소됨
          </div>
        )}
        <SplitTPCard
          embedded
          posData={posData}
          side={side}
          tpsl={tpsl}
          lastPrice={lastPrice}
          onAddSplitTp={onAddSplitTp}
          onCancelSplitTp={onCancelSplitTp}
        />
      </AccordionSection>
      </>}
    </div>
  );
}

export function PendingCard({ pending }) {
  const { theme } = useTheme();
  if (!pending) return null;

  const isLong   = pending.side === "BUY";
  const posColor = isLong ? "#0ecb81" : "#f6465d";
  const fmtI     = p => `$${d3.format(",.0f")(p)}`;

  return (
    <div style={{
      marginBottom:"12px", padding:"10px",
      border:`1px solid ${posColor}33`, borderLeft:`2px solid ${posColor}`,
      borderRadius:"5px",
    }}>
      <div style={{ fontSize:"13px", color:posColor, fontWeight:"700", marginBottom:"8px" }}>
        {isLong ? "▲ LONG" : "▼ SHORT"} 체결 대기중
      </div>
      {[
        ["청산가",     "—",                                                                          "#ff4444"],
        ["손익비 R:R", "—",                                                                          "#a78bfa"],
        ["수량",       `${pending.qty} BTC`,                                                        "#94a3b8"],
        ["포지션 USD", pending.price ? fmtI(pending.qty * pending.price) : "—",                    "#94a3b8"],
        ["예상 손실",  "—",                                                                          "#f6465d"],
        ["예상 수익",  "—",                                                                          "#0ecb81"],
        ["미실현",     "—",                                                                          theme.textFaint],
      ].map(([l, v, c]) => (
        <div key={l} style={{ display:"flex", justifyContent:"space-between",
          padding:"3px 0", borderBottom:`1px solid ${theme.border}` }}>
          <span style={{ fontSize:"12px", color:theme.textMuted }}>{l}</span>
          <span style={{ fontSize:"13px", color:c, fontWeight:"600" }}>{v}</span>
        </div>
      ))}
      <div style={{ marginTop:"8px", fontSize:"11px", color:theme.textFaint, textAlign:"right" }}>
        체결 시 TP/SL 자동 등록
      </div>
    </div>
  );
}
