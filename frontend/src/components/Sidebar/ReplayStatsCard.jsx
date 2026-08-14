import * as d3 from "d3";
import { useMemo } from "react";
import { useTheme } from "../../ThemeContext";
import { useStore } from "../../store";
import { computeTradeStats } from "../../replay/tradeStats";

// 연습 세션 성적 — 리플레이일 때 "거래 통계" 자리를 대신 채운다
//
// 실거래 StatsCard(백엔드 /api/stats)와 **자리를 공유하고 내용만 바꾼다.**
// 리플레이 중에 실계좌 통계가 보이면 어느 쪽 성적인지 알 수 없고,
// 애초에 그 조회는 api() 가드와 무관하게 백엔드를 부른다.
//
// 실거래 카드보다 줄이 많다. 저쪽은 "이번 달 얼마 벌었나"를 보는 곳이지만
// 여기는 **연습 결과를 판단하는 곳**이라 승률·표본 수·낙폭이 필요하다.

const MUTED = "#94a3b8";
const WIN   = "#0ecb81";
const LOSS  = "#f6465d";

export function ReplayStatsCard() {
  const { theme } = useTheme();
  // 체결이 일어날 때마다 syncPaper가 스토어를 갱신하므로 그 시점에 다시 계산된다
  const broker  = useStore(s => s.paperBroker);
  const balance = useStore(s => s.balance);

  const stats = useMemo(
    () => computeTradeStats(broker?.trades ?? [], broker?.startBalance ?? 0),
    // balance가 바뀔 때마다 다시 센다 — trades 배열은 in-place로 자라서
    // 참조만 보면 갱신을 놓친다
    [broker, balance], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const money = v => `${v >= 0 ? "+" : "-"}$${d3.format(",.2f")(Math.abs(v))}`;
  const pct   = v => `${d3.format(".1f")(v)}%`;
  const pnlC  = v => v > 0 ? WIN : v < 0 ? LOSS : MUTED;

  if (!broker || stats.trades === 0) {
    return (
      <div style={{ padding: "4px 0", fontSize: "12px", color: theme.textFaint }}>
        아직 연습 거래가 없습니다
      </div>
    );
  }

  const rows = [
    ["거래",     `${stats.trades}건`, MUTED],
    ["승 / 패",  `${stats.wins} / ${stats.losses}`, MUTED],
    ["승률",     pct(stats.winRate), stats.winRate >= 50 ? WIN : LOSS],
    // 손실이 한 번도 없으면 null이다 — "∞"를 띄우면 표본 2건짜리가 완벽해 보인다
    ["손익비 PF", stats.profitFactor == null ? "—" : d3.format(".2f")(stats.profitFactor),
                  stats.profitFactor == null ? MUTED : stats.profitFactor >= 1 ? WIN : LOSS],
    ["평균 이익", money(stats.avgWin),  stats.avgWin  ? WIN  : MUTED],
    ["평균 손실", money(stats.avgLoss), stats.avgLoss ? LOSS : MUTED],
    ["최대 낙폭", `${money(-stats.maxDrawdown)}${
      stats.maxDrawdownPct != null ? ` (${pct(stats.maxDrawdownPct)})` : ""}`, LOSS],
    ["수수료",   money(-stats.totalFee),     MUTED],
    ["펀딩비",   money(-stats.totalFunding), MUTED],
    ["순손익",   money(stats.netPnl),        pnlC(stats.netPnl)],
  ];

  if (stats.liquidations > 0) {
    rows.push(["강제 청산", `${stats.liquidations}회`, LOSS]);
  }

  return (
    <div>
      {rows.map(([label, value, color]) => (
        <div key={label} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "4px 0", borderBottom: `1px solid ${theme.border}`,
        }}>
          <span style={{ fontSize: "12px", color: theme.textMuted }}>{label}</span>
          <span style={{ fontSize: "13px", color, fontWeight: "600" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}
