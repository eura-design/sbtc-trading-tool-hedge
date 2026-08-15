import { useTheme } from "../ThemeContext";
import { FIRST_LISTING_MS } from "../replay/klines.js";
import { clearReplayDrawings } from "../replay/drawingKeys.js";

// 리플레이 컨트롤 바 — 리플레이 모드일 때 TopBar 아래에 나타난다
//
// 색은 실거래 UI에 없는 보라 계열(ACCENT)로 잡았다. 이 바가 떠 있다는 것 자체가
// "지금 화면은 과거다"라는 신호여야 해서, 금색(#f0b90b)·초록·빨강처럼 실거래에서
// 이미 뜻이 있는 색을 쓰지 않는다.

const ACCENT = "#a78bfa";
const SPEEDS = [0.5, 1, 2, 5, 10];
const PROGRESS_W = 220;   // 진행 슬라이더 고정 폭 — flex로 두면 길이가 출렁인다

const pad = (n) => String(n).padStart(2, "0");

/** ms → `<input type="datetime-local">`이 받는 로컬 시각 문자열 */
function toLocalInput(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
       + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReplayBar({ replay, startMs, onRangeChange, onExit, onSeek, onDrawingsCleared }) {
  const { theme } = useTheme();
  const {
    playing, play, pause, speed, setSpeed,
    stepTick,
    progress, atEnd, loading, loadInfo, error,
    driveTf,
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
  //
  // ⚠ 여기서 **연습 도형을 지운다** (2026-08-15). 안 지우면 예전 연습 구간에서 그은 선이
  //   새 구간에 그대로 살아 있다. 좌표가 멀어 화면에는 안 보이지만 계산에는 계속 들어가고,
  //   특히 `useTrendLineAlert`은 선을 **현재 봉 시각까지 선형 외삽**하므로
  //   (`linePriceAt`) 수평에 가까운 선은 몇 년 떨어진 구간에서도 근접 알림을 띄운다.
  //   "화면에 없는 선에서 알림이 온다" — 실제로 가능한 상태였다.
  // ※ 시작일을 **직접 입력**할 때는 지우지 않는다. 같은 구간을 다시 보려는 의도일 수 있고,
  //   🎲만이 "다 버리고 새로"라는 뜻이 분명한 버튼이다 (2026-08-15 사용자 확정)
  // ※ 연습 계좌는 따로 손댈 게 없다 — session.js가 구간이 다르면 복원하지 않는다
  const pickRandom = () => {
    const latest = Date.now() - 30 * 86400_000;
    clearReplayDrawings();
    onDrawingsCleared?.();   // React 상태까지 새로 읽게 한다 (localStorage만 지우면 되살아난다)
    onRangeChange({ startMs: Math.floor(FIRST_LISTING_MS + Math.random() * (latest - FIRST_LISTING_MS)) });
  };

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
        RANDOM
      </button>

      <div style={{ width: "1px", height: "14px", background: theme.borderSec, margin: "0 2px" }} />

      {/* 재생 제어 */}
      <button onClick={playing ? pause : play} disabled={loading || atEnd || !!error}
        style={btn(playing)} title={playing ? "일시정지" : "재생"}>
        {playing ? "⏸" : "▶"}
      </button>
      {/* ⚠ 글리프는 `▶|`다 — 예전 `⏭`(U+23ED)는 이모지 표현이라 옆의 재생 `▶`(U+25B6)보다
          눈에 띄게 크게 그려졌다. 같은 Geometric Shapes 블록 + ASCII로 맞춰야 크기가 같다 */}
      <button onClick={() => stepTick(1)} disabled={loading || atEnd || !!error} style={btn(false)}
        title={`한 틱 (${driveTf} 봉 1개)`}>▶|</button>

      <div style={{ display: "flex", gap: "2px" }}>
        {SPEEDS.map(s => (
          <button key={s} onClick={() => setSpeed(s)} style={{ ...btn(speed === s), padding: "0 5px" }}>
            {s}x
          </button>
        ))}
      </div>

      {/* 진행 슬라이더
          ⚠ **폭을 고정한다** (2026-08-15 사용자 요청). 예전엔 `flex: 1`이라
            옆 요소(로딩 문구·에러·"구간 끝")가 나타났다 사라질 때마다 바 길이가 출렁였다 */}
      <input
        type="range" min={0} max={1} step={0.0005} value={progress}
        onChange={e => onSeek(+e.target.value)}
        disabled={loading || !!error}
        style={{ width: `${PROGRESS_W}px`, flexShrink: 0, accentColor: ACCENT, cursor: "pointer" }}
      />

      {loading && (
        <span style={{ fontSize: "11px", color: theme.textMuted, whiteSpace: "nowrap" }}>
          {loadInfo ? `${loadInfo.tf} 불러오는 중 ${loadInfo.pct}%` : "불러오는 중…"}
        </span>
      )}
      {error   && <span style={{ fontSize: "11px", color: "#f6465d" }}>{error}</span>}
      {atEnd && !loading && !error &&
        <span style={{ fontSize: "11px", color: theme.textMuted }}>구간 끝</span>}

      {/* ※ "기존 도형 보기"는 2026-08-15 사용자 요청으로 **기능째 제거**됐다.
          리플레이 도형은 이제 항상 연습용 키(`replay_*`)만 쓴다 — 되살리려면
          drawingKeys의 showLive 인자와 useDrawableStore의 readOnly까지 다시 필요하다 */}
      <button onClick={onExit} style={{ ...btn(false), marginLeft: "auto" }} title="실거래 화면으로 돌아가기">
        ✕ 종료
      </button>
    </div>
  );
}
