/**
 * 공통 캔버스 유틸리티
 * - initCanvas: DPR 대응 캔버스 초기화 + ctx 반환
 * - withClip:   save → clip → translate → fn → restore 래퍼
 * - getVisibleRange: xScale 기반 가시 캔들 인덱스 범위 계산
 */

export function initCanvas(canvas, logW, logH) {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width  !== Math.round(logW * dpr) ||
      canvas.height !== Math.round(logH * dpr)) {
    canvas.width        = Math.round(logW * dpr);
    canvas.height       = Math.round(logH * dpr);
    canvas.style.width  = logW + "px";
    canvas.style.height = logH + "px";
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, logW, logH);
  return ctx;
}

// fn 내부 좌표는 (x, y) 기준 상대 좌표
export function withClip(ctx, x, y, w, h, fn) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  fn(ctx);
  ctx.restore();
}

// 봉 몸통 폭 — 캔들과 거래량 바가 **같은 함수를 쓴다**.
// 둘은 세로로 나란히 놓여서 폭이 갈리면 바로 눈에 띈다 (예전엔 0.65 / 0.6으로 따로였다).
//
// 비율이 고정이 아니다 (트레이딩뷰 lightweight-charts 방식):
// 간격이 좁을 때는 1.0에 가까워 몸통이 간격을 거의 채우고,
// 넓어질수록 BODY_MIN_RATIO(0.8)로 수렴해 봉 사이가 벌어진다.
//   pxPerBar  4 → 4.00 (1.00)   8 → 6.65 (0.83)
//            20 → 16.2 (0.81)  50 → 40.1 (0.80)
//
// ⚠ 폭만 정한다 — 그리는 **위치**(xScale(i))는 건드리지 않는다.
//   위치를 정수로 스냅하면 오버레이·히트 판정과 어긋난다 (저쪽은 xScale을 그대로 쓴다)
// ※ pxPerBar < 2는 두 렌더러 모두 압축 모드로 빠져 1px 선을 긋는다 — 여기 오지 않는다
const BODY_MIN_RATIO = 0.8;   // 충분히 확대했을 때의 몸통/간격 비율
const BODY_KNEE      = 4;     // 이 간격까지는 비율 1.0 (간격을 꽉 채운다)

export function barBodyWidth(pxPerBar) {
  const over  = Math.max(BODY_KNEE, pxPerBar) - BODY_KNEE;
  const coeff = 1 - (1 - BODY_MIN_RATIO) * Math.atan(over) / (Math.PI / 2);
  return Math.max(pxPerBar * coeff, 1);
}

export function getVisibleRange(xScale, candleCount) {
  const [dMin, dMax] = xScale.domain();
  return [Math.max(0, Math.floor(dMin)), Math.min(candleCount - 1, Math.ceil(dMax))];
}
