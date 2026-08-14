import { useTheme } from "../../ThemeContext";
import { useMarketInfo } from "../../hooks/useMarketInfo";
import { useStore } from "../../store";
import { useAccordion } from "../../hooks/useAccordion";

export function MarketInfoCard() {
  const { theme } = useTheme();
  // 리플레이면 재생 시각의 과거 값을 보여준다 — 오늘의 펀딩비·심리 지표가 뜨면
  // 그것 자체가 미래 정보다 (둘 다 이력 API가 있다 — useMarketInfo 상단 참고)
  const replayNowMs = useStore(s => s.replayOn ? s.replayNowMs : null);
  const { fundingRate, fundingCountdown, fearGreed } = useMarketInfo(replayNowMs);
  const [open, toggle] = useAccordion("accordion_marketInfo");

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
