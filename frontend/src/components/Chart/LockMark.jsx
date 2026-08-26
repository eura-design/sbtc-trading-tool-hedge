import { clipSegmentX } from "../../chart/svgGeom";

// 잠금 표시 — **잠긴 도형에 붙는 작은 자물쇠** (2026-08-26 사용자 요청)
//
// ── 왜 있나 ────────────────────────────────────────────────────────────────
// 잠긴 도형은 **화면에 아무 표시가 없었다.** 더블클릭 팝업을 열거나, 끌어봤는데
// 안 움직여야 알 수 있었다. 알림은 호박색+점선이 같은 말을 하지만 잠금은 그런 게 없다.
//
// ⚠ 2026-08-14에 지운 🔔 아이콘을 되살리는 게 **아니다.** 그건 색·점선과 **중복**이라
//   지운 것이다. 🔔을 다시 붙이지 말 것 — 지운 이유가 그대로 살아 있다.
//
// ── 다섯 도형이 같은 것을 쓴다 ──────────────────────────────────────────────
// 선·채널·원·피보나치·수동 구조 — 잠금이 있는 전부다. 크기·투명도·자리를 여기서 한 번만
// 정한다. ⚠ 도형마다 따로 그리지 말 것: 같은 자물쇠인데 도형별로 다르게 보인다
//
// ⚠ **이모지다** (2026-08-26 사용자 지정 — SVG로 직접 그리자고 제안했으나 이모지로 정했다).
//   그래서 **OS 글꼴이 그린다**: 크기·모양이 환경마다 다르고 `fill`이 안 먹어
//   도형 색을 따라가지 않는다. 어긋나 보이면 아래 상수만 고칠 것.
//   ※ 투명도(`opacity`)는 이모지에도 먹는다 — SVG가 요소 전체에 거는 값이라서다
const LOCK_FS      = 7;     // 2026-08-26 사용자 지정 (10 → 7)
const LOCK_OPACITY = 0.3;   // 2026-08-26 사용자 지정 — 있는 줄만 알면 되지 눈에 띌 필요는 없다
const LOCK_DX      = 3;     // 붙는 지점에서 오른쪽으로
const LOCK_DY      = -3;    // 위로 (y는 글자 밑선이다)

/**
 * 경로가 **화면 안(x 0~IW)으로 처음 들어오는 지점**.
 *
 * ⚠ 도형의 실제 끝점에 붙이면 안 된다 — 클리핑 여유(VIEW_PAD 64) 때문에 그 점은
 *   화면 밖일 수 있고, 그러면 **잠긴 도형인데 자물쇠가 안 보인다**(안 잠긴 것으로 오해).
 *   도형이 보이는 한 자물쇠도 보여야 한다.
 *
 * @param pts [{ x, y }] — 이미 그려지는 좌표. 원은 가로 지름 두 점을 넘기면 된다
 *
 * ※ export하지 않는다 — 이 파일에서만 쓰고, 컴포넌트와 같이 내보내면
 *   Fast Refresh 경고(react-refresh/only-export-components)가 난다
 */
function firstVisiblePoint(pts, IW) {
  for (let k = 1; k < (pts?.length ?? 0); k++) {
    const s = clipSegmentX(pts[k - 1].x, pts[k - 1].y, pts[k].x, pts[k].y, 0, IW);
    if (s) return { x: s.x1, y: s.y1 };
  }
  return null;
}

/** 잠긴 도형에만 붙인다 — `locked`가 아니면 부르는 쪽에서 아예 안 그린다 */
export function LockMark({ pts, IW }) {
  const p = firstVisiblePoint(pts, IW);
  if (!p) return null;                       // 도형이 통째로 화면 밖
  return (
    <text
      x={Math.min(p.x + LOCK_DX, IW - LOCK_FS - 2)}
      y={p.y + LOCK_DY}
      fontSize={LOCK_FS}
      opacity={LOCK_OPACITY}
      // 도형 레이어가 이미 pointerEvents:none이지만 여기서도 못박는다 —
      // 새 도형에 붙일 때 그 레이어에 없으면 자물쇠가 클릭을 가로챈다
      style={{ userSelect: "none", pointerEvents: "none" }}
    >🔒</text>
  );
}
