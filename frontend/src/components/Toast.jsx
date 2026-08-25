import { useEffect, useRef, useState } from "react";
import { useTheme } from "../ThemeContext";

// ⚠ **모든 토스트가 이 시간 뒤 저절로 사라진다** (2026-08-25 사용자 요청).
//   예전엔 `확인`을 눌러야만 닫히는 종류가 있어서, 자리를 비운 사이 알림이 뜨면
//   돌아올 때까지 화면에 남고 소리도 3초마다 계속 났다.
//   ⚠ **상단 빨간 배너는 자동으로 닫지 말 것** — 저기는 놓치면 안 되는 것
//     (손절이 비었다)만 오는 자리다. "토스트가 저절로 닫히니 배너도"로 넘어가지 말 것
const AUTO_DISMISS_MS = 20000;

// ⚠ **토스트는 한 종류뿐이다** (2026-08-25 사용자 지정 — "그냥 복잡하니까 통일하자").
//   금색 하나 / 글자 크기 하나 / 20초 뒤 자동 닫힘 / `확인`으로 즉시 닫기 / 소리 한 번.
//   예전엔 `sticky`(확인 버튼)와 `tone`(색)이 갈래를 만들었다 — **되살리지 말 것**.
//   빨강을 쓰고 싶어지면 그건 토스트가 아니라 **상단 빨간 배너**로 보낼 소식이다
const COLOR   = "#f0b90b";
const FS      = 14;
const ICON_FS = 18;

// 개별 토스트 — 마운트 시 자체 타이머 시작
function ToastItem({ t, onRemove, theme }) {
  const [progress, setProgress] = useState(1); // 1→0
  const startRef = useRef(Date.now());
  const rafRef   = useRef(null);

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const ratio   = Math.max(0, 1 - elapsed / AUTO_DISMISS_MS);
      setProgress(ratio);
      if (ratio > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // ⚠ **저절로 닫힐 때도 `onClose`를 부른다.** `확인`을 눌렀을 때와 **같은 일**을
        //   한다 (2026-08-25 사용자 지정) — 근접 알림은 이때 그 도형의 알림을 끈다.
        //   둘을 갈라 놓지 말 것: 닫는 방법에 따라 결과가 달라지면, 잠깐 자리를 비웠다는
        //   이유로 설정이 달라진다
        t.onClose?.();
        onRemove(t.id);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // `확인` = **20초를 기다리지 않고 지금 닫는다**. 그것뿐이다 —
  // 뒷정리는 위 자동 닫힘과 똑같이 `onClose`가 한다
  const handleConfirm = () => {
    onRemove(t.id);
    t.onClose?.();
  };

  return (
    <div style={{
      padding: "12px 18px",
      background: theme.bgCard,
      border: `1.5px solid ${COLOR}`,
      borderRadius: 8,
      fontSize: FS,
      fontWeight: 600,
      color: theme.textPrimary,
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      // ⚠ 이제 모든 토스트에 버튼이 있으므로 **항상 auto**여야 한다.
      //   `none`이면 버튼이 눌리지 않는다 (예전엔 sticky만 auto였다)
      pointerEvents: "auto",
      minWidth: 240,
      animation: "toastIn 0.2s ease",
      overflow: "hidden",
      position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: ICON_FS }}>🔔</span>
        <span>{t.message}</span>
      </div>
      <button
        onClick={handleConfirm}
        style={{
          padding: "8px 0",
          borderRadius: 5,
          border: "none",
          background: COLOR,
          color: "#000", // 금색 위에는 검정 — 사이드바 금색 버튼과 같은 규칙
          fontSize: FS,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
          letterSpacing: "0.03em",
        }}
      >
        확인
      </button>
      {/* 남은 시간 — 눌러서 닫을 수도 있고 두면 저절로 닫히므로, 얼마나 남았는지 보인다 */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        height: 3,
        width: `${progress * 100}%`,
        background: COLOR,
        borderRadius: "0 0 0 8px",
      }} />
    </div>
  );
}

export function Toast({ toasts, onRemove }) {
  const { theme } = useTheme();
  if (!toasts.length) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      zIndex: 9999,
      pointerEvents: "none",
    }}>
      {toasts.map(t => (
        <ToastItem key={t.id} t={t} onRemove={onRemove} theme={theme} />
      ))}
    </div>
  );
}
