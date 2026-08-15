import * as d3 from "d3";
import { INTERVALS } from "../constants";
import { useTheme } from "../ThemeContext";
import { useStore } from "../store";
import { IndicatorMenu }      from "./IndicatorMenu";
import { NotificationMenu }  from "./NotificationMenu";
import { ShortcutMenu }      from "./ShortcutMenu";


export function TopBar({ interval_, onIntervalChange, lineMode, onLineModeToggle, channelMode, onChannelModeToggle, circleMode, onCircleModeToggle, fibMode, onFibModeToggle, structMode, onStructModeToggle, structEnabled, isDark, onThemeToggle, last, candleLoading, indicators, onIndicatorToggle, notifSettings, onNotifToggle, isLog, onLogToggle, indicatorParams, setIndicatorParam, setEmaList, resetIndicator, shortcuts, onShortcutUpdate, onShortcutReset, replayOn, onReplayToggle }) {
  const { theme } = useTheme();
  const liveClose = useStore(s => s.liveClose);
  const fmtI  = p => `$${d3.format(",.0f")(p)}`;
  const price   = liveClose ?? last?.c ?? 0;
  const isGreen = last ? price >= last.o : true;

  const sep = <div style={{ width:"1px", height:"14px", background:theme.borderSec, flexShrink:0, margin:"0 2px" }} />;

  return (
    <div style={{ display:"flex", alignItems:"center", gap:"6px", padding:"8px 12px",
      borderBottom:`1px solid ${theme.border}`, background:theme.bgMain, flexShrink:0 }}>

      {/* Brand */}
      <span style={{ fontSize:"14px", fontWeight:"700", color:"#f7931a", whiteSpace:"nowrap" }}>₿ BTC/USDT</span>
      <span style={{ fontSize:"11px", color:theme.textSec, background:theme.border,
        padding:"1px 5px", borderRadius:"3px", flexShrink:0 }}>PERP</span>

      {sep}

      {/* Intervals */}
      <div style={{ display:"flex", gap:"2px" }}>
        {INTERVALS.map(iv => (
          <button key={iv.value} onClick={() => onIntervalChange(iv.value)} style={{
            height:"22px", padding:"0 7px", borderRadius:"3px", cursor:"pointer", flexShrink:0,
            whiteSpace:"nowrap", fontSize:"12px", fontFamily:"inherit",
            fontWeight: interval_===iv.value ? "700" : "400",
            background: interval_===iv.value ? "#f0b90b" : "transparent",
            border:`1px solid ${interval_===iv.value ? "#f0b90b" : theme.borderSec}`,
            color: interval_===iv.value ? "#000" : theme.textMuted,
          }}>{iv.label}</button>
        ))}
      </div>

      {/* Chart tools */}
      <IndicatorMenu
        indicators={indicators} onToggle={onIndicatorToggle}
        params={indicatorParams} setParam={setIndicatorParam}
        setEmaList={setEmaList} resetIndicator={resetIndicator}
      />

      <button onClick={onLineModeToggle} style={{
        height:"22px", padding:"0 7px", borderRadius:"3px",
        cursor:"pointer", flexShrink:0,
        fontSize:"12px", fontFamily:"inherit", fontWeight:"400",
        background: lineMode ? "#60a5fa" : "transparent",
        border:`1px solid ${lineMode ? "#60a5fa" : theme.textFaint}`,
        color: lineMode ? "#000" : theme.textMuted,
        transition:"all 0.15s",
      }}>선</button>

      <button onClick={onCircleModeToggle} title="원" style={{
        height:"22px", padding:"0 7px", borderRadius:"3px",
        cursor:"pointer", flexShrink:0,
        fontSize:"12px", fontFamily:"inherit", fontWeight:"400",
        background: circleMode ? "#60a5fa" : "transparent",
        border:`1px solid ${circleMode ? "#60a5fa" : theme.textFaint}`,
        color: circleMode ? "#000" : theme.textMuted,
        transition:"all 0.15s",
      }}>원</button>

      <button onClick={onChannelModeToggle} title="평행 채널" style={{
        height:"22px", padding:"0 7px", borderRadius:"3px",
        cursor:"pointer", flexShrink:0,
        fontSize:"12px", fontFamily:"inherit", fontWeight:"400",
        background: channelMode ? "#60a5fa" : "transparent",
        border:`1px solid ${channelMode ? "#60a5fa" : theme.textFaint}`,
        color: channelMode ? "#000" : theme.textMuted,
        transition:"all 0.15s",
      }}>채널</button>

      {/* 피보나치 되돌림 — 2클릭(추세 시작 → 끝).
          ⚠ **지표 관문이 없다** (2026-08-15 사용자 요청). 선·채널·원과 같은 도형인데
            이것만 "지표 메뉴에서 Fibonacci를 켜야 그릴 수 있습니다"로 막혀 있었다.
            disabled/fibEnabled를 되살리지 말 것 — 지표 행 자체가 없어졌다 */}
      <button onClick={onFibModeToggle}
        title="피보나치 되돌림 — 추세 시작점 클릭 → 끝점 클릭 (표시할 레벨은 그린 뒤 더블클릭)" style={{
        height:"22px", padding:"0 7px", borderRadius:"3px",
        cursor:"pointer", flexShrink:0,
        fontSize:"12px", fontFamily:"inherit", fontWeight:"400",
        background: fibMode ? "#60a5fa" : "transparent",
        border:`1px solid ${fibMode ? "#60a5fa" : theme.textFaint}`,
        color: fibMode ? "#000" : theme.textMuted,
        transition:"all 0.15s",
      }}>피보나치</button>

      {/* 지표가 꺼져 있거나 현재 TF가 표시 대상이 아니면 그려도 화면에 안 나오므로 아예 막는다 (App.jsx에서도 가드) */}
      <button onClick={onStructModeToggle} disabled={!structEnabled}
        title={structEnabled
          ? "시장 구조 — 클릭으로 고/저점 찍기, 우클릭·더블클릭 확정 / CHoCH 자동 표시"
          : "지표 메뉴에서 Custom Structure Zigzag를 켜고, 현재 타임프레임을 표시 대상으로 선택해야 그릴 수 있습니다"} style={{
        height:"22px", padding:"0 7px", borderRadius:"3px",
        cursor: structEnabled ? "pointer" : "not-allowed", flexShrink:0,
        fontSize:"12px", fontFamily:"inherit", fontWeight:"400",
        background: structMode ? "#60a5fa" : "transparent",
        border:`1px solid ${structMode ? "#60a5fa" : theme.textFaint}`,
        color: structMode ? "#000" : theme.textMuted,
        opacity: structEnabled ? 1 : 0.35,
        transition:"all 0.15s",
      }}>구조</button>

      <button onClick={onLogToggle} style={{
        height:"22px", padding:"0 7px", borderRadius:"3px",
        cursor:"pointer", flexShrink:0,
        fontSize:"12px", fontFamily:"inherit", fontWeight:"400",
        background: isLog ? "#f0b90b" : "transparent",
        border:`1px solid ${isLog ? "#f0b90b" : theme.textFaint}`,
        color: isLog ? "#000" : theme.textMuted,
        transition:"all 0.15s",
      }}>Log</button>

      <ShortcutMenu shortcuts={shortcuts} onUpdate={onShortcutUpdate} onReset={onShortcutReset} />

      {sep}

      {/* 리플레이 모드 — 색은 실거래에서 뜻이 있는 금색/초록/빨강을 피해 보라 계열이다
          (ReplayBar와 같은 ACCENT). 이 버튼이 켜져 있다 = 화면이 과거다 */}
      <button onClick={onReplayToggle} title="리플레이 트레이딩 — 과거 구간을 재생하며 연습" style={{
        height:"22px", padding:"0 7px", borderRadius:"3px",
        cursor:"pointer", flexShrink:0, whiteSpace:"nowrap",
        // ⚠ 굵기는 켜져 있어도 400 고정 (2026-08-15 사용자 요청).
        //   700으로 바꾸면 글자가 커 보일 뿐 아니라 **버튼 폭이 늘어나** 옆 버튼들이 밀린다.
        //   켜짐 표시는 색(보라 채움)만으로 한다
        fontSize:"12px", fontFamily:"inherit", fontWeight:"400",
        background: replayOn ? "#a78bfa" : "transparent",
        border:`1px solid ${replayOn ? "#a78bfa" : theme.textFaint}`,
        color: replayOn ? "#000" : theme.textMuted,
        transition:"all 0.15s",
      }}>▶ 리플레이</button>

      {sep}

      {/* Notification menu */}
      <NotificationMenu settings={notifSettings} onToggle={onNotifToggle} />

      {sep}

      {/* Theme toggle */}
      <button onClick={onThemeToggle} style={{
        width:"28px", height:"22px", borderRadius:"3px", cursor:"pointer", flexShrink:0,
        fontSize:"13px", fontFamily:"inherit",
        background:"transparent", border:`1px solid ${theme.textFaint}`,
        color:theme.textMuted, transition:"all 0.15s",
      }}>{isDark ? "💡" : "🌙"}</button>

      <div style={{ flex:1 }} />

      {/* 현재가 (오른쪽 고정) — price>0 조건: 타임프레임 전환 중 last=undefined가 되어도 레이아웃 유지 */}
      {price > 0 && (
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexShrink: 0 }}>
          <span style={{ fontSize:"22px", fontWeight:"700",
            color: isGreen ? "#0ecb81" : "#f6465d",
            fontVariantNumeric:"tabular-nums" }}>
            {fmtI(price)}
          </span>
          {/* ※ 옆에 있던 등락률(+0.42%)은 2026-08-15 사용자 요청으로 제거.
              색(초록/빨강)이 이미 방향을 말해준다 */}
        </div>
      )}

    </div>
  );
}
