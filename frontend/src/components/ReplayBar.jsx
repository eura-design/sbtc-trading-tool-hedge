import { useState, useEffect, useRef } from "react";
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

// 일시정지 아이콘 — 재생 `▶` 글리프의 **광학적 크기**에 맞춘 값이다.
// `▶`(U+25B6)은 폰트 대부분에서 약 0.75em 정사각에 들어차게 그려지므로, 바 버튼
// fontSize 12px 기준 9px가 그 크기다. 막대 두 개의 잉크 면적(2.4×9×2 = 43)도
// 삼각형(≈40)과 비슷하게 맞춰 뒀다 — 폭만 같고 더 시커멓게 보이면 여전히 커 보인다.
// ⚠ 바의 fontSize를 바꾸면 여기도 같이 바꿀 것 (em이 아니라 px인 이유: `▶`의 실제
//   크기는 폴백 폰트가 정하는 것이라 em으로 비례시켜도 어차피 추정이다)
const PAUSE_PX = 9;
const PAUSE_BAR_W = 2.4;

function PauseIcon() {
  return (
    <svg width={PAUSE_PX} height={PAUSE_PX} viewBox={`0 0 ${PAUSE_PX} ${PAUSE_PX}`}
      style={{ display: "block" }} aria-hidden="true">
      <rect x="1" y="0" width={PAUSE_BAR_W} height={PAUSE_PX} fill="currentColor" />
      <rect x={PAUSE_PX - 1 - PAUSE_BAR_W} y="0" width={PAUSE_BAR_W} height={PAUSE_PX} fill="currentColor" />
    </svg>
  );
}

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
    stepTick, resetPaper,
    progress, atEnd, loading, loadInfo, error,
    driveTf,
  } = replay;

  // 성적 초기화는 **두 번 눌러야 한다** — 되돌릴 수 없고, 몇 시간 쌓은 기록이 대상이다.
  // 차트의 진입 라벨 ×와 같은 규칙(uiSlice.closeConfirm): 1회차엔 확인 문구로 바뀌고
  // 4초 뒤 스스로 풀린다
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmTimer = useRef(null);
  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const btn = (active) => ({
    height: "22px", padding: "0 8px", borderRadius: "3px", cursor: "pointer", flexShrink: 0,
    fontSize: "12px", fontFamily: "inherit", fontWeight: active ? "700" : "400",
    background: active ? ACCENT : "transparent",
    border: `1px solid ${active ? ACCENT : theme.textFaint}`,
    color: active ? "#000" : theme.textMuted,
    transition: "all 0.15s",
  });

  // ── 구간을 옮길 때는 **연습 도형을 지운다** ────────────────────────────
  // 안 지우면 예전 연습 구간에서 그은 선이 새 구간에 그대로 살아 있다. 좌표가 멀어
  // 화면에는 안 보이지만 계산에는 계속 들어가고, 특히 `useTrendLineAlert`은 선을
  // **현재 봉 시각까지 선형 외삽**하므로(`linePriceAt`) 수평에 가까운 선은 몇 년
  // 떨어진 구간에서도 근접 알림을 띄운다. "화면에 없는 선에서 알림이 온다" — 실제로
  // 가능한 상태였다.
  //
  // ⚠ **🎲와 날짜 직접 입력이 똑같이 지운다** (2026-08-19 사용자 요청).
  //   2026-08-15에는 "직접 입력은 같은 구간을 다시 보려는 의도일 수 있다"며 🎲에만
  //   달았는데, 실제로는 어느 쪽이든 다른 시기로 넘어가는 건 같아서 유출 경로가
  //   반쪽만 막혀 있었다. 한쪽만 되돌리지 말 것.
  //
  // ※ **연습 성적(계좌·장부)은 지우지 않는다.** 그건 `성적 초기화` 버튼만 한다
  //   (2026-08-19 — replay/session.js의 두 단계 복원 규칙)
  const changeRange = (nextStartMs) => {
    clearReplayDrawings();
    onDrawingsCleared?.();   // React 상태까지 새로 읽게 한다 (localStorage만 지우면 되살아난다)
    onRangeChange({ startMs: nextStartMs });
  };

  // 편향 방지용 무작위 시작점 — 상장 이후 ~ 30일 전 사이에서 고른다.
  // 날짜를 직접 고르면 "그때 무슨 일이 있었는지" 이미 알고 시작하게 된다
  const pickRandom = () => {
    const latest = Date.now() - 30 * 86400_000;
    changeRange(Math.floor(FIRST_LISTING_MS + Math.random() * (latest - FIRST_LISTING_MS)));
  };

  const onResetClick = () => {
    clearTimeout(confirmTimer.current);
    if (!confirmReset) {
      setConfirmReset(true);
      confirmTimer.current = setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    setConfirmReset(false);
    resetPaper?.();
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
          if (v) changeRange(v);
        }}
        min={toLocalInput(FIRST_LISTING_MS)}
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

      {/* 재생 제어
          ⚠ **일시정지만 글리프가 아니라 SVG다** (2026-08-19). 기준은 재생 `▶`(U+25B6)이고,
            그 크기에 맞추는 게 목적이다. 글리프로는 두 번 실패했다:
              `⏸`(U+23F8) → 이모지 표현이라 `▶`보다 크고 색까지 다르게 그려진다
              `▮▮`(U+25AE) → 같은 Geometric Shapes 블록인데도 여전히 안 맞았다
            둘 다 **폰트 폴백 문제**라서 그렇다. 이 앱의 폰트 스택(JetBrains Mono → …
            → monospace)에는 이 글리프들이 없어서 OS 폴백 폰트가 그리는데, `▶`와
            일시정지 글리프가 **서로 다른 폰트에서 나오면** 어떤 코드포인트를 골라도
            크기가 우연히 맞기를 바라는 수밖에 없다.
            → SVG는 폰트를 타지 않아 px로 못박을 수 있다. `PAUSE_PX`가 곧 그 크기다.
          ⚠ 재생 `▶`은 **글리프 그대로 둘 것** — 기준이 바뀌면 맞출 대상이 사라진다.
            한 틱 `▶|`도 그 `▶`에 맞춰 고른 것이라 같이 유지한다. */}
      <button onClick={playing ? pause : play} disabled={loading || atEnd || !!error}
        style={{ ...btn(playing), display: "flex", alignItems: "center", justifyContent: "center" }}
        title={playing ? "일시정지" : "재생"}>
        {playing ? <PauseIcon /> : "▶"}
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

      {/* 연습 성적 초기화 — **연습 계좌를 비우는 유일한 경로**다 (2026-08-19).
          시크·날짜 변경·TF 전환 어디서도 성적이 사라지지 않으므로, 없으면
          한번 망친 세션을 다시 시작할 방법이 아예 없다.
          ⚠ 되돌릴 수 없어 두 번 눌러야 한다 — 진입 라벨 ×와 같은 규칙 */}
      <button onClick={onResetClick} title="연습 계좌·성적을 처음 상태로 되돌린다"
        style={{
          ...btn(false), marginLeft: "auto",
          borderColor: confirmReset ? "#f6465d" : theme.textFaint,
          color: confirmReset ? "#f6465d" : theme.textMuted,
          fontWeight: confirmReset ? "700" : "400",
        }}>
        {confirmReset ? "정말 초기화?" : "성적 초기화"}
      </button>
      <button onClick={onExit} style={btn(false)} title="실거래 화면으로 돌아가기">
        ✕ 종료
      </button>
    </div>
  );
}
