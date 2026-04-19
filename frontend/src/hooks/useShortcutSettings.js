import { useState, useCallback } from "react";

const STORAGE_KEY = "keyboard_shortcuts";

// 기본 단축키 정의
export const DEFAULT_SHORTCUTS = {
  escape:       { key: "Escape",  label: "취소 / 선택 해제" },
  delete:       { key: "Delete",  label: "선택 삭제" },
  drawBox:      { key: "q",       label: "박스 모드 토글" },
  alert:        { key: "a",       label: "알람 토글" },
  lock:         { key: "l",       label: "잠금 토글" },
  opacityDown:  { key: "[",       label: "투명도 감소" },
  opacityUp:    { key: "]",       label: "투명도 증가" },
  tf5m:         { key: "1",       label: "5분봉" },
  tf15m:        { key: "2",       label: "15분봉" },
  tf1h:         { key: "3",       label: "1시간봉" },
  tf4h:         { key: "4",       label: "4시간봉" },
  tf1d:         { key: "5",       label: "1일봉" },
  tf1w:         { key: "6",       label: "1주봉" },
};

function loadShortcuts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // 기본값과 병합 (새 단축키가 추가되었을 때 대비)
      const merged = {};
      for (const id of Object.keys(DEFAULT_SHORTCUTS)) {
        merged[id] = {
          ...DEFAULT_SHORTCUTS[id],
          key: saved[id]?.key ?? DEFAULT_SHORTCUTS[id].key,
        };
      }
      return merged;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SHORTCUTS };
}

function saveShortcuts(shortcuts) {
  // key 값만 저장
  const toSave = {};
  for (const [id, v] of Object.entries(shortcuts)) {
    toSave[id] = { key: v.key };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

export function useShortcutSettings() {
  const [shortcuts, setShortcuts] = useState(loadShortcuts);

  const updateShortcut = useCallback((id, newKey) => {
    setShortcuts(prev => {
      const next = { ...prev, [id]: { ...prev[id], key: newKey } };
      saveShortcuts(next);
      return next;
    });
  }, []);

  const resetShortcuts = useCallback(() => {
    const defaults = { ...DEFAULT_SHORTCUTS };
    setShortcuts(defaults);
    saveShortcuts(defaults);
  }, []);

  return { shortcuts, updateShortcut, resetShortcuts };
}

// 키 이벤트에서 표시용 문자열 생성
export function keyToDisplay(key) {
  const MAP = {
    Escape: "Esc", Delete: "Del", Backspace: "⌫",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    " ": "Space", Enter: "Enter", Tab: "Tab",
  };
  return MAP[key] || key.toUpperCase();
}
