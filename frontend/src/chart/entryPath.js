// 진입선(포지션 평단선) 계단 좌표 — 순수 함수, **import 없음**.
//
// pivotLevels.js·fib.js와 같은 이유로 의존성이 0이다: node에서 바로 import해
// "추가 매수로 평단이 오르내릴 때 선이 제대로 꺾이는가"를 실제 값으로 검산한다.
// 컴포넌트 안에 두면 그 검산을 할 수가 없다.
//
// ⚠ **왜 직선이 아니라 계단인가** (2026-08-15 사용자 지적):
//   추가 매수를 하면 entryPrice가 평단으로 바뀌는데, 평단은 정의상 체결가들 **사이**
//   값이라 최초 진입봉의 고가~저가 범위 밖일 수 있다 → 선의 왼쪽 끝이 진입 캔들이
//   아니라 **허공**을 가리킨다. 시작점을 "평단이 바뀐 봉"으로 옮겨도 마찬가지다
//   (그 봉 기준으론 반대쪽 허공). 어느 한 봉을 골라도 안 되므로, 구간마다 **그때
//   유효했던 평단**을 그린다. 모든 봉에서 참이고 왼쪽 끝은 진입 캔들에 붙는다.
//
// ⚠ **마지막 계단의 높이는 steps의 avg가 아니라 `entryPrice`다.** 서버가 준 두 값은
//   일치하지만(실측 오차 0), 라벨·× 버튼·사이드바가 전부 entryPrice를 보므로
//   어긋날 여지 자체를 없앤다.

/**
 * @param {{t:number, avg:number}[] | null} steps  그 시각부터 유효했던 평단 (오름차순)
 * @param {number} entryPrice  현재 평단 (마지막 계단 높이로 쓴다)
 * @param {(t:number)=>number} xOf  시각 → 그 봉 왼쪽 가장자리 x (화면 밖은 0~IW로 클램프)
 * @param {(p:number)=>number} yOf  가격 → y
 * @param {number} IW  플롯 폭 — 선은 항상 오른쪽 끝까지 간다
 * @returns {{x:number, y:number}[]}  polyline 점 목록
 */
export function entryPathPoints(steps, entryPrice, xOf, yOf, IW) {
  const yLast = yOf(entryPrice);
  // steps가 없으면(외부 진입·이력 부족·조회 실패) 예전처럼 전 폭 직선
  if (!steps?.length) return [{ x: 0, y: yLast }, { x: IW, y: yLast }];

  const pts = [];
  for (let i = 0; i < steps.length; i++) {
    const last = i === steps.length - 1;
    const y = last ? yLast : yOf(steps[i].avg);
    pts.push({ x: xOf(steps[i].t), y });
    // 다음 계단의 x까지 수평으로 간다. 세로 단차는 다음 반복의 첫 점이 만든다.
    // 평단이 올랐든 내렸든 같은 코드다 — 방향 분기가 없다
    if (!last) pts.push({ x: xOf(steps[i + 1].t), y });
  }
  pts.push({ x: IW, y: yLast });
  return pts;
}

/** SVG polyline의 points 속성 문자열 */
export function entryPathString(...args) {
  return entryPathPoints(...args).map(p => `${p.x},${p.y}`).join(" ");
}

/**
 * 계단을 **가로/세로로 쪼갠다.** 세로 단차를 가로선과 다르게 그리기 위한 것이다.
 *
 * ⚠ 세로 단차를 가로선과 **똑같이 그리면 캔들 심지로 읽힌다** (2026-08-15 사용자 지적).
 *   진입선 색이 캔들의 상승/하락 색과 같은 계열(초록/빨강)이라 특히 위험하다.
 *   그래서 세로만 점선 + 더 흐리게 그린다 — 심지는 **실선**이라 한눈에 갈린다.
 *   ※ 가로선까지 점선으로 만들지 말 것. 진입선은 확정된 사실이라 실선이어야 하고,
 *     이 앱에서 점선은 "아직 확정 아님"(진행 중 레그)이나 "알림 ON"의 뜻이다.
 *
 * ※ 위치도 한 겹 더 보호막이다: 계단의 x는 **봉 왼쪽 가장자리**(floor(idx) - 0.5)라
 *   캔들 사이 틈에 선다. 심지는 봉 중앙(xScale(i))이라 x가 애초에 겹치지 않는다.
 *   다만 축소해서 봉이 촘촘해지면 그 차이가 사라지므로, 점선이 본 방어선이다.
 *
 * entryPathPoints를 그대로 쪼개므로 좌표가 어긋날 수 없다 (대각선 없음은 node 검산됨).
 * @returns {{h: {x1:number,x2:number,y:number}[], v: {x:number,y1:number,y2:number}[]}}
 */
export function entryPathSegments(...args) {
  const pts = entryPathPoints(...args);
  const h = [], v = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.y === b.y) { if (b.x !== a.x) h.push({ x1: a.x, x2: b.x, y: a.y }); }
    else v.push({ x: a.x, y1: a.y, y2: b.y });
  }
  return { h, v };
}
