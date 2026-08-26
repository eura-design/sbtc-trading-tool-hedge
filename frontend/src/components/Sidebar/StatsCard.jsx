import * as d3 from "d3";
import { useState } from "react";
import { useTheme } from "../../ThemeContext";
import { useStats } from "../../hooks/useStats";
import { iconBtn } from "../sidebarBtn";
import { lsGet, lsRemove, lsSet } from "../../utils/storage";

// 두 날짜 칸이 **같은 모양**이어야 한다 — 하나만 리터럴로 두면 나중에 갈린다
//
// ⚠ **`flex:1` + `minWidth:0`이 반드시 필요하다** (2026-08-25 사용자 지적).
//   `input[type=date]`는 브라우저 기본 너비를 갖는데 **그 너비가 값에 따라 달라진다** —
//   비어 있으면 `연도-월-일` 자리표시, 채우면 `2026. 08. 25.`라 폭이 다르다.
//   그래서 시작일만 채워 두면 두 칸의 좌우 길이가 눈에 띄게 어긋났다.
//   남는 공간을 똑같이 채우게 하면 **값과 무관하게 항상 같은 폭**이 된다.
//   ⚠ `minWidth:0`을 빼지 말 것 — flex 아이템의 `min-width:auto`가 기본 너비 아래로
//     못 줄게 막아서, `flex:1`을 줘도 안 줄고 오른쪽으로 삐져나온다
//     (`components/Slider.jsx`의 range 입력이 똑같이 당한 문제다)
const dateStyle = theme => ({
  flex:1, minWidth:0,
  padding:"2px 4px", borderRadius:"3px",
  background:theme.bgCard, border:`1px solid ${theme.borderSec}`,
  color:theme.textPrimary, fontSize:"12px", fontFamily:"inherit",
  outline:"none", cursor:"pointer",
});

// 라벨 오른쪽의 입력 묶음 — 두 줄이 **같은 폭을 나눠 갖게** 한다.
// (`시작일`·`종료일`은 글자 수가 같아 라벨 폭도 같다)
const fieldRow = { display:"flex", alignItems:"center", gap:"4px", flex:1, marginLeft:"8px" };

// ⚠ **기간 조회다** (2026-08-25 사용자 요청) — 그전엔 `시작일` 한 줄뿐이었고
//   끝은 늘 현재였다. 두 줄로 둔 이유는 사이드바 폭(239px)에 날짜 칸 둘이
//   한 줄로 안 들어가기 때문이다 (라벨을 떼야 겨우 들어간다)
// ⚠ **둘 다 비우면 "가능한 최대"**(선물 상장일~현재)다. 예전에는 비우면
//   바이낸스가 최근 7일만 돌려줘서, 화면은 전체처럼 보이는데 실제로는
//   일주일치였다 (routes/stats.js 실측 주석)
export function StatsCard() {
  const { theme } = useTheme();
  const [startDate, setStartDate] = useState(() => lsGet("statsStartDate") || "");
  const [endDate,   setEndDate]   = useState(() => lsGet("statsEndDate")   || "");
  const { stats, loading, error, refetch } = useStats(startDate, endDate);

  // ⚠ 날짜 칸이 서로의 `min`/`max`가 된다 — 시작 > 종료라는 상태를 **애초에 못 만든다**.
  //   경고 문구를 새로 띄우는 것보다 낫다 (브라우저가 알아서 막는다)
  const mkChange = (setter, key) => e => {
    const v = e.target.value;
    setter(v);
    if (v) lsSet(key, v);
    else lsRemove(key);
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
        <span style={{ fontSize:"12px", color:theme.textMuted, flexShrink:0 }}>시작일</span>
        <div style={fieldRow}>
          <input
            type="date" value={startDate} max={endDate || undefined}
            onChange={mkChange(setStartDate, "statsStartDate")}
            style={dateStyle(theme)}
          />
          {/* ⟳ 는 **첫 줄에만** — 둘째 줄에도 두면 같은 일을 하는 버튼이 둘이 된다 */}
          <button onClick={refetch} style={iconBtn(theme.textFaint)}
            onMouseEnter={e => e.target.style.color="#f0b90b"}
            onMouseLeave={e => e.target.style.color=theme.textFaint}>⟳</button>
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"4px 0", borderBottom:`1px solid ${theme.border}` }}>
        <span style={{ fontSize:"12px", color:theme.textMuted, flexShrink:0 }}>종료일</span>
        <div style={fieldRow}>
          <input
            type="date" value={endDate} min={startDate || undefined}
            onChange={mkChange(setEndDate, "statsEndDate")}
            style={dateStyle(theme)}
          />
          {/* ⟳ 자리만큼 비워 둔다 — 안 그러면 두 날짜 칸의 폭이 그만큼 어긋난다.
              ⚠ 치수를 리터럴(16px)로 적지 말고 **`iconBtn`을 그대로 쓴다** —
                버튼 규격이 바뀌어도 빈 칸이 저절로 따라간다
                (`components/sidebarBtn.js`가 아이콘 버튼 치수의 유일한 출처다) */}
          <span aria-hidden style={{ ...iconBtn("transparent"), pointerEvents:"none" }} />
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
