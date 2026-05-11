import { useState } from "react";
import * as d3 from "d3";
import { useTheme } from "../ThemeContext";

export function ConfirmModal({ info, onConfirm, onCancel }) {
  const { theme } = useTheme();
  const [orderType, setOrderType] = useState("LIMIT");
  const color = info.isLong ? "#0ecb81" : "#f6465d";
  const fmtI = p => `$${d3.format(",.0f")(p)}`;
  const fmt  = p => `$${d3.format(",.2f")(p)}`;

  return (
    <div style={{ marginBottom:"12px" }}>
      <div style={{ padding:"10px",
        border:`1px solid ${color}33`, borderLeft:`2px solid ${color}`,
        borderRadius:"5px", marginBottom:"10px" }}>

        <div style={{ fontSize:"13px", color, fontWeight:"700", marginBottom:"8px" }}>
          {info.isLong ? "▲ LONG" : "▼ SHORT"} 주문 확인
        </div>

        {[
          ["청산가",     "—",                                                                          "#ff4444"],
          ["손익비 R:R", `1 : ${info.rrRatio}`,                                                      "#a78bfa"],
          ["수량",       `${info.qty} BTC`,                                                           "#94a3b8"],
          ["포지션 USD", fmtI(info.usd),                                                              "#94a3b8"],
          ["예상 손실",  `-${fmt(info.actualLoss)}`,                                                  "#f6465d"],
          ["예상 수익",  `+${fmt(info.actualProfit)}`,                                                "#0ecb81"],
          ["미실현",     "—",                                                                          "#64748b"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ display:"flex", justifyContent:"space-between",
            padding:"3px 0", borderBottom:`1px solid ${theme.border}` }}>
            <span style={{ fontSize:"12px", color:theme.textMuted }}>{l}</span>
            <span style={{ fontSize:"13px", color:c, fontWeight:"600" }}>{v}</span>
          </div>
        ))}

        {info.isLeverageCapped && (
          <div style={{ marginTop:"8px", padding:"8px 10px", background:theme.bgWarning,
            border:"1px solid #f6465d33", borderRadius:"5px", fontSize:"12px", lineHeight:"1.7" }}>
            <span style={{ color:"#f6465d", fontWeight:"700" }}>⚠ 레버리지 한도 조정</span>
            <span style={{ color:theme.textMuted }}> — {info.leverage}x 한도로 수량 제한됨</span>
          </div>
        )}
        {info.isMinCapped && (
          <div style={{ marginTop:"8px", padding:"8px 10px", background:theme.bgWarning,
            border:"1px solid #f0b90b33", borderRadius:"5px", fontSize:"12px", lineHeight:"1.7" }}>
            <span style={{ color:"#f0b90b", fontWeight:"700" }}>⚠ 최소 수량 적용</span>
            <span style={{ color:theme.textMuted }}> — 실제 리스크 </span>
            <span style={{ color:"#f6465d", fontWeight:"700" }}>{info.actualRiskPct.toFixed(2)}%</span>
          </div>
        )}
      </div>

      {/* 주문 방식 선택 */}
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
        <button onClick={() => onConfirm(orderType)} style={{
          flex:2, padding:"10px 0", borderRadius:"5px", cursor:"pointer",
          background:color, border:"none", color:"#000",
          fontSize:"14px", fontFamily:"inherit", fontWeight:"700",
          transition:"all 0.15s",
        }}>{info.isLong ? "▲ LONG 실행" : "▼ SHORT 실행"}</button>
      </div>
    </div>
  );
}
