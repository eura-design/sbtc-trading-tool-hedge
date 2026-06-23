import { useState, useCallback, useRef, useEffect } from "react";

// 모듈 레벨 단일 AudioContext — 매 호출마다 새로 생성하면 Chrome autoplay policy 위반 + 누수
let _audioCtx = null;
function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { /* AudioContext 미지원 환경 */ }
  return _audioCtx;
}

function playNotifSound() {
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
  const intervalRefs        = useRef({}); // sticky toast id → intervalId (소리 반복)

  // 토스트 제거 — Toast 컴포넌트(자동 타이머) 또는 sticky 확인 버튼이 호출
  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    if (intervalRefs.current[id]) {
      clearInterval(intervalRefs.current[id]);
      delete intervalRefs.current[id];
    }
  }, []);

  // 일반 알림 — 최대 3개 유지, 자동 제거는 Toast 컴포넌트가 담당
  const addToast = useCallback((message) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-2), { id, message, sticky: false }]);
    playNotifSound();
  }, []);

  // 선 알림 전용: 확인 버튼 누를 때까지 소리 반복 + sticky
  const addLineAlert = useCallback((message, onConfirm) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-2), { id, message, sticky: true, onConfirm }]);
    playNotifSound();
    intervalRefs.current[id] = setInterval(playNotifSound, 3000);
  }, []);

  // 언마운트 시 모든 인터벌 정리
  useEffect(() => () => {
    Object.values(intervalRefs.current).forEach(clearInterval);
    intervalRefs.current = {};
  }, []);

  return { toasts, addToast, addLineAlert, removeToast };
}
