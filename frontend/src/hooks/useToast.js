import { useState, useCallback, useRef } from "react";

function playNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

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
  } catch (e) {
    // AudioContext 미지원 환경 무시
  }
}

export function useToast() {
  const [toasts, setToasts]   = useState([]);
  const intervalRefs          = useRef({}); // toastId → intervalId

  const addToast = useCallback((message) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-2), { id, message, sticky: false }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 30000);
    playNotifSound();
  }, []);

  // 선 알림 전용: 확인 버튼 누를 때까지 소리 반복 + sticky
  const addLineAlert = useCallback((message, onConfirm) => {
    const id = Date.now() + Math.random();

    const handleConfirm = () => {
      clearInterval(intervalRefs.current[id]);
      delete intervalRefs.current[id];
      setToasts(prev => prev.filter(t => t.id !== id));
      onConfirm?.();
    };

    setToasts(prev => [...prev.slice(-2), { id, message, sticky: true, onConfirm: handleConfirm }]);
    playNotifSound();
    // 3초마다 소리 반복
    intervalRefs.current[id] = setInterval(playNotifSound, 3000);
  }, []);

  return { toasts, addToast, addLineAlert };
}
