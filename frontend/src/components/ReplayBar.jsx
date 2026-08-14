import { useMemo } from "react";
import { useTheme } from "../ThemeContext";
import { FIRST_LISTING_MS } from "../replay/klines.js";

// 리플레이 컨트롤 바 — 리플레이 모드일 때 TopBar 아래에 나타난다
//
// 색은 실거래 UI에 없는 보라 계열(ACCENT)로 잡았다. 이 바가 떠 있다는 것 자체가
// "지금 화면은 과거다"라는 신호여야 해서, 금색(#f0b90b)·초록·빨강처럼 실거래에서
// 이미 뜻이 있는 색을 쓰지 않는다.

const ACCENT = "#a78bfa";
const SPEEDS = [0.5, 1, 2, 5, 10];

const pad = (n) => String(n).padStart(2, "0");

/** ms → `<input type="datetime-local">`이 받는 로컬 시각 문자열 */
function toLocalInput(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
       + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtClock(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
       + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReplayBar({ replay, startMs, onRangeChange, onExit, showLive, onShowLiveToggle, onSeek }) {
  const { theme } = useTheme();
  const {
    playing, play, pause, speed, setSpeed,
    stepTick, stepBar,
    progress, nowMs, price, atEnd, loading, loadInfo, error,
    driveTf, ticksPerBar,
  } = replay;

  const btn = (active) => ({
    height: "22px", padding: "0 8px", borderRadius: "3px", cursor: "pointer", flexShrink: 0,
    fontSize: "12px", fontFamily: "inherit", fontWeight: active ? "700" : "400",
    background: active ? ACCENT : "transparent",
    border: `1px solid ${active ? ACCENT : theme.textFaint}`,
    color: active ? "#000" : theme.textMuted,
    transition: "all 0.15s",
  });

  // 편향 방지용 무작위 시작점 — 상장 이후 ~ 30일 전 사이에서 고른다.
  // 날짜를 직접 고르면 "그때 무슨 일이 있었는지" 이미 알고 시작하게 된다
  const pickRandom = () => {
    const latest = Date.now() - 30 * 86400_000;
    onRangeChange({ startMs: Math.floor(FIRST_LISTING_MS + Math.random() * (latest - FIRST_LISTING_MS)) });
  };

  const pct = useMemo(() => (progress * 100).toFixed(1), [progress]);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px",
      background: theme.bgCard,
      borderBottom: `1px solid ${theme.border}`,
      borderTop: `2px solid ${ACCENT}`,
      flexShrink: 0, flexWrap: "wrap",
    }}>
      <span style={{ fontSize: "11px", fontWeight: "700", color: ACCENT, whiteSpace: "nowrap" }}>
        ▶ REPLAY
      </span>

      <div style={{ width: "1px", height: "14px", background: theme.borderSec, margin: "0 2px" }} />

      {/* 시작 시점 */}
      <input
        type="datetime-local"
        value={toLocalInput(startMs)}
        onChange={e => {
          const v = e.target.value ? new Date(e.target.value).getTime() : null;
          if (v) onRangeChange({ startMs: v });
        }}
        style={{
          height: "22px", fontSize: "11px", fontFamily: "inherit", padding: "0 4px",
          background: "transparent", color: theme.textPrimary,
          border: `1px solid ${theme.borderSec}`, borderRadius: "3px",
        }}
      />
      <button onClick={pickRandom} style={btn(false)} title="무작위 시점 — 미리 알고 시작하는 편향을 막는다">
        🎲
      </button>

      <div style={{ width: "1px", height: "14px", background: theme.borderSec, margin: "0 2px" }} />

      {/* 재생 제어 */}
      <button onClick={playing ? pause : play} disabled={loading || atEnd || !!error}
        style={btn(playing)} title={playing ? "일시정지" : "재생"}>
        {playing ? "⏸" : "▶"}
      </button>
      <button onClick={() => stepTick(1)} disabled={loading || atEnd || !!error} style={btn(false)}
        title={`한 틱 (${driveTf} 봉 1개)`}>⏭</button>
      <button onClick={stepBar} disabled={loading || atEnd || !!error} style={btn(false)}
        title={`한 봉 (${driveTf} × ${ticksPerBar})`}>⏭⏭</button>

      <div style={{ display: "flex", gap: "2px" }}>
        {SPEEDS.map(s => (
          <button key={s} onClick={() => setSpeed(s)} style={{ ...btn(speed === s), padding: "0 5px" }}>
            {s}x
          </button>
        ))}
      </div>

      {/* 진행 슬라이더 */}
      <input
        type="range" min={0} max={1} step={0.0005} value={progress}
        onChange={e => onSeek(+e.target.value)}
        disabled={loading || !!error}
        style={{ flex: 1, minWidth: "120px", accentColor: ACCENT, cursor: "pointer" }}
      />
      <span style={{ fontSize: "11px", color: theme.textMuted, minWidth: "42px", textAlign: "right" }}>
        {pct}%
      </span>

      <div style={{ width: "1px", height: "14px", background: theme.borderSec, margin: "0 2px" }} />

      {/* 시뮬 시각 + 현재가 */}
      <span style={{ fontSize: "11px", color: theme.textPrimary, whiteSpace: "nowrap" }}>
        {fmtClock(nowMs)}
      </span>
      {price != null && (
        <span style={{ fontSize: "11px", fontWeight: "700", color: ACCENT, whiteSpace: "nowrap" }}>
          ${price.toLocaleString()}
        </span>
      )}

      {loading && (
        <span style={{ fontSize: "11px", color: theme.textMuted, whiteSpace: "nowrap" }}>
          {loadInfo ? `${loadInfo.tf} 불러오는 중 ${loadInfo.pct}%` : "불러오는 중…"}
        </span>
      )}
      {error   && <span style={{ fontSize: "11px", color: "#f6465d" }}>{error}</span>}
      {atEnd && !loading && !error &&
        <span style={{ fontSize: "11px", color: theme.textMuted }}>구간 끝</span>}

      {/* 기존(실거래) 도형 보기 — 기본 숨김.
          켜면 원래 도형이 **읽기 전용**으로 보인다. 연습하다 실제 분석선을
          실수로 끌어 옮기면 원본이 조용히 바뀌기 때문이다 (replay/drawingKeys.js) */}
      <button
        onClick={onShowLiveToggle}
        style={{ ...btn(showLive), marginLeft: "auto" }}
        title={showLive
          ? "기존 도형 보는 중 (읽기 전용) — 끄면 연습용 도형만 보입니다"
          : "실거래에서 그린 도형 보기 (읽기 전용)"}
      >
        {showLive ? "👁 기존 도형" : "기존 도형"}
      </button>

      <button onClick={onExit} style={btn(false)} title="실거래 화면으로 돌아가기">
        ✕ 종료
      </button>
    </div>
  );
}
