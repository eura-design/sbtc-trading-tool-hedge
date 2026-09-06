// 봉마감 카운트다운의 **화면 위치** — 끌어서 옮기고, 그 자리를 기억한다 (2026-09-06 사용자 요청)
//
// ── 왜 localStorage인가 ────────────────────────────────────────────────────
// 이 값은 **이 브라우저·이 모니터의 취향**이다.
//   · 백엔드가 꺼져 있어도 차트는 돈다 — 그때 위치가 기본값으로 돌아가면 안 된다
//   · 기기마다 화면 크기가 달라서, 백엔드에 두고 여러 기기가 나눠 쓰면 오히려 틀린다
//   · 같은 성격의 값이 이미 여기 있다: `rsiH` · `volH` · `sidebar_open` · 테마
//   · `api/backup.js`가 localStorage 전체를 10분마다 백엔드로 보내므로 백업도 된다
//     (키를 따로 등록할 필요 없다 — 목록이 아니라 통째로 뜬다)
//
// ── 좌표는 무엇 기준인가 ───────────────────────────────────────────────────
// 차트 영역(`chartContainerRef`)의 **좌상단 기준 px**이다. 화면 전체 기준이 아니다 —
// 사이드바를 접거나 창을 줄이면 차트 영역만 움직이는데, 그때도 카운트다운이 차트
// 안 같은 자리에 있어야 한다.
//
// ⚠ **읽을 때마다 화면 안으로 되돌린다**(clamp). 창을 줄이거나 RSI·거래량 패널을
//   키우면 저장된 자리가 화면 밖이 될 수 있는데, 그러면 사용자는 옮길 방법조차 없다.
//   저장값은 건드리지 않는다 — 창을 다시 키우면 원래 자리로 돌아간다.

import { useState, useCallback, useRef, useEffect } from "react";
import { lsGetJSON, lsSetJSON } from "../utils/storage";

const KEY    = "countdownPos";
const MARGIN = 4;      // 가장자리에 딱 붙지 않게 두는 여백(px)

/** 저장값이 깨졌거나 숫자가 아니면 버린다 (기본 자리로 떨어진다) */
function readSaved() {
  const v = lsGetJSON(KEY, null);
  if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  return { x: v.x, y: v.y };
}

function clamp(pos, areaW, areaH, boxW, boxH) {
  const maxX = Math.max(MARGIN, areaW - boxW - MARGIN);
  const maxY = Math.max(MARGIN, areaH - boxH - MARGIN);
  return {
    x: Math.min(Math.max(pos.x, MARGIN), maxX),
    y: Math.min(Math.max(pos.y, MARGIN), maxY),
  };
}

/**
 * @param fallback 아직 옮긴 적이 없을 때의 자리 `{ x, y }` (지금까지 쓰던 고정 위치)
 * @param areaW/areaH 차트 영역 크기 — 화면 밖으로 나가지 않게 하는 데 쓴다
 * @returns boxRef(카운트다운 div에 달 것) · pos(그릴 자리) · onMouseDown · dragging
 */
export function useCountdownPos(fallback, areaW, areaH) {
  const [saved, setSaved]       = useState(readSaved);
  const [dragging, setDragging] = useState(false);
  const boxRef      = useRef(null);
  const dragRef     = useRef(null);
  const handlersRef = useRef(null);

  // 마운트 중 언마운트돼도 리스너가 남지 않게 (useRsiResize와 같은 규칙)
  useEffect(() => () => {
    if (!handlersRef.current) return;
    window.removeEventListener("mousemove", handlersRef.current.onMove);
    window.removeEventListener("mouseup",   handlersRef.current.onUp);
    handlersRef.current = null;
  }, []);

  // 그릴 자리 — 저장값이 없으면 지금까지 쓰던 고정 위치 그대로다
  const boxW = boxRef.current?.offsetWidth  ?? 0;
  const boxH = boxRef.current?.offsetHeight ?? 0;
  const pos  = clamp(saved ?? fallback, areaW, areaH, boxW, boxH);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;            // 왼쪽 버튼만 (우클릭은 차트 메뉴다)
    e.preventDefault();
    e.stopPropagation();
    const rect = boxRef.current?.getBoundingClientRect();
    dragRef.current = {
      // 잡은 지점이 상자 안 어디인지 — 이걸 빼야 상자가 커서로 순간이동하지 않는다
      grabX: e.clientX - (rect?.left ?? 0),
      grabY: e.clientY - (rect?.top  ?? 0),
      areaRect: boxRef.current?.parentElement?.getBoundingClientRect(),
      w: rect?.width  ?? 0,
      h: rect?.height ?? 0,
      moved: false,
    };
    setDragging(true);

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d?.areaRect) return;
      d.moved = true;
      setSaved(clamp(
        { x: ev.clientX - d.areaRect.left - d.grabX,
          y: ev.clientY - d.areaRect.top  - d.grabY },
        d.areaRect.width, d.areaRect.height, d.w, d.h,
      ));
    };
    const onUp = () => {
      const moved = dragRef.current?.moved;
      dragRef.current = null;
      handlersRef.current = null;
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
      // ⚠ **놓을 때 한 번만 저장한다.** 드래그 중에 저장하면 1초에 수십 번 쓰게 되고,
      //   저장이 막힌 환경에서는 그 횟수만큼 실패 로그를 만든다 (utils/storage.js)
      if (moved) setSaved((p) => { lsSetJSON(KEY, p); return p; });
    };

    handlersRef.current = { onMove, onUp };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, []);

  return { boxRef, pos, onMouseDown, dragging };
}
