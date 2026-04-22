import { useTheme } from "../../ThemeContext";
import { useMarketInfo } from "../../hooks/useMarketInfo";

export function MarketInfoCard() {
  const { theme } = useTheme();
  const { fundingRate, fundingCountdown, fearGreed } = useMarketInfo();

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
  );
}
