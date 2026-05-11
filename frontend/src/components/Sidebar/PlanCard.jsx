import { useState } from "react";
import * as d3 from "d3";
import { useTheme } from "../../ThemeContext";
import { calcRR } from "../../utils/format";

export function PlanCard({ drawing, posCalc, leverage, riskPct, position, hasPending, onConfirm, onCancel }) {
  const { theme } = useTheme();
  const [orderType, setOrderType] = useState("LIMIT");
  if (!drawing) return null;
  const fmtI  = p => `$${d3.format(",.0f")(p)}`;
  const fmt   = p => `$${d3.format(",.2f")(p)}`;
  const color = drawing.isLong ? "#0ecb81" : "#f6465d";
  const sameSidePos = drawing.isLong ? position?.long : position?.short;

  return (
    <div style={{ marginBottom:"12px" }}>
      <div style={{ padding:"10px",
        border:`1px solid ${color}33`, borderLeft:`2px solid ${color}`,
        borderRadius:"5px", marginBottom:"10px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
          <span style={{ fontSize:"13px", color, fontWeight:"700" }}>
            {drawing.isLong ? "▲ LONG" : "▼ SHORT"} 플랜
          </span>
          {hasPending && (
            <span style={{ fontSize:"11px", color:"#f0b90b", fontWeight:"600" }}>⏳ 체결 대기중</span>
          )}
        </div>
        {[
          ["청산가",     "—",                                                                                          "#ff4444"],
          ["손익비 R:R", `1 : ${calcRR(drawing.entry, drawing.tp, drawing.sl, drawing.isLong)}`,                     "#a78bfa"],
          ["수량",       posCalc ? `${posCalc.actualQty.toFixed(3)} BTC` : "—",                                      "#94a3b8"],
          ["포지션 USD", posCalc ? fmtI(posCalc.actualQty * drawing.entry) : "—",                                    "#94a3b8"],
          ["예상 손실",  posCalc ? `-${fmt(posCalc.actualQty * Math.abs(drawing.entry - drawing.sl))}` : "—",        "#f6465d"],
          ["예상 수익",  posCalc ? `+${fmt(posCalc.actualQty * Math.abs(drawing.tp - drawing.entry))}` : "—",        "#0ecb81"],
          ["미실현",     "—",                                                                                          theme.textFaint],
        ].map(([l, v, c]) => (
          <div key={l} style={{ display:"flex", justifyContent:"space-between",
            padding:"3px 0", borderBottom:`1px solid ${theme.border}` }}>
            <span style={{ fontSize:"12px", color:theme.textMuted }}>{l}</span>
            <span style={{ fontSize:"13px", color:c, fontWeight:"600" }}>{v}</span>
          </div>
        ))}
      </div>

      {posCalc?.isLeverageCapped && (
        <div style={{ marginBottom:"6px", padding:"8px 10px", background:theme.bgWarning,
          border:"1px solid #f6465d33", borderRadius:"5px", fontSize:"12px", lineHeight:"1.7" }}>
          <span style={{ color:"#f6465d", fontWeight:"700" }}>⚠ 레버리지 한도 조정</span>
          <span style={{ color:theme.textMuted }}> — {leverage}x 한도로 수량 제한됨</span>
        </div>
      )}
      {posCalc?.isMinCapped && (
        <div style={{ padding:"8px 10px", background:theme.bgWarning, border:"1px solid #f0b90b33",
          borderRadius:"5px", fontSize:"12px", lineHeight:"1.7", marginBottom:"6px" }}>
          <span style={{ color:"#f0b90b", fontWeight:"700" }}>⚠ 최소 수량 적용</span>
          <span style={{ color:theme.textMuted }}> — 실제 리스크 </span>
          <span style={{ color:"#f6465d", fontWeight:"700" }}>{posCalc.actualRiskPct.toFixed(2)}%</span>
        </div>
      )}

      {sameSidePos ? (
        <div style={{ padding:"10px", background:theme.bgCard, border:`1px solid #f6465d44`,
          borderLeft:`2px solid #f6465d`,
          borderRadius:"5px", fontSize:"12px", color:theme.textMuted, textAlign:"center" }}>
          {drawing.isLong ? "▲ LONG" : "▼ SHORT"} 포지션이 이미 있습니다
          <br/><span style={{ color:"#f6465d" }}>청산 후 주문 가능</span>
        </div>
      ) : hasPending ? (
        <button onClick={onCancel} style={{
          width:"100%", padding:"10px 0", borderRadius:"5px", fontSize:"13px",
          cursor:"pointer", fontFamily:"inherit", fontWeight:"700",
          background:"transparent", border:`1px solid ${color}66`, color,
          transition:"all 0.15s",
        }}>
          주문 취소
        </button>
      ) : (
        <>
          <div style={{ display:"flex", gap:"6px", marginBottom:"6px" }}>
            {["LIMIT", "MARKET"].map(t => (
              <button key={t} onClick={() => setOrderType(t)} style={{
                flex:1, padding:"7px 0", borderRadius:"5px", cursor:"pointer",
                fontSize:"12px", fontFamily:"inherit", fontWeight:"600",
                background: orderType === t ? color : "transparent",
                border:`1px solid ${orderType === t ? color : theme.borderSec}`,
                color: orderType === t ? "#000" : theme.textMuted,
                transition:"all 0.15s",
              }}>{t === "LIMIT" ? "지정가" : "시장가"}</button>
            ))}
          </div>
          {orderType === "MARKET" && (
            <div style={{ marginBottom:"6px", padding:"8px 10px", background:theme.bgMarket,
              border:"1px solid #f6465d33", borderRadius:"5px", fontSize:"12px", lineHeight:"1.7" }}>
              <span style={{ color:"#f6465d", fontWeight:"700" }}>⚠ 시장가 주의</span>
              <span style={{ color:theme.textMuted }}> — 즉시 체결, 슬리피지 발생 가능</span>
            </div>
          )}
          <div style={{ display:"flex", gap:"6px" }}>
            <button onClick={onCancel} style={{
              flex:1, padding:"10px 0", borderRadius:"5px", cursor:"pointer",
              background:"transparent", border:`1px solid ${theme.borderSec}`,
              color:theme.textMuted, fontSize:"13px", fontFamily:"inherit",
            }}>취소</button>
            <button onClick={() => onConfirm(orderType)} disabled={!posCalc} style={{
              flex:2, padding:"10px 0", borderRadius:"5px",
              cursor: posCalc ? "pointer" : "not-allowed",
              background: posCalc ? color : "#1f2937",
              border:"none", color: posCalc ? "#000" : "#374151",
              fontSize:"14px", fontFamily:"inherit", fontWeight:"700",
              transition:"all 0.15s",
            }}>{drawing.isLong ? "▲ LONG 실행" : "▼ SHORT 실행"}</button>
          </div>
        </>
      )}
    </div>
  );
}

export function OrphanPendingCard({ pending, onCancel }) {
  const { theme } = useTheme();
  const isExternal = pending?.source === "external";
  return (
    <div>
      <div style={{ padding:"10px", background:theme.bgCardAlt, border:"1px solid #f0b90b44",
        borderLeft:"2px solid #f0b90b", borderRadius:"5px", marginBottom:"12px" }}>
        <div style={{ fontSize:"13px", color:"#f0b90b", fontWeight:"700", marginBottom:"6px" }}>
          {isExternal ? "⏳ 외부 미체결 주문 감지" : "⏳ 미체결 주문 감지됨"}
        </div>
        <div style={{ fontSize:"12px", color:theme.textMuted, lineHeight:"1.7" }}>
          {isExternal
            ? <>바이낸스에서 직접 넣은<br/>미체결 주문이 있습니다.</>
            : <>새로고침 전 주문이 아직<br/>체결되지 않았습니다.</>}
        </div>
      </div>
      <button onClick={onCancel} style={{
        width:"100%", padding:"10px 0", borderRadius:"5px", fontSize:"14px",
        cursor:"pointer", fontFamily:"inherit", fontWeight:"700",
        background:"transparent", border:`1px solid #f6465d66`, color:"#f6465d",
        transition:"all 0.15s",
      }}>
        주문 취소
      </button>
    </div>
  );
}
