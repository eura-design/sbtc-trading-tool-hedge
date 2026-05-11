import * as d3 from "d3";
import { useState } from "react";
import { useTheme } from "../../ThemeContext";
import { useStats } from "../../hooks/useStats";

export function StatsCard() {
  const { theme } = useTheme();
  const [startDate, setStartDate] = useState(() => localStorage.getItem("statsStartDate") || "");
  const { stats, loading, error, refetch } = useStats(startDate);

  const handleDateChange = e => {
    const v = e.target.value;
    setStartDate(v);
    if (v) localStorage.setItem("statsStartDate", v);
    else localStorage.removeItem("statsStartDate");
  };

  const fmt  = v => `$${d3.format(",.2f")(Math.abs(v))}`;
  const sign = v => v >= 0 ? "+" : "-";

  const rows = stats ? [
    ["수수료",  `-${fmt(stats.totalComm)}`,                               "#94a3b8"],
    ["펀딩비",  `${sign(stats.totalFunding)}${fmt(stats.totalFunding)}`,  "#94a3b8"],
    ["순손익",  `${sign(stats.netPnl)}${fmt(stats.netPnl)}`,             "#94a3b8"],
  ] : [];

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"4px 0", borderBottom:`1px solid ${theme.border}` }}>
        <span style={{ fontSize:"12px", color:theme.textMuted }}>시작일</span>
        <div style={{ display:"flex", alignItems:"center", gap:"4px" }}>
          <input
            type="date" value={startDate}
            onChange={handleDateChange}
            style={{
              padding:"2px 4px", borderRadius:"3px",
              background:theme.bgCard, border:`1px solid ${theme.borderSec}`,
              color:theme.textPrimary, fontSize:"12px", fontFamily:"inherit",
              outline:"none", cursor:"pointer",
            }}
          />
          <button onClick={refetch} style={{ background:"none", border:"none",
            color:theme.textFaint, cursor:"pointer", fontSize:"14px", padding:"0", lineHeight:1 }}
            onMouseEnter={e => e.target.style.color="#f0b90b"}
            onMouseLeave={e => e.target.style.color=theme.textFaint}>⟳</button>
        </div>
      </div>

      {loading && (
        <div style={{ padding:"4px 0", fontSize:"12px", color:theme.textFaint }}>통계 로딩중...</div>
      )}
      {(error || (!loading && !stats)) && (
        <div style={{ padding:"4px 0", fontSize:"12px", color:theme.textMuted }}>통계 없음</div>
      )}
      {!loading && stats && rows.map(([l, v, c]) => (
        <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"4px 0", borderBottom:`1px solid ${theme.border}` }}>
          <span style={{ fontSize:"12px", color:theme.textMuted }}>{l}</span>
          <span style={{ fontSize:"13px", color:c, fontWeight:"600" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}
