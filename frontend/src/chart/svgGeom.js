// SVG 오버레이 좌표를 **뷰포트로 잘라내는** 헬퍼 — 순수 함수
//
// ── 왜 필요한가 (2026-08-13, 5m 렉 실측) ─────────────────────────────────────
// 수동 구조·트렌드라인·채널은 좌표가 **timestamp**라, 로드된 캔들 범위보다 과거에
// 그린 도형은 `tsToIdx`가 **음수 bar index**로 외삽한다(scales.js). 화면에는 안 보이지만
// SVG 요소는 그 좌표 그대로 만들어진다.
//
// useCandles는 3000봉을 싣는다 — 5m면 **10.4일치뿐**이다. 그래서 TF가 짧을수록
// 과거 도형이 훨씬 멀리 나간다 (실측, 30일 전에 그린 도형 / 가시 150봉 기준):
//   5m  → x = -80,640 px      15m → -26,880 px      1h → -6,720 px
//
// 길이 자체는 클리핑이 처리하지만 **`stroke-dasharray`는 그렇지 않다.**
// 점선은 래스터 클리핑 **전에** 경로를 조각으로 펼치므로 비용이 선 길이에 비례한다:
// 위 5m 케이스는 폴리라인 하나에 점선 조각 **8,960개**. 구조 여러 개 × 최대 60fps
// (Structures가 liveClose를 구독해 틱마다 리렌더)면 그대로 프레임 드랍이 된다.
//   → 5m:15m:1h = 12:4:1. "5m만 확실히 느리다"는 보고와 비율이 일치한다.
//
// 그래서 **그리기 전에 잘라낸다.** 화면 안 형상은 그대로고(선형 보간), 화면 밖
// 수만 px만 사라진다. 점선을 끄는 걸로 때우지 말 것 — 실선도 노드는 여전히 거대하고,
// 지금은 알림 ON이 점선이라 언제든 다시 밟는다.

// 잘라낼 x 범위의 여유 — 선 끝이 화면 경계에서 뚝 끊긴 것처럼 보이지 않게 조금 남긴다
export const VIEW_PAD = 64;
const PAD = VIEW_PAD;

/**
 * 선분 (x1,y1)-(x2,y2)를 x ∈ [xMin, xMax]로 자른다.
 * 완전히 밖이면 null, 걸치면 잘린 좌표, 안이면 그대로.
 */
export function clipSegmentX(x1, y1, x2, y2, xMin, xMax) {
  if ((x1 < xMin && x2 < xMin) || (x1 > xMax && x2 > xMax)) return null;
  const dx = x2 - x1;
  if (dx === 0) return { x1, y1, x2, y2 };            // 수직선 — 자를 게 없다
  const at = x => y1 + ((x - x1) / dx) * (y2 - y1);
  let ax = x1, ay = y1, bx = x2, by = y2;
  if (ax < xMin) { ay = at(xMin); ax = xMin; } else if (ax > xMax) { ay = at(xMax); ax = xMax; }
  if (bx < xMin) { by = at(xMin); bx = xMin; } else if (bx > xMax) { by = at(xMax); bx = xMax; }
  return { x1: ax, y1: ay, x2: bx, y2: by };
}

/**
 * 폴리라인을 x ∈ [-PAD, IW+PAD]로 자른다.
 *
 * 지그재그는 x가 **단조 증가**(꼭짓점이 시간순)라, 자른 결과도 끊기지 않는 폴리라인
 * 하나로 남는다 — 여러 조각으로 쪼갤 필요가 없다.
 *
 * @param pts [{ x, y }] 화면 좌표
 * @returns [{ x, y }] — 화면에 걸치는 부분만. 전부 밖이면 빈 배열
 */
export function clipPolylineX(pts, IW) {
  if (!pts || pts.length < 2) {
    return (pts ?? []).filter(q => q.x >= -PAD && q.x <= IW + PAD);
  }
  const xMin = -PAD, xMax = IW + PAD;
  const out = [];
  for (let k = 1; k < pts.length; k++) {
    const seg = clipSegmentX(pts[k - 1].x, pts[k - 1].y, pts[k].x, pts[k].y, xMin, xMax);
    if (!seg) continue;
    const a = { x: seg.x1, y: seg.y1 }, b = { x: seg.x2, y: seg.y2 };
    const last = out[out.length - 1];
    if (!last || last.x !== a.x || last.y !== a.y) out.push(a);
    out.push(b);
  }
  return out;
}

/** 화면(여유 포함) 안에 있는 점인가 — 꼭짓점 핸들 컬링용 */
export function inViewX(x, IW) {
  return x >= -PAD && x <= IW + PAD;
}
