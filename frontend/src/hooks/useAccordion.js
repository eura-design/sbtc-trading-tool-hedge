import { useState, useCallback } from "react";
import { lsGet, lsSet } from "../utils/storage";

// localStorage에 펼침 상태를 영속화하는 아코디언 훅
// 저장 형식: "true"/"false" 문자열. null이면 defaultOpen을 사용.
export function useAccordion(storageKey, defaultOpen = false) {
  const [open, setOpen] = useState(() => {
    const stored = lsGet(storageKey);
    return stored === null ? defaultOpen : stored === "true";
  });
  const toggle = useCallback(() => {
    setOpen(v => { const n = !v; lsSet(storageKey, n); return n; });
  }, [storageKey]);
  return [open, toggle];
}
