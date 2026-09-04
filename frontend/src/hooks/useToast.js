import { useState, useCallback } from "react";

// 모듈 레벨 단일 AudioContext — 매 호출마다 새로 생성하면 Chrome autoplay policy 위반 + 누수
let _audioCtx = null;
function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { /* AudioContext 미지원 환경 */ }
  return _audioCtx;
}

/**
 * 알림음 한 번 — 880Hz + 1108Hz 두 음.
 *
 * ⚠ **토스트와 상단 빨간 배너가 이 함수 하나를 나눠 쓴다** (2026-09-04 사용자 요청).
 *   배너 쪽은 `hooks/useRealtimeData.js`가 부른다. 소리를 두 벌로 만들지 말 것 —
 *   같은 알림음이 자리에 따라 달라지면 듣는 사람이 무엇이 울렸는지 알 수 없다.
 */
export function playNotifSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  // 사용자 인터랙션 전엔 suspended 상태일 수 있음 — resume 시도
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  try {
    const beep = (freq, startTime, duration, gainVal) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type      = "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(gainVal, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    // 두 음 연속 — 청명한 알림음
    beep(880,  ctx.currentTime,        0.15, 1.5);
    beep(1108, ctx.currentTime + 0.16, 0.22, 1.2);
  } catch { /* 일시적 오류 무시 */ }
}

export function useToast() {
  const [toasts, setToasts] = useState([]);

  // ⚠ **토스트는 한 종류뿐이다** (2026-08-25 사용자 지정 — "그냥 복잡하니까 통일하자").
  //   전부 금색 / 20초 뒤 자동 닫힘 / `확인` 버튼으로 즉시 닫기 / 소리 한 번.
  //   예전엔 `sticky`(확인 버튼)와 `tone`(색)이라는 축이 둘 있었고, 소리를 3초마다
  //   반복하는 종류가 따로 있었다. **그 갈래를 되살리지 말 것** — 종류가 늘 때마다
  //   "이건 왜 빨갛지 / 왜 안 닫히지"를 매번 다시 설명해야 했다.
  //   더 급한 것(손절이 비었다)은 토스트가 아니라 **상단 빨간 배너**로 간다(`pushAlert`).
  //
  //   ⚠ 최대 **3개**(`slice(-2)` + 새것). 오른쪽 아래에 세로로 쌓여서 더 두면 차트를 가린다.
  //   ⚠ 자동 닫힘 시간(20초)은 `Toast.jsx`가 갖는다 — 여기서 또 세지 말 것

  // 토스트 제거 — Toast의 자동 타이머 또는 `확인` 버튼이 부른다
  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  /**
   * 토스트 하나를 띄운다.
   *
   * @param message  화면에 뜰 문구
   * @param onClose  (선택) 닫힐 때 부를 콜백 — `확인`이든 20초 자동이든, 상한에 밀려
   *                 사라질 때든 **똑같이 한 번 불린다**. 인자는 없다:
   *                 **어떻게 닫혔는지로 결과가 갈리지 않는다**(2026-08-25 사용자 지정).
   *                 근접 알림(useTrendLineAlert)은 여기서 그 도형의 알림(🔔)을 끈다.
   *                 ※ 도형의 `locked`(단축키 `l`)와는 무관하다 — 저건 이동 잠금이다
   */
  const addToast = useCallback((message, onClose) => {
    const id = Date.now() + Math.random();
    setToasts(prev => {
      const kept = prev.slice(-2);
      // ⚠ 상한에 밀려나는 토스트도 **정상 종료로 처리한다** — 화면에서 사라지는 건
      //   같으므로 뒷정리도 같아야 한다. 안 하면 근접 알림이 "울렸는데 알림은 안 꺼진"
      //   어정쩡한 상태로 남는다. onClose는 멱등이라 두 번 불려도 안전하다
      for (const dropped of prev.slice(0, prev.length - kept.length)) dropped.onClose?.();
      return [...kept, { id, message, onClose }];
    });
    playNotifSound(); // ⚠ 한 번만 — 반복 알림음은 2026-08-25에 없앴다
  }, []);

  return { toasts, addToast, removeToast };
}
