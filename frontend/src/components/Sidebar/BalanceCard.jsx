import * as d3 from "d3";
import { useTheme } from "../../ThemeContext";

export function BalanceCard({ balance, error, onRefetch, online }) {
  const { theme } = useTheme();
  const fmt = p => `$${d3.format(",.2f")(p)}`;

  const refetchBtn = (
    <button onClick={onRefetch} style={{ background:"none", border:"none",
      color:theme.textFaint, cursor:"pointer", fontSize:"14px", padding:"0" }}
      onMouseEnter={e => e.target.style.color="#f0b90b"}
      onMouseLeave={e => e.target.style.color=theme.textFaint}>⟳</button>
  );

  if (error) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <span style={{ fontSize:"12px", color:"#f6465d" }}>⚠ server.js 실행 확인</span>
      {refetchBtn}
    </div>
  );

  if (!balance) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <span style={{ fontSize:"12px", color:theme.textFaint }}>잔고 로딩중...</span>
      {refetchBtn}
    </div>
  );

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:"5px" }}>
          <span style={{ fontSize:"20px", fontWeight:"700", color:"#0ecb81",
            fontVariantNumeric:"tabular-nums" }}>
            {fmt(balance.availableBalance)}
          </span>
          <span style={{ fontSize:"11px", color:theme.textFaint }}>USDT</span>
          {online !== undefined && (
            <span style={{
              width:"5px", height:"5px", borderRadius:"50%",
              display:"inline-block", marginLeft:"2px",
              background: online ? "#0ecb81" : "#f6465d",
              boxShadow: online ? "0 0 4px #0ecb81" : "0 0 4px #f6465d",
            }} />
          )}
        </div>
        {refetchBtn}
      </div>
      {balance.crossUnPnl !== 0 && (
        <div style={{ fontSize:"12px", color: balance.crossUnPnl >= 0 ? "#0ecb81" : "#f6465d", marginTop:"2px" }}>
          미실현 {balance.crossUnPnl >= 0 ? "+" : ""}{fmt(balance.crossUnPnl)}
        </div>
      )}
    </>
  );
}
