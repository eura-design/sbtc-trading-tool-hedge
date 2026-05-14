import { useState } from "react";
import { useTheme } from "../../ThemeContext";
import { useMarketInfo } from "../../hooks/useMarketInfo";

export function MarketInfoCard() {
  const { theme } = useTheme();
  const { fundingRate, fundingCountdown, fearGreed } = useMarketInfo();
  const [open, setOpen] = useState(() => localStorage.getItem("accordion_marketInfo") === "true");
  const toggle = () => setOpen(v => { const n = !v; localStorage.setItem("accordion_marketInfo", n); return n; });

  const row = (label, value, sub) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"4px 0", borderBottom:`1px solid ${theme.border}` }}>
      <span style={{ fontSize:"12px", color:theme.textMuted }}>
        {label}
        {sub && <span style={{ color:"#94a3b8", fontSize:"15px", marginLeft:"4px" }}>{sub}</span>}
      </span>
      <span style={{ fontSize:"13px", color:"#94a3b8", fontWeight:"600" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ padding:"8px 16px", borderBottom:`1px solid ${theme.border}`, flexShrink:0 }}>
      <button
        onClick={toggle}
        style={{
          width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
          background:"transparent", border:"none", cursor:"pointer", padding:0,
        }}
      >
        <span style={{ fontSize:"12px", color:theme.textMuted }}>시장 정보</span>
        <span style={{ fontSize:"10px", color:theme.textFaint }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ marginTop:"6px" }}>
          {row(
            "펀딩비",
            fundingRate === null ? "—" : `${fundingRate >= 0 ? "+" : ""}${fundingRate.toFixed(4)}%`,
            fundingCountdown ? `(${fundingCountdown})` : null,
          )}
          {row(
            "공포·탐욕",
            fearGreed ? `${fearGreed.value}` : "—",
            null,
          )}
        </div>
      )}
    </div>
  );
}
