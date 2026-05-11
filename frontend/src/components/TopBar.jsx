import * as d3 from "d3";
import { INTERVALS } from "../constants";
import { useTheme } from "../ThemeContext";
import { useStore } from "../store";
import { IndicatorMenu }      from "./IndicatorMenu";
import { NotificationMenu }  from "./NotificationMenu";
import { ShortcutMenu }      from "./ShortcutMenu";


export function TopBar({ interval_, onIntervalChange, drawMode, onDrawModeToggle, lineMode, onLineModeToggle, channelMode, onChannelModeToggle, circleMode, onCircleModeToggle, isDark, onThemeToggle, locked, hasPos, hasPending, last, candleLoading, indicators, onIndicatorToggle, notifSettings, onNotifToggle, isLog, onLogToggle, indicatorParams, setIndicatorParam, setEmaList, resetIndicator, srLoading, refreshSR, shortcuts, onShortcutUpdate, onShortcutReset }) {
  const { theme } = useTheme();
  const liveClose = useStore(s => s.liveClose);
  const fmtI  = p => `$${d3.format(",.0f")(p)}`;
  const price   = liveClose ?? last?.c ?? 0;
  const isGreen = last ? price >= last.o : true;
  const pct     = last ? (((price - last.o) / last.o) * 100).toFixed(2) : "0.00";

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
        srLoading={srLoading} refreshSR={refreshSR}
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
        <span style={{ fontSize:"22px", fontWeight:"700", flexShrink:0,
          color: isGreen ? "#0ecb81" : "#f6465d",
          fontVariantNumeric:"tabular-nums" }}>
          {fmtI(price)}
        </span>
      )}

    </div>
  );
}
