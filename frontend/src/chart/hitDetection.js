import { HIT } from "../constants.js";
import { distToSeg, findHitLine } from "../utils/hitTest.js";
import { tsToIdx } from "./scales.js";
import { idxToTimestamp, getCandleMs } from "../utils/coordUtils.js";
import { clearAllSelections, selectDrawable, ZZ_ID } from "./drawables.js";
import { fibPrice, fibLevelsOf } from "./fib.js";

// 채널 두 선의 픽셀 좌표 계산
export function channelXYs(ch, candles, xScale, yScale, _isLog = false) {
  const i1 = tsToIdx(ch.t1, candles), i2 = tsToIdx(ch.t2, candles);
  const chIsLog = ch.isLog ?? false;
  const offset2 = ch.offset2 ?? ch.offset;
  const p1off = chIsLog ? ch.p1 * ch.offset : ch.p1 + ch.offset;
  const p2off = chIsLog ? ch.p2 * offset2   : ch.p2 + offset2;
  return {
    ax: xScale(i1), ay: yScale(ch.p1),
    bx: xScale(i2), by: yScale(ch.p2),
    ax2: xScale(i1), ay2: yScale(p1off),
    bx2: xScale(i2), by2: yScale(p2off),
  };
}

export function findHitChannel(px, py, channels, xScale, yScale, candles, threshold = 8, isLog = false) {
  return channels.find(ch => {
    const { ax, ay, bx, by, ax2, ay2, bx2, by2 } = channelXYs(ch, candles, xScale, yScale, isLog);
    return distToSeg(px, py, ax, ay, bx, by)    < threshold
        || distToSeg(px, py, ax2, ay2, bx2, by2) < threshold;
  });
}

export function findHitCircle(px, py, circles, xScale, yScale, candles, threshold = 8) {
  return circles.find(ci => {
    const cx = xScale(tsToIdx(ci.cx_t, candles)), cy = yScale(ci.cx_p);
    const rx = xScale(tsToIdx(ci.rx_t, candles)), ry = yScale(ci.rx_p);
    const r  = Math.hypot(rx - cx, ry - cy);
    return Math.abs(Math.hypot(px - cx, py - cy) - r) < threshold;
  });
}

// ── 측정 박스 ────────────────────────────────────────────────────────────────

/**
 * 사각형의 화면 좌표. `t1/p1`이 드래그를 시작한 모서리라 순서가 곧 등락률의 부호다
 * (chart/measure.js) — 여기서 min/max로 정렬한 값(xa…yb)은 **그리기·히트 전용**이다.
 */
export function measureXYs(m, candles, xScale, yScale) {
  const x1 = xScale(tsToIdx(m.t1, candles)), x2 = xScale(tsToIdx(m.t2, candles));
  const y1 = yScale(m.p1), y2 = yScale(m.p2);
  return {
    x1, y1, x2, y2,
    xa: Math.min(x1, x2), xb: Math.max(x1, x2),
    ya: Math.min(y1, y2), yb: Math.max(y1, y2),
  };
}

/**
 * 측정 박스 히트 → 그 도형 (없으면 undefined).
 *
 * ⚠ **테두리만 잡는다 — 안쪽은 비워 둔다.** 면까지 잡으면 박스를 크게 그렸을 때
 *   그 영역에서 차트를 끌 수도, 밑에 깔린 도형을 고를 수도 없다.
 *   원이 테두리만 잡는 것과 같은 이유다 (이 앱에서 면은 표시일 뿐 손잡이가 아니다)
 */
export function findHitMeasure(px, py, measures, xScale, yScale, candles, threshold = 8) {
  return (measures ?? []).find(m => {
    const { xa, xb, ya, yb } = measureXYs(m, candles, xScale, yScale);
    const inX = px >= xa - threshold && px <= xb + threshold;
    const inY = py >= ya - threshold && py <= yb + threshold;
    const nearV = inY && (Math.abs(px - xa) < threshold || Math.abs(px - xb) < threshold);
    const nearH = inX && (Math.abs(py - ya) < threshold || Math.abs(py - yb) < threshold);
    return nearV || nearH;
  });
}

/**
 * 커서가 잡은 모서리 → 고칠 좌표 키. 사각형의 네 모서리는 `t1|t2` × `p1|p2`
 * 조합이라 키 두 개면 전부 표현된다 (좌표를 네 벌로 늘리지 말 것).
 * @returns { tKey, pKey } | null
 */
export function measureCornerHit(m, px, py, xScale, yScale, candles, threshold = 10) {
  const { x1, y1, x2, y2 } = measureXYs(m, candles, xScale, yScale);
  for (const [tKey, cxv] of [["t1", x1], ["t2", x2]]) {
    for (const [pKey, cyv] of [["p1", y1], ["p2", y2]]) {
      if (Math.hypot(px - cxv, py - cyv) < threshold) return { tKey, pKey };
    }
  }
  return null;
}

// ── 피보나치 되돌림 ──────────────────────────────────────────────────────────

/**
 * 두 앵커의 x 픽셀 — 레벨 가로선의 양 끝 (chart/fib.js [F4]).
 *
 * fib.js가 아니라 여기 있는 이유: tsToIdx → scales → d3 체인이 딸려오면 fib.js를
 * node에서 바로 import해 검증할 수 없게 된다 (pivotLevels.js와 같은 방침).
 */
export function fibXs(fib, candles, xScale) {
  const xa = xScale(tsToIdx(fib.t1, candles));
  const xb = xScale(tsToIdx(fib.t2, candles));
  return { xa, xb, xMin: Math.min(xa, xb), xMax: Math.max(xa, xb) };
}

/**
 * 피보나치 히트 → 그 도형 (없으면 undefined).
 *
 * 잡히는 곳은 **레벨 가로선**과 앵커를 잇는 대각선 둘 다다. 대각선까지 넣는 이유:
 * 레벨을 1개만 켜 두거나 전부 끄면(더블클릭 팝업 — fib.js [F1]) 가로선이 없어져
 * 도형을 고를 데가 사라지고, 그러면 팝업을 열 방법도 없어져 되살릴 수가 없다.
 *
 * ⚠ 레벨은 **화면에 그려지는 것과 같아야 한다** → 렌더(Fibs.jsx)와 똑같이
 *   `fibLevelsOf(fb)`로 도형에서 직접 읽는다. 여기서 다시 만들면 꺼 둔 레벨이 클릭에 잡힌다.
 */
export function findHitFib(px, py, fibs, xScale, yScale, candles, isLog = false, threshold = 8) {
  return (fibs ?? []).find(fb => {
    const { xa, xb, xMin, xMax } = fibXs(fb, candles, xScale);
    if (px < xMin - threshold || px > xMax + threshold) return false;   // x 범위로 먼저 컷
    if (distToSeg(px, py, xa, yScale(fb.p1), xb, yScale(fb.p2)) < threshold) return true;
    return fibLevelsOf(fb).some(r => {
      const y = yScale(fibPrice(fb.p1, fb.p2, r, isLog));
      return Math.abs(py - y) < threshold;
    });
  });
}

// timestamp → 현재 타임프레임 bar index → 픽셀 좌표
// ── 진입선 우측 행: `+TP` `+SL` · 수량 배지 · `×` · `LONG/SHORT` ──────────────
//
// ⚠ **`+TP`/`+SL`은 우측 진입 라벨 옆이다** (2026-08-22 사용자 요청).
//   예전엔 좌측(x0=10)이었다 — 등록된 TP/SL 핸들과 **같은 자리**라, 아직 주문이 아닌
//   것과 이미 걸린 것이 같은 레인에 번갈아 나타났다. 지금은 자리로 갈린다:
//     · 아직 없다  → **우측**, 진입 라벨 옆의 `+TP`/`+SL` (잡고 끌면 등록)
//     · 이미 있다  → **좌측**, 기존 `TP`/`SL` 핸들 + 수량 배지
//   ※ 그래서 한쪽만 걸어 두면 좌우로 갈린다(TP는 왼쪽, `+SL`은 오른쪽) — 의도된 것이다
//
// 행은 **오른쪽 끝에서 왼쪽으로** 쌓는다 (오른쪽 여백은 좌측 버튼과 같은 TPSL_BTN.x0):
//     [+TP][+SL][수량][×][LONG]
//                        └ 라벨이 맨 오른쪽 — 어느 선의 행인지가 끝에서 읽힌다
//
// ⚠ 렌더(PositionLines.jsx)와 히트 판정(buildHitChain)이 **이 함수 하나만** 본다.
//   각자 좌표를 만들면 눈에 보이는 자리와 실제로 잡히는 자리가 어긋난다
//   (피보나치 레벨 배열을 렌더·히트·알림이 같이 쓰는 것과 같은 이유)
export const TPSL_BTN = { w: 28, h: 15, gap: 3, x0: 10 };

// 수량 배지 — `0.173`이 들어가는 폭. 마커 버튼(28)은 **그대로 두고** 옆에 따로 붙인다
// (2026-08-22 사용자 확정: "버튼 크기는 지금이 좋고, 수량은 같은 디자인으로 옆에")
// ⚠ 단위 `BTC`를 뗀 만큼 폭도 같이 줄였다 (60 → 36 → **32**, 2026-08-22 / 2026-08-27).
//   안 줄이면 몇 글자 안 든 배지에 좌우 여백만 남아 혼자 커 보인다.
//   32는 **가장 긴 글자가 들어가는 최소치**다 — `1.001` 5글자 × 5.7px(9.5px 등폭,
//   BalanceCard의 `CHAR_W = 0.6`과 같은 값) = 28.5 + 좌우 여백 2px씩.
//   ⚠ 자릿수가 늘면(수량이 10 이상, 심볼 추가) 여기도 같이 올릴 것 — 안 올리면
//     SVG text는 잘리지 않고 **테두리 밖으로 삐져나온다**
export const QTY_BADGE = { w: 32 };

// 비율 배지 — `추가`/`분할`에만 붙는 `29%` (2026-08-22 사용자 요청).
// ⚠ 수량 배지를 넓혀 한 칸에 `0.009 BTC · 5%`로 합치지 말 것 — 폭이 90px를 넘어가고,
//   TP/SL·진입 라벨은 비율이 없어서(전량 = 100%) 저것들까지 같이 넓어진다.
//   배지를 하나 더 두면 **있는 마커에만** 늘어난다 (버튼을 옆에 붙이는 것과 같은 규칙)
// ⚠ 폭은 **21**이다 (2026-08-27 사용자 요청으로 28 → 24 → 21).
//   `%` 글자를 뗀 만큼 좌우를 같이 줄인 것이다 (`BTC`를 떼며 수량 배지를 줄인 것과
//   같은 규칙 — 안 줄이면 두 글자짜리 배지에 여백만 남아 혼자 커 보인다).
//   들어가는 글자는 `<1`~`173`뿐 = 3글자 × 5.7px = 17.1 + 좌우 여백 2px씩
//   ※ 그래서 마커 버튼(28)·수량 배지(32)보다 좁다 — 담는 글자 수가 다르니 폭도 다르다
export const PCT_BADGE = { w: 21 };

/**
 * 사이드별 우측 행 좌표. `+TP`/`+SL`·수량 배지·`×`·진입 라벨이 **한 덩어리**다.
 *
 * ⚠ 수량 배지는 **TP·SL이 둘 다 없을 때만** 이 행에 붙는다 (2026-08-22 사용자 확정).
 *   단일 TP/SL은 `closePosition`이라 대상 수량이 곧 포지션 전체 = 진입 라벨과 같은 값이다.
 *   하나라도 걸려 있으면 그쪽 좌측 마커가 이미 같은 숫자를 들고 있어 두 번 보인다
 */
export function posEntryRows(position, tpsl, yScale, IW, IH) {
  if (!position || !yScale || !IW) return [];
  const h = TPSL_BTN.h, gap = TPSL_BTN.gap;
  const rows = [];
  for (const [sideKey, side] of [["long", "LONG"], ["short", "SHORT"]]) {
    const p = position[sideKey];
    if (!p) continue;
    const ey = yScale(p.entryPrice);
    if (!seen(ey, IH)) continue;   // 진입선이 안 보이면 행도 두지 않는다
    const missing = ["tp", "sl"].filter(t => !tpsl?.[sideKey]?.[t]); // 이미 걸린 건 버튼 없음
    rows.push({
      side, sideKey, entryPrice: p.entryPrice, size: p.size,
      missing, showQty: missing.length === 2,
      y: rowY(ey),
    });
  }

  // ⚠ 두 행이 세로로 겹치면 **아래쪽 행 전체**를 밀어낸다 (2026-08-22, 행 단위로 확장).
  //   롱·숏 진입가가 붙어 있으면 실제로 포개지는데, 그러면 같은 자리에 사이드가 다른
  //   버튼이 겹쳐 **어느 쪽을 누른 건지 알 수 없다** — hitTpSlButton은 먼저 찾은 것(롱)을
  //   돌려준다. 예전엔 `+TP`/`+SL`만 밀었는데 지금은 라벨·×와 한 줄이라, 버튼만 내려가면
  //   덩어리가 둘로 쪼개져 보인다 → 행을 통째로 민다.
  //   밀린 행은 자기 선에서 살짝 벗어나지만(어느 선인지는 **색**이 말해준다),
  //   겹쳐서 눌리지 않는 것보다는 낫다
  if (rows.length === 2) {
    const [a, b] = rows[0].y <= rows[1].y ? [rows[0], rows[1]] : [rows[1], rows[0]];
    const need = h + gap;
    if (b.y - a.y < need) b.y = a.y + need;
  }

  for (const r of rows) {
    const y = Math.min(Math.max(r.y, 0), Math.max(0, IH - h));
    r.y     = y;
    r.label = { x: IW - TPSL_BTN.x0 - ENTRY_LABEL_W, y, w: ENTRY_LABEL_W, h };
    r.close = { x: r.label.x - gap - CLOSE_BTN.w,    y, w: CLOSE_BTN.w,   h };
    let x   = r.close.x;
    if (r.showQty) { x -= gap + QTY_BADGE.w; r.qty = { x, y, w: QTY_BADGE.w, h }; }
    else r.qty = null;
    // 오른쪽부터 채우므로 역순으로 놓는다 → 화면에는 왼쪽부터 `+TP` `+SL`
    r.add = [];
    for (const type of [...r.missing].reverse()) {
      x -= gap + TPSL_BTN.w;
      r.add.unshift({ side: r.side, sideKey: r.sideKey, type, x, y,
        w: TPSL_BTN.w, h, entryPrice: r.entryPrice });
    }
  }
  return rows;
}

/** 지금 화면에 있는 `+TP` / `+SL` 버튼 전부 (드래그로 새로 거는 입구) */
export function posTpSlButtons(position, tpsl, yScale, IW, IH) {
  return posEntryRows(position, tpsl, yScale, IW, IH).flatMap(r => r.add);
}

export function hitTpSlButton(px, py, buttons) {
  return buttons.find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) ?? null;
}

// ── 마커 옆 `×` 버튼 (2026-08-15) ───────────────────────────────────────────
// TP / SL / 추가 / 분할 옆, 그리고 진입 라벨(LONG/SHORT) 옆에 붙는 제거 버튼.
//
// ⚠ 사각형 계산은 **여기 세 함수뿐**이다. 렌더(PositionLines.jsx)와 클릭 판정(buildHitChain)이
//   같은 걸 부른다 — 각자 만들면 보이는 자리와 눌리는 자리가 어긋난다
export const CLOSE_BTN    = { w: 15 };
export const ENTRY_LABEL_W = 36;

const rowY = y => y - TPSL_BTN.h / 2;

/** 왼쪽 마커 버튼(TP/SL/추가/분할) 바로 오른쪽 */
export function closeBtnRect(y) {
  return { x: TPSL_BTN.x0 + TPSL_BTN.w + TPSL_BTN.gap, y: rowY(y), w: CLOSE_BTN.w, h: TPSL_BTN.h };
}
/**
 * 좌측 마커의 수량 배지 — `×` 오른쪽 (2026-08-22).
 * ⚠ **`×`를 밀어내지 않는다.** 배지를 마커와 × 사이에 끼우면 손에 익은 × 자리가 옮겨간다
 * ※ 드래그 판정 레인(왼쪽 60px)보다 오른쪽이라 조작에 걸리지 않는다 — 순수 표시다
 */
export function qtyBadgeRect(y) {
  const c = closeBtnRect(y);
  return { x: c.x + c.w + TPSL_BTN.gap, y: c.y, w: QTY_BADGE.w, h: TPSL_BTN.h };
}
/** 수량 배지 오른쪽에 붙는 비율 배지 (`추가`/`분할`만) */
export function pctBadgeRect(y) {
  const q = qtyBadgeRect(y);
  return { x: q.x + q.w + TPSL_BTN.gap, y: q.y, w: PCT_BADGE.w, h: TPSL_BTN.h };
}

const seen = (y, IH) => y >= -20 && y <= IH + 20; // PositionLines의 inView와 같은 기준

/**
 * 지금 화면에 있는 모든 × 버튼. kind로 무엇을 지우는지 구분한다.
 *  tp/sl → 알고 주문 취소 / scale_in·split_tp → 그 주문 취소 / entry → **포지션 청산**
 */
// 미체결 **진입** 주문의 대기선 (2026-08-23 사용자 요청).
//
// ⚠ **박스가 있는 사이드는 제외한다** — 우리가 낸 주문은 플랜 박스가 이미 그 가격을
//   보여준다. 둘 다 그리면 같은 선이 두 번 겹친다.
//   그래서 실제로 뜨는 건 **밖에서 낸 주문**(바이낸스 앱·웹)이 거의 전부다
// ⚠ 렌더(PositionLines)와 히트 판정(markerCloseButtons)이 **이 함수 하나**를 본다.
//   각자 계산하면 보이는 자리와 눌리는 자리가 어긋난다
// ※ 드래그로 가격을 옮길 수는 없다 — 옮기려면 취소 후 재등록이라 주문번호가 바뀌고,
//   외부 주문은 우리가 수량·TP/SL을 정할 근거가 없다. `×`로 취소만 된다
export function pendingEntryLines({ position, drawings, yScale, IH }) {
  if (!yScale || !position?.pending) return [];
  const out = [];
  for (const [sideKey, side] of [["long", "LONG"], ["short", "SHORT"]]) {
    const p = position.pending[sideKey];
    if (!p?.price) continue;
    if (drawings?.[sideKey]) continue;          // 박스가 대신 보여준다
    const y = yScale(p.price);
    if (!seen(y, IH)) continue;
    out.push({
      side, sideKey, orderId: p.orderId, price: p.price, qty: p.qty, y,
      close: closeBtnRect(y),
    });
  }
  return out;
}

export function markerCloseButtons({ position, tpsl, scaleInOrders, splitTps, partialSls, drawings, yScale, IW, IH }) {
  if (!yScale) return [];
  const out = [];
  const push = (kind, price, extra) => {
    const y = yScale(price);
    if (!seen(y, IH)) return;
    out.push({ kind, ...extra, ...closeBtnRect(y) });
  };
  for (const [sideKey, side] of [["long", "LONG"], ["short", "SHORT"]]) {
    for (const which of ["tp", "sl"]) {
      const t = tpsl?.[sideKey]?.[which];
      if (t?.price != null) push(which, t.price, { side });
    }
  }
  for (const o of scaleInOrders ?? []) push("scale_in", o.price, { orderId: o.orderId });
  for (const o of splitTps      ?? []) push("split_tp", o.price, { orderId: o.orderId });
  for (const o of partialSls    ?? []) push("partial_sl", o.price, { orderId: o.orderId });
  // 진입 대기선의 × — 주문 취소일 뿐이라 한 번에 지운다 (진입 라벨의 ×만 2회 확인)
  for (const p of pendingEntryLines({ position, drawings, yScale, IH }))
    out.push({ kind: "pending", side: p.side, orderId: p.orderId, ...p.close });
  // 진입 라벨의 ×는 우측 행에서 가져온다 — **밀린 행이면 밀린 자리**여야 클릭이 맞는다.
  // 맨 뒤에 두는 이유: 겹칠 일은 없지만(가로 위치가 반대편) 파괴적인 항목을 마지막에
  for (const r of posEntryRows(position, tpsl, yScale, IW, IH)) {
    out.push({ kind: "entry", side: r.side, size: r.size, ...r.close });
  }
  return out;
}

export function lineXY(t, p, candles, xScale, yScale) {
  return { x: xScale(tsToIdx(t, candles)), y: yScale(p) };
}

// 마우스 픽셀 → timestamp + 가격 (미래 영역 외삽 포함)
// ※ 이름과 달리 OHLC로 스냅하지 않는다 — 트렌드라인/채널/원은 자유 좌표를 쓴다.
export function snapToOHLC(pos, candles, xScale, yScale) {
  return { t: idxToTimestamp(xScale.invert(pos.x), candles), p: yScale.invert(pos.y) };
}

// ── 수동 구조(Structure) ─────────────────────────────────────────────────────

// 구조 꼭짓점 스냅 반경(봉).
//
// ※ 사용자 확정값 — 처음 3으로 만들었다가 "마그넷이 강하다"는 요청으로 절반인 1로 낮췄다.
//   임의로 되돌리거나 키우지 말 것. 더 약하게 원하면 0(커서가 있는 봉의 꼬리에만 스냅).
// ※ 클릭 배치(hitDetection 0.7)와 미리보기(useChartInteraction)가 **반드시 같은 값**을
//   써야 커서에 보이던 위치와 실제 찍히는 위치가 어긋나지 않는다. 호출부마다 숫자를
//   따로 넣지 말고 이 상수를 참조할 것.
export const STRUCT_SNAP_BARS = 1;

// 자동 이어그리기 점의 클릭 반경 — 다른 핸들의 잡는 반경(10)과 같은 값이다.
// 자동 점에는 마커를 그리지 않으므로(꺾이는 자리만 보인다) 반경이 유일한 판정이다.
// ※ 이름이 STRUCT_LIVE_HIT이던 것을 2026-08-26에 바꿨다 — 진행 중 레그가 삭제되면서
//   "live"가 가리키던 대상이 사라졌다
export const STRUCT_AUTO_HIT = 10;

/**
 * **클릭해 확정할 수 있는 지점**을 찾는다 (2026-08-26).
 *
 * 후보는 **자동 이어그리기의 자동 점 하나하나**다 — 켜 둔 구조마다 있어서 여러 개일 수 있다.
 * ⚠ 진행 중 레그 끝점 분기는 **2026-08-26에 그 기능과 함께 삭제**됐다 (Structures.jsx [R3]).
 * 어느 것을 눌러도 **거기까지만** 확정되고 그 뒤는 다시 자동으로 계산된다 —
 * 그래서 중간 점을 눌러 "여기까지는 맞다"고 잘라 갈 수 있다.
 *
 * ⚠ **히트와 커서가 같은 좌표를 봐야 한다.** 여기 하나만 부르게 할 것 —
 *   각자 계산하면 커서가 바뀌는 자리와 눌리는 자리가 어긋난다 (posTpSlButtons와 같은 이유).
 *
 * @param chains structRenderState.getStructAutoChains() — [{ structId, points }]
 * @returns { structId, points } | null — points = 그 지점까지 구조에 넣을 꼭짓점
 *          (배열은 반경 안에 들어왔을 때만 만든다 — 커서 판정이 마우스 이동마다 부른다)
 */
export function structAutoCommitHit(chains, pos, xScale, yScale, candles) {
  const distTo = (t, p) =>
    Math.hypot(pos.x - xScale(tsToIdx(t, candles)), pos.y - yScale(p));

  let best = null, bestD = STRUCT_AUTO_HIT;
  for (const ch of chains ?? []) {
    for (let j = 0; j < ch.points.length; j++) {
      const d = distTo(ch.points[j].t, ch.points[j].p);
      if (d <= bestD) { bestD = d; best = { structId: ch.structId, chain: ch.points, upto: j + 1 }; }
    }
  }
  if (!best) return null;
  return { structId: best.structId, points: best.chain.slice(0, best.upto) };
}

/**
 * 구조 꼭짓점용 스냅 — 커서 주변 봉 중 고가 최대(또는 저가 최소) 지점에 붙인다.
 * 구조 꼭짓점은 항상 꼬리 끝에 놓이므로 자유 좌표보다 스냅이 정확하고 빠르다.
 *
 * @param expectType "H"|"L"|null — null이면 커서가 봉의 위/아래 어디인지로 판정
 * @param windowBars 탐색 반경(봉). 드래그는 0(커서가 있는 봉에만 붙어 정확히 추종)
 */
export function snapToStructurePoint(pos, candles, xScale, yScale, expectType = null, windowBars = STRUCT_SNAP_BARS) {
  if (!candles.length) return null;
  const center = Math.max(0, Math.min(Math.round(xScale.invert(pos.x)), candles.length - 1));
  const price  = yScale.invert(pos.y);

  let type = expectType;
  if (!type) {
    const c = candles[center];
    type = price >= (c.h + c.l) / 2 ? "H" : "L";
  }

  const lo = Math.max(0, center - windowBars);
  const hi = Math.min(candles.length - 1, center + windowBars);
  let best = center;
  for (let i = lo; i <= hi; i++) {
    if (type === "H" ? candles[i].h > candles[best].h : candles[i].l < candles[best].l) best = i;
  }
  return { t: +candles[best].t, p: type === "H" ? candles[best].h : candles[best].l, type };
}

export function structureXYs(st, candles, xScale, yScale) {
  return (st.points ?? []).map(pt => ({ x: xScale(tsToIdx(pt.t, candles)), y: yScale(pt.p) }));
}

export function findHitStructure(px, py, structures, xScale, yScale, candles, threshold = 8) {
  return (structures ?? []).find(st =>
    findStructSegmentIdx(st, px, py, xScale, yScale, candles, threshold) !== -1
  );
}

// 꼭짓점 히트 → points 배열의 인덱스 (없으면 -1)
export function findHitStructPointIdx(st, px, py, xScale, yScale, candles, threshold = 10) {
  const xy = structureXYs(st, candles, xScale, yScale);
  for (let k = 0; k < xy.length; k++) {
    if (Math.hypot(px - xy[k].x, py - xy[k].y) < threshold) return k;
  }
  return -1;
}

/**
 * 기존 구조의 **양 끝** 꼭짓점 히트 → { id, fromStart }
 * 구조 모드에서 이어 그리기를 시작할 지점을 찾는 용도라 중간 꼭짓점은 보지 않는다.
 *
 * 잠긴 구조는 후보에서 뺀다 — 연장·흡수 둘 다 잠금이 막는 동작이라([SL1]),
 * 끝점 근처를 클릭하면 그냥 새 꼭짓점이 찍히는 게 맞다.
 * ※ 잠금의 실제 보장은 useStructures 쪽 가드다. 여기는 커서 편의일 뿐이다.
 */
export function findStructEndpointHit(px, py, structures, xScale, yScale, candles, threshold = 10) {
  for (const st of structures ?? []) {
    if (st.locked || !st.points?.length) continue;
    const xy = structureXYs(st, candles, xScale, yScale);
    const a = xy[0], b = xy[xy.length - 1];
    if (Math.hypot(px - b.x, py - b.y) < threshold) return { id: st.id, fromStart: false };
    if (xy.length > 1 && Math.hypot(px - a.x, py - a.y) < threshold) return { id: st.id, fromStart: true };
  }
  return null;
}

// 선분 히트 → 그 선분의 끝점 인덱스 k (= 삽입 위치). 없으면 -1
export function findStructSegmentIdx(st, px, py, xScale, yScale, candles, threshold = 8) {
  const xy = structureXYs(st, candles, xScale, yScale);
  for (let k = 1; k < xy.length; k++) {
    if (distToSeg(px, py, xy[k - 1].x, xy[k - 1].y, xy[k].x, xy[k].y) < threshold) return k;
  }
  return -1;
}

/**
 * 자동 ZZ 지그재그 레그 히트 → 그 세그먼트 `{ i1, p1, i2, p2 }` (없으면 null).
 * 좌표가 bar index라 수동 구조와 달리 tsToIdx 변환이 필요 없다.
 *
 * 누적 세그먼트가 수천 개까지 가므로 distToSeg 전에 x 범위로 먼저 거른다.
 */
export function findHitZzLeg(px, py, segments, xScale, yScale, threshold = 8) {
  for (const sg of segments ?? []) {
    const ax = xScale(sg.i1), bx = xScale(sg.i2);
    if (Math.max(ax, bx) < px - threshold || Math.min(ax, bx) > px + threshold) continue;
    if (distToSeg(px, py, ax, yScale(sg.p1), bx, yScale(sg.p2)) < threshold) return sg;
  }
  return null;
}

/**
 * 지그재그 레그 위에 마우스를 올렸을 때 보여줄 정보 — 없으면 null.
 *
 *   { pct, i1, i2, prev: { i1, i2 } | null }
 *     pct  : 그 레그의 등락률(%)
 *     i1,i2: 레그의 bar index 범위 (거래량 합산용 — chart/legVolume.js)
 *     prev : **직전 동일방향 레그**의 범위. 지그재그는 상승·하락이 반드시 교대하므로
 *            두 칸 앞이 곧 같은 방향이다 → 방향 판정 없이 정확하다
 *
 * 수동 구조와 자동 ZZ를 **같은 규칙**으로 훑는다. 좌표계만 다르다:
 *   - 수동 구조: 꼭짓점이 timestamp → tsToIdx로 bar index 변환 (structureXYs)
 *   - 자동 ZZ:   세그먼트가 이미 bar index (getZzSegments)
 * 두 지표가 겹쳐 있으면 먼저 잡히는 쪽(수동 구조)이 이긴다 — 사용자가 직접 그린
 * 구조가 자동 검출보다 의도가 분명하므로.
 *
 * 자동 ZZ는 진행 중 레그(마지막 세그먼트)도 포함한다.
 * ⚠ 수동 구조 쪽 진행 중 레그(점선)는 **2026-08-26에 기능째 삭제**됐다 —
 *   여기 있던 liveSegment 분기와 `[R8]`(prev를 실어 보내기)도 같이 사라졌다.
 * ※ 자동 이어그리기 구간의 레그는 **아직 hover가 안 된다** — 그 점들은 st.points에
 *   없어서 아래 루프가 훑지 못한다. 붙이려면 자동 점을 여기까지 넘겨야 한다 (미구현).
 *
 * threshold는 클릭 판정(8)보다 좁은 6 — hover는 잘못 걸리면 라벨이 깜빡여서 거슬린다.
 */
/**
 * [LV7] ⚠ **비교는 그 구조 안에서만 한다. 다른 구조를 끌어오지 말 것.**
 *   (2026-08-13 사용자 확정 — 한때 있던 `findPrevSameDirLeg` 폴백을 제거했다)
 *
 * 구조의 **첫 상승 레그와 첫 하락 레그는 비교 대상이 없다 → 증감률을 띄우지 않는다.**
 * 이게 정상이다. "비교할 게 없는데 왜 숫자가 뜨냐"가 실제로 나온 지적이다.
 *
 * 폴백이 있던 시절엔 며칠 전에 그린 **다른 구조**의 레그를 끌어와 비교했다.
 * 화면에서 두 구조는 이어져 있지도 않은데 숫자만 뜨니, 그게 어디서 온 값인지
 * 알 수 없었다. 되살리지 말 것 — 구조 하나가 곧 하나의 비교 단위다.
 */
export function findHoveredLeg({
  px, py, structures, zzSegments, xScale, yScale, candles, threshold = 6,
  // 자동 ZZ의 `거래량 비교` — 지표 단위 설정이라 인자로 받는다 (수동 구조는 도형이
  // 자기 값을 들고 있어 st.showLegVol을 직접 읽는다). 2026-08-24 되살림
  zzShowVol = true,
}) {
  const pct = (p1, p2) => (p1 ? ((p2 - p1) / p1) * 100 : null);

  for (const st of structures ?? []) {
    const xy = structureXYs(st, candles, xScale, yScale);
    for (let k = 1; k < xy.length; k++) {
      if (distToSeg(px, py, xy[k - 1].x, xy[k - 1].y, xy[k].x, xy[k].y) < threshold) {
        const pts = st.points;
        // 레그 k는 pts[k-1]→pts[k]. 두 칸 앞 레그(k-2)가 같은 방향이다.
        // 없으면(= 이 구조의 첫 상승/첫 하락) 비교 대상이 없는 것이다 → null [LV7]
        const prev = k >= 3
          ? { i1: tsToIdx(pts[k - 3].t, candles), i2: tsToIdx(pts[k - 2].t, candles) }
          : null;
        return {
          pct: pct(pts[k - 1].p, pts[k].p),
          i1: tsToIdx(pts[k - 1].t, candles),
          i2: tsToIdx(pts[k].t, candles),
          prev,
          // 거래량 3줄 표시 여부는 **구조마다** (더블클릭 팝업 `거래량 비교`). undefined = ON
          showVol: st.showLegVol === true,
        };
      }
    }
  }

  const segs = zzSegments ?? [];
  for (let k = 0; k < segs.length; k++) {
    const sg = segs[k];
    const ax = xScale(sg.i1), bx = xScale(sg.i2);
    if (Math.max(ax, bx) < px - threshold || Math.min(ax, bx) > px + threshold) continue;
    if (distToSeg(px, py, ax, yScale(sg.p1), bx, yScale(sg.p2)) < threshold) {
      const p = k >= 2 ? segs[k - 2] : null;
      return {
        pct: pct(sg.p1, sg.p2),
        i1: sg.i1, i2: sg.i2,
        prev: p ? { i1: p.i1, i2: p.i2 } : null,
        // 거래량 3줄 표시 여부 — 자동 ZZ는 **지표 하나에 값 하나**다
        // (수동 구조는 구조마다 따로. 저쪽은 도형이 여러 개고 이쪽은 하나뿐이라 그렇다)
        showVol: zzShowVol !== false,
      };
    }
  }
  return null;
}

// ── onMouseDown 히트 테스트 체인 ──────────────────────────────────────────────
export function buildHitChain(ctx) {
  const {
    pos, xScale, yScale, candles,
    lineMode, lineStart, setLineStart, addLine,
    selectedLineId, lines, dragRef,
    hasPos, hasLong, hasShort, tpsl, scaleInOrders, splitTps, partialSls,
    position, IH, IW, onMarkerClose,
    drawings, selectedBox, locked, drawMode, setCurrent,
    xDomainRef,
    setSelectedBox,
    isLog,
    drawables,
    // 채널
    channelMode, channelStep, setChannelStep,
    channelPoints, setChannelPoints, channelPreview,
    channels, selectedChannelId,
    addChannel, updateChannelEndpoint, setChannelPosition, setChannelOffset,
    // 원
    circleMode, circleCenter, setCircleCenter, circlePreview,
    circles, selectedCircleId,
    addCircle, moveCircle,
    // 피보나치 되돌림 — 표시할 레벨은 도형별이라 findHitFib가 직접 읽는다 ([F1])
    fibMode, fibStart, setFibStart, fibPreview,
    fibs, selectedFibId, addFib,
    // 측정 박스 — **드래그로 그린다** (2클릭이 아니다, useMeasures.js)
    measureMode, setMeasureDraft,
    measures, selectedMeasureId,
    // 수동 구조
    structMode, structDraft, addStructDraftPoint, startExtendStruct, mergeStructIntoDraft,
    structures, selectedStructId, structPart, selectStructPart,
    structAutoChains, commitStructPoints,   // 자동 점을 눌러 확정 (3.95)
    // 자동 ZZ — 도형이 아니라 지표라 선택만 한다 (드래그/삭제 없음)
    showZZ, zzSegments,
    // 차트에서 분할 주문 걸기 (2026-08-27) — 켜져 있으면 체인 맨 앞에서 가로챈다
    orderPick,
  } = ctx;

  // 다음에 찍을 꼭짓점 타입 — 직전 점의 반대 (첫 점은 커서 위치로 판정)
  const lastDraft   = structDraft?.points?.[structDraft.points.length - 1];
  const nextPtType  = lastDraft ? (lastDraft.type === "H" ? "L" : "H") : null;

  // ── 플랜 박스 (롱·숏 각각 하나, 2026-08-19) ──────────────────────────────
  // 겹쳤을 때 훑는 순서: **선택된 박스 → 롱 → 숏**.
  // 고정 순서만 두면 위에 깔린 박스가 아래 박스를 영영 가린다 — 한 번 클릭해
  // 선택하면 그다음부터 그쪽이 먼저 잡히므로 사용자가 손으로 풀 수 있다.
  const hasAnyBox = !!(drawings?.long || drawings?.short);
  const boxOrder = () => {
    const out = [];
    const push = (k) => { const b = drawings?.[k]; if (b) out.push([k === "long", b]); };
    if (selectedBox) push(selectedBox);
    if (selectedBox !== "long")  push("long");
    if (selectedBox !== "short") push("short");
    return out;
  };
  const selectBox = (isLong) => {
    setSelectedBox(isLong ? "long" : "short");
    clearAllSelections(drawables);
  };

  return [
    // 0.0. **차트에서 분할 주문 걸기** — 켜져 있으면 무엇보다 먼저다 (2026-08-27).
    //
    // 누르면 드래그를 시작만 시키고 나머지는 DRAG_HANDLERS.order_pick이 맡는다
    // (측정 박스와 같은 구조 — 클릭이냐 드래그냐가 손을 뗄 때 정해지므로).
    //
    // ⚠ **체인 맨 앞이어야 한다.** 이건 실주문이 나가는 모드라, 도형 그리기가 같이
    //   켜져 있더라도 "지금 차트를 누르면 무슨 일이 일어나는가"가 하나로 정해져야 한다.
    //   뒤에 두면 켜 둔 도형 모드가 먼저 잡아서, 주문을 걸려고 눌렀는데 선이 그어진다
    {
      when: !!orderPick,
      handle() {
        const p = yScale.invert(Math.min(Math.max(pos.y, 0), IH));
        dragRef.current = { type: "order_pick", startX: pos.x, startY: pos.y, p1: p };
      },
    },
    // 0. 채널 그리기 모드
    {
      when: channelMode,
      handle() {
        const { t, p } = snapToOHLC(pos, candles, xScale, yScale);
        if (channelStep === 0) {
          setChannelPoints({ t1: t, p1: p });
          setChannelStep(1);
        } else if (channelStep === 1) {
          setChannelPoints(prev => ({ ...prev, t2: t, p2: p }));
          setChannelStep(2);
        } else if (channelStep === 2 && channelPoints) {
          const defaultOffset = isLog ? 1 : 0;
          const offset = channelPreview?.offset ?? defaultOffset;
          addChannel(channelPoints.t1, channelPoints.p1, channelPoints.t2, channelPoints.p2, offset, isLog);
        }
      },
    },
    // 0.5. 원 그리기 모드
    {
      when: circleMode,
      handle() {
        const { t, p } = snapToOHLC(pos, candles, xScale, yScale);
        if (!circleCenter) {
          setCircleCenter({ t, p });
        } else {
          addCircle(circleCenter.t, circleCenter.p, t, p);
        }
      },
    },
    // 0.55. 측정 박스 그리기 모드 — **드래그다** (2026-08-26 사용자 지정).
    //       선·원·피보나치는 2클릭이지만 사각형은 플랜 박스와 같은 조작이 자연스럽다.
    //       그래서 여기서 클릭을 처리하지 않고 **드래그를 시작만** 시킨다 —
    //       나머지는 DRAG_HANDLERS.measure_draw가 맡는다 (chart/dragStateMachine.js)
    {
      when: measureMode,
      handle() {
        const { t, p } = snapToOHLC(pos, candles, xScale, yScale);
        setMeasureDraft({ t1: t, p1: p, t2: t, p2: p });
        dragRef.current = { type: "measure_draw", startX: pos.x, startY: pos.y, t1: t, p1: p };
      },
    },
    // 0.6. 피보나치 그리기 모드 — 2클릭 (원과 같은 구조).
    //      첫 클릭 = 추세 시작(레벨 1), 둘째 클릭 = 추세 끝(레벨 0) — chart/fib.js [F5].
    //      스냅 없음 — 트렌드라인·원과 같은 자유 좌표다
    {
      when: fibMode,
      handle() {
        const { t, p } = snapToOHLC(pos, candles, xScale, yScale);
        if (!fibStart) setFibStart({ t, p });
        else           addFib(fibStart.t, fibStart.p, t, p);
      },
    },
    // 0.7. 구조 그리기 모드 — 클릭할 때마다 꼭짓점 추가 (고/저 교대, 꼬리 스냅)
    //      확정은 우클릭 또는 더블클릭, 취소는 ESC (ChartArea/useKeyboardShortcuts에서 처리)
    {
      when: structMode,
      handle() {
        // 기존 구조의 끝점을 누르면 새 점을 찍는 대신 그 구조와 이어진다.
        // 구조를 쪼개두면 deriveStructure가 각각 bias=0으로 시작해 경계 CHoCH가 유실되므로,
        // "이어 그리기"와 "두 구조 잇기" 모두 하나의 구조로 합쳐야 한다.
        const hit = findStructEndpointHit(pos.x, pos.y, structures, xScale, yScale, candles);
        if (hit) {
          if (!structDraft) { startExtendStruct(hit.id, hit.fromStart); return; }
          const already = hit.id === structDraft.extendId
                       || structDraft.mergeIds?.includes(hit.id);
          if (!already) { mergeStructIntoDraft(hit.id, hit.fromStart); return; }
        }
        const snapped = snapToStructurePoint(pos, candles, xScale, yScale, nextPtType);
        if (snapped) addStructDraftPoint(snapped);
      },
    },
    // 1. 선 그리기 모드
    {
      when: lineMode,
      handle() {
        const { t, p } = snapToOHLC(pos, candles, xScale, yScale);
        if (!lineStart) setLineStart({ t, p });
        else            addLine(lineStart.t, lineStart.p, t, p);
      },
    },
    // 2. 선 끝점 드래그
    {
      when: selectedLineId !== null,
      handle() {
        const ln = lines.find(l => l.id === selectedLineId);
        if (!ln || ln.locked) return false;
        const { x: ax, y: ay } = lineXY(ln.t1, ln.p1, candles, xScale, yScale);
        const { x: bx, y: by } = lineXY(ln.t2, ln.p2, candles, xScale, yScale);
        if (Math.hypot(pos.x-ax, pos.y-ay) < 10) {
          dragRef.current = { type:"line_ep", lineId:selectedLineId, endpoint:"start" }; return true;
        }
        if (Math.hypot(pos.x-bx, pos.y-by) < 10) {
          dragRef.current = { type:"line_ep", lineId:selectedLineId, endpoint:"end"   }; return true;
        }
        // 2b. 선 몸통 드래그
        const bodyHit = isLog
          ? findHitLine(pos.x, pos.y, [ln], xScale, yScale, candles, 8, true)
          : distToSeg(pos.x, pos.y, ax, ay, bx, by) < 8;
        if (bodyHit) {
          dragRef.current = { type:"line_move", lineId:selectedLineId,
            startX:pos.x, startY:pos.y,
            startT1:ln.t1, startP1:ln.p1, startT2:ln.t2, startP2:ln.p2 };
          return true;
        }
        return false;
      },
    },
    // 3. 박스 라인 드래그
    //
    // ⚠ 박스가 **롱·숏 둘**이라 순서가 필요하다 (2026-08-19, `boxOrder`).
    //   **선택된 박스 → 롱 → 숏**. 두 박스가 겹치면 고정 순서만으로는 아래쪽을
    //   영영 못 잡는데, 한 번 클릭해 고르면 그다음부터 그쪽이 먼저 잡히므로
    //   사용자가 손으로 풀 수 있다. 순서를 고정으로 되돌리지 말 것
    {
      when: hasAnyBox,
      handle() {
        for (const [isLong, d] of boxOrder()) {
          // 같은 사이드 포지션이 열려 있으면 가격 3선은 못 끈다 (주문이 이미 나갔다)
          if (isLong ? hasLong : hasShort) continue;
          const ePx = yScale(d.entry), tPx = yScale(d.tp), slPx = yScale(d.sl);
          const x1  = xScale(tsToIdx(d.tStart, candles)), x2 = xScale(tsToIdx(d.tEnd, candles));
          if (pos.x < x1-10 || pos.x > x2+10) continue;
          const pick = (drag) => { selectBox(isLong); dragRef.current = { ...drag, isLong }; return true; };
          if (Math.abs(pos.y-slPx) < HIT) return pick({ type:"sl",    startY:pos.y, startSl:d.sl });
          if (Math.abs(pos.y-tPx)  < HIT) return pick({ type:"tp",    startY:pos.y, startTp:d.tp });
          if (Math.abs(pos.y-ePx)  < HIT) return pick({ type:"entry", startY:pos.y, startX:pos.x, startEntry:d.entry, startTp:d.tp, startSl:d.sl, startTStart:d.tStart, startTEnd:d.tEnd });
        }
        return false;
      },
    },
    // 3.2. 박스 좌우 폭 조절 (2026-08-14 사용자 요청) — 세로 모서리를 잡아 끈다.
    //
    //      y선(진입/TP/SL) **뒤**에 둔다: 모서리와 가로선이 만나는 꼭짓점에서는
    //      가로선이 이긴다. 가격을 옮기는 쪽이 주 기능이고 폭은 표시용이라 그 순서가 맞다.
    //
    //      sameSidePos여도 막지 않는다(위 3번과 다른 점) — 폭은 주문에 전혀 안 들어가는
    //      순수 표시값이라, 포지션이 열려 있어도 조절할 수 있어야 한다.
    //      ※ clamp 전 좌표를 본다 — BoxOverlay가 그립을 그리는 기준과 같아야 한다
    {
      when: hasAnyBox,
      handle() {
        const iw = xScale.range()[1];                  // = IW (getScales가 [0, IW]로 만든다)
        for (const [isLong, d] of boxOrder()) {
          const rx1 = xScale(tsToIdx(d.tStart, candles));
          const rx2 = xScale(tsToIdx(d.tEnd,   candles));
          const yLo = Math.min(yScale(d.tp), yScale(d.sl));
          const yHi = Math.max(yScale(d.tp), yScale(d.sl));
          if (pos.y < yLo - HIT || pos.y > yHi + HIT) continue;
          for (const [edge, ex] of [["start", rx1], ["end", rx2]]) {
            if (ex < 0 || ex > iw) continue;           // 화면 밖 모서리는 잡을 게 없다
            if (Math.abs(pos.x - ex) < HIT) {
              selectBox(isLong);
              dragRef.current = { type: "box_x", edge, isLong };
              return true;
            }
          }
        }
        return false;
      },
    },
    // 3.5. 박스 내부 클릭 → 선택 (선보다 우선)
    {
      when: hasAnyBox,
      handle() {
        for (const [isLong, d] of boxOrder()) {
          const x1   = xScale(tsToIdx(d.tStart, candles)), x2 = xScale(tsToIdx(d.tEnd, candles));
          const yMin = Math.min(yScale(d.tp), yScale(d.sl));
          const yMax = Math.max(yScale(d.tp), yScale(d.sl));
          if (pos.x >= x1 && pos.x <= x2 && pos.y >= yMin && pos.y <= yMax) {
            selectBox(isLong);
            return true;
          }
        }
        return false;
      },
    },
    // 3.7. 박스 그리기 시작 (선 선택보다 우선)
    {
      when: drawMode && !locked,
      handle() {
        dragRef.current = { type:"draw", startX:pos.x, startY:pos.y };
        setCurrent({ x1:pos.x, y1:pos.y, x2:pos.x, y2:pos.y });
      },
    },
    // 3.85. 마커의 `×` 버튼 — **드래그가 아니라 클릭**이다.
    // ⚠ 아래 드래그 단계들보다 **먼저** 와야 한다. ×는 왼쪽 60px 안에 있어서
    //   순서를 뒤집으면 누를 때마다 드래그가 먼저 잡혀 영영 눌리지 않는다
    {
      // 진입 대기선의 ×는 **포지션이 없을 때도** 떠 있다 — hasPos만 보면 안 눌린다
      when: !!onMarkerClose && (hasPos || !!scaleInOrders?.length || !!splitTps?.length || !!partialSls?.length
            || !!position?.pending?.long || !!position?.pending?.short),
      handle() {
        const btns = markerCloseButtons({ position, tpsl, scaleInOrders, splitTps, partialSls, drawings, yScale, IW, IH });
        const b = btns.find(v => pos.x >= v.x && pos.x <= v.x + v.w && pos.y >= v.y && pos.y <= v.y + v.h);
        if (!b) return false;
        onMarkerClose(b);
        return true;
      },
    },
    // 3.9. `+TP` / `+SL` 버튼 — TP/SL이 **없을 때** 드래그로 새로 거는 입구.
    // 아래 4번(기존 TP/SL 이동)과 대상이 겹치지 않는다: 버튼은 그 항목이 null일 때만 생긴다.
    // startPrice는 진입가지만 실제 값은 onMove가 커서에서 다시 계산하므로 표시용에 가깝다
    {
      when: hasPos && !!tpsl && !!position,
      handle() {
        const b = hitTpSlButton(pos.x, pos.y, posTpSlButtons(position, tpsl, yScale, IW, IH));
        if (!b) return false;
        dragRef.current = {
          type: b.type === "tp" ? "pos_tp" : "pos_sl",
          side: b.side, startY: pos.y, startPrice: b.entryPrice, creating: true,
        };
        return true;
      },
    },
    // 3.95. 진행 중 레그(점선)의 끝점 클릭 → **그 자리를 꼭짓점으로 확정** (2026-08-15).
    // 구조 모드로 들어가 끝점을 다시 클릭할 필요 없이, 점선이 이미 가리키고 있는 점만 누른다.
    // ⚠ 구조 모드에서는 동작하지 않는다 — 거기선 클릭이 이미 꼭짓점 추가라 뜻이 겹친다.
    //   ownerId가 없으면(draft) 역시 건너뛴다
    {
      when: !structMode && !drawMode && !!commitStructPoints,
      handle() {
        // 자동 점 하나하나 + 진행 중 레그 끝점이 전부 확정 지점이다 — 누른 지점**까지만**
        // 들어가고 그 뒤는 다시 자동으로 계산된다 (Structures.jsx [R12]).
        // ⚠ 어느 구조의 점인지도 여기서 나온다 — 자동 이어그리기는 구조마다 켤 수 있어서
        //   진행 중 레그를 가진 구조가 아닐 수도 있다
        const hit = structAutoCommitHit(structAutoChains, pos, xScale, yScale, candles);
        if (!hit) return false;
        commitStructPoints(hit.structId, hit.points);
        return true;
      },
    },
    // 4. TP/SL 드래그 (선 선택보다 우선) — 롱/숏 각각 처리
    {
      when: hasPos && !!tpsl && pos.x >= 0 && pos.x <= 60,
      handle() {
        const longTpPx  = tpsl.long?.tp  ? yScale(tpsl.long.tp.price)  : null;
        const longSlPx  = tpsl.long?.sl  ? yScale(tpsl.long.sl.price)  : null;
        const shortTpPx = tpsl.short?.tp ? yScale(tpsl.short.tp.price) : null;
        const shortSlPx = tpsl.short?.sl ? yScale(tpsl.short.sl.price) : null;
        if (longTpPx  !== null && Math.abs(pos.y-longTpPx)  < HIT) { dragRef.current = { type:"pos_tp", side:"LONG",  startY:pos.y, startPrice:tpsl.long.tp.price  }; return true; }
        if (longSlPx  !== null && Math.abs(pos.y-longSlPx)  < HIT) { dragRef.current = { type:"pos_sl", side:"LONG",  startY:pos.y, startPrice:tpsl.long.sl.price  }; return true; }
        if (shortTpPx !== null && Math.abs(pos.y-shortTpPx) < HIT) { dragRef.current = { type:"pos_tp", side:"SHORT", startY:pos.y, startPrice:tpsl.short.tp.price }; return true; }
        if (shortSlPx !== null && Math.abs(pos.y-shortSlPx) < HIT) { dragRef.current = { type:"pos_sl", side:"SHORT", startY:pos.y, startPrice:tpsl.short.sl.price }; return true; }
        return false;
      },
    },
    // 4.5 추가 진입 핸들 드래그 (선 선택보다 우선)
    {
      when: !!scaleInOrders?.length && pos.x >= 0 && pos.x <= 60,
      handle() {
        for (const o of scaleInOrders) {
          const px = yScale(o.price);
          if (Math.abs(pos.y - px) < HIT) {
            dragRef.current = { type:"scale_in", orderId:o.orderId, startY:pos.y, startPrice:o.price };
            return true;
          }
        }
        return false;
      },
    },
    // 4.6 분할 TP 핸들 드래그 (선 선택보다 우선)
    {
      when: !!splitTps?.length && pos.x >= 0 && pos.x <= 60,
      handle() {
        for (const o of splitTps) {
          const px = yScale(o.price);
          if (Math.abs(pos.y - px) < HIT) {
            dragRef.current = { type:"split_tp", orderId:o.orderId, startY:pos.y, startPrice:o.price };
            return true;
          }
        }
        return false;
      },
    },
    // 4.62 분할 SL 핸들 드래그 — 분할 TP와 같은 규칙 (2026-08-24)
    {
      when: !!partialSls?.length && pos.x >= 0 && pos.x <= 60,
      handle() {
        for (const o of partialSls) {
          const px = yScale(o.price);
          if (Math.abs(pos.y - px) < HIT) {
            dragRef.current = { type:"partial_sl", orderId:o.orderId, startY:pos.y, startPrice:o.price };
            return true;
          }
        }
        return false;
      },
    },
    // 4.65 선택된 구조 편집 — 꼭짓점 드래그 + 꼭짓점 부분 선택
    //      구조는 폴리라인이 x<60(TP/SL 핸들 영역)을 자주 지나므로 포지션 핸들 뒤에 둔다
    //
    //      클릭한 꼭짓점은 structPart에 담기고 **Delete로 그것만 삭제**된다
    //      (예전엔 꼭짓점 Shift+클릭 즉시 삭제 — 사용자 요청으로 클릭 → Delete로 변경).
    //      삭제 의미: 꼭짓점을 지우면 양옆이 같은 타입이 되면서 normalize가 병합해
    //      "그 스윙을 없앤다"가 된다.
    //
    //      ※ **선분(몸통) 부분 선택은 없다** (2026-08-12 사용자 요청으로 제거).
    //        "꼭짓점 제거만 있으면 된다"며 선분이 파랗게 물드는 동작을 걷어냈다.
    //        여기서 false를 반환하면 아래 4.9 구조 선택이 받아 구조 전체 선택으로
    //        떨어지고, 더블클릭은 그대로 팝업(투명도/잠금/CHoCH)으로 간다.
    //
    //      ※ 선분 중간에 점 하나를 끼우는 기능도 없다. 지그재그는 고/저가 교대라서
    //        H–L 사이에 넣는 점은 어느 타입이든 양옆 중 하나와 겹치고,
    //        normalizeStructurePoints가 병합해버려 결과적으로 아무 일도 안 일어난다.
    //        점을 늘리려면 끝점을 클릭해 이어 그리면 된다.
    {
      when: selectedStructId != null && !structMode && !drawMode,
      handle() {
        const st = (structures ?? []).find(s => s.id === selectedStructId);
        if (!st || st.locked) return false;

        const ptIdx = findHitStructPointIdx(st, pos.x, pos.y, xScale, yScale, candles);
        if (ptIdx === -1) return false;

        // 같은 꼭짓점을 다시 누르면 선택 해제 = 구조 전체 선택 상태로 복귀.
        // 이게 있어야 꼭짓점을 고른 뒤에도 **구조 전체 삭제**로 돌아갈 수 있다.
        const isSame = structPart?.kind === "point" && structPart?.idx === ptIdx;
        selectStructPart?.(isSame ? null : { kind: "point", idx: ptIdx });
        dragRef.current = {
          type: "struct_point", structId: selectedStructId,
          ptIdx, ptType: st.points[ptIdx].type,
        };
        return true;
      },
    },
    // 4.7 선택된 채널 드래그 처리
    {
      when: selectedChannelId !== null && !channelMode && !drawMode,
      handle() {
        const ch = channels.find(c => c.id === selectedChannelId);
        if (!ch || ch.locked) return false;
        const { ax, ay, bx, by, ax2, ay2, bx2, by2 } = channelXYs(ch, candles, xScale, yScale, isLog);
        // 메인 라인 시작점 끝점
        if (Math.hypot(pos.x-ax, pos.y-ay) < 10) {
          dragRef.current = { type:"channel_ep", channelId:selectedChannelId, endpoint:"start" }; return true;
        }
        if (Math.hypot(pos.x-bx, pos.y-by) < 10) {
          dragRef.current = { type:"channel_ep", channelId:selectedChannelId, endpoint:"end" }; return true;
        }
        // 미러 라인 시작점 핸들 → offset 보정 후 p1 이동 (평행 유지)
        if (Math.hypot(pos.x-ax2, pos.y-ay2) < 10) {
          dragRef.current = { type:"channel_mirror_ep", channelId:selectedChannelId, endpoint:"start", offset:ch.offset }; return true;
        }
        // 미러 라인 끝점 핸들 → offset2 보정 후 p2 이동 (평행 유지)
        if (Math.hypot(pos.x-bx2, pos.y-by2) < 10) {
          dragRef.current = { type:"channel_mirror_ep", channelId:selectedChannelId, endpoint:"end", offset:ch.offset2 ?? ch.offset }; return true;
        }
        // 메인 라인 중간 핸들 → **메인 라인만** 움직인다 (미러는 제자리 → 폭이 바뀐다)
        //
        // ⚠ 미러 중간 핸들과 **대칭**이다 (2026-08-24 사용자 요청 — 핸들을 3+3으로 맞췄다).
        //   "잡은 점이 있는 선이 움직인다"가 두 핸들의 공통 규칙이다.
        //   미러를 제자리에 두려면 offset도 같이 고쳐야 하므로, 되돌릴 기준값
        //   (p1/p2 + 양쪽 offset)을 전부 실어 보낸다 — 드래그 중에는 **누적이 아니라
        //   시작값에서 한 번에** 다시 계산해야 값이 흘러가지 않는다.
        //   `chIsLog`는 **채널이 만들어진 시점의 스케일**이다(offset의 뜻을 정한다) —
        //   지금 차트 스케일과 다를 수 있어 따로 실어야 미러가 제자리에 선다.
        const midX1 = (ax+bx)/2, midY1 = (ay+by)/2;
        if (Math.hypot(pos.x-midX1, pos.y-midY1) < 10) {
          dragRef.current = {
            type:"channel_mid_main", channelId:selectedChannelId, startY:pos.y,
            t1:ch.t1, t2:ch.t2, startP1:ch.p1, startP2:ch.p2,
            startOffset:ch.offset, startOffset2:ch.offset2 ?? ch.offset,
            chIsLog: ch.isLog ?? false,
          };
          return true;
        }
        // 미러 라인 중간 핸들 (양쪽 offset 동일 delta 조절 → 미러만 움직인다)
        const midX = (ax2+bx2)/2, midY = (ay2+by2)/2;
        if (Math.hypot(pos.x-midX, pos.y-midY) < 10) {
          dragRef.current = { type:"channel_mid_offset", channelId:selectedChannelId, startY:pos.y, startOffset:ch.offset, startOffset2:ch.offset2 ?? ch.offset }; return true;
        }
        // 몸통 드래그
        if (distToSeg(pos.x, pos.y, ax, ay, bx, by) < 8 || distToSeg(pos.x, pos.y, ax2, ay2, bx2, by2) < 8) {
          dragRef.current = { type:"channel_move", channelId:selectedChannelId, startX:pos.x, startY:pos.y, startT1:ch.t1, startP1:ch.p1, startT2:ch.t2, startP2:ch.p2 }; return true;
        }
        return false;
      },
    },
    // 4.8 선택된 원 드래그
    {
      when: selectedCircleId !== null && !circleMode && !drawMode,
      handle() {
        const ci = circles.find(c => c.id === selectedCircleId);
        if (!ci || ci.locked) return false;
        const cx = xScale(tsToIdx(ci.cx_t, candles)), cy = yScale(ci.cx_p);
        const rx = xScale(tsToIdx(ci.rx_t, candles)), ry = yScale(ci.rx_p);
        const r  = Math.hypot(rx - cx, ry - cy);
        // 반지름 끝점 핸들
        if (Math.hypot(pos.x-rx, pos.y-ry) < 10) {
          dragRef.current = { type:"circle_radius", circleId:selectedCircleId, cxT:ci.cx_t, cxP:ci.cx_p }; return true;
        }
        // 중심 핸들 or 테두리 → 전체 이동
        if (Math.hypot(pos.x-cx, pos.y-cy) < 10 || Math.abs(Math.hypot(pos.x-cx, pos.y-cy) - r) < 8) {
          dragRef.current = { type:"circle_move", circleId:selectedCircleId, startX:pos.x, startY:pos.y, startCxT:ci.cx_t, startCxP:ci.cx_p, startRxT:ci.rx_t, startRxP:ci.rx_p }; return true;
        }
        return false;
      },
    },
    // 4.85 선택된 피보나치 드래그 — 앵커 끝점 우선, 그다음 몸통(레벨선·대각선) 이동
    {
      when: selectedFibId !== null && !fibMode && !drawMode,
      handle() {
        const fb = (fibs ?? []).find(f => f.id === selectedFibId);
        if (!fb || fb.locked) return false;
        const { xa, xb } = fibXs(fb, candles, xScale);
        const ya = yScale(fb.p1), yb = yScale(fb.p2);
        if (Math.hypot(pos.x - xa, pos.y - ya) < 10) {
          dragRef.current = { type:"fib_ep", fibId:selectedFibId, endpoint:"start" }; return true;
        }
        if (Math.hypot(pos.x - xb, pos.y - yb) < 10) {
          dragRef.current = { type:"fib_ep", fibId:selectedFibId, endpoint:"end" }; return true;
        }
        // 몸통 — 레벨 가로선 위 아무 데나 잡아도 도형 전체가 따라온다.
        // 레벨선은 개별 이동 대상이 아니다(비율이 곧 위치라 하나만 옮기면 의미가 깨진다)
        if (findHitFib(pos.x, pos.y, [fb], xScale, yScale, candles, isLog)) {
          dragRef.current = { type:"fib_move", fibId:selectedFibId,
            startX:pos.x, startY:pos.y,
            startT1:fb.t1, startP1:fb.p1, startT2:fb.t2, startP2:fb.p2 };
          return true;
        }
        return false;
      },
    },
    // 4.9 선택된 측정 박스 드래그 — 모서리 우선, 그다음 테두리를 잡아 전체 이동
    {
      when: selectedMeasureId !== null && !measureMode && !drawMode,
      handle() {
        const m = (measures ?? []).find(x => x.id === selectedMeasureId);
        if (!m || m.locked) return false;
        const corner = measureCornerHit(m, pos.x, pos.y, xScale, yScale, candles);
        if (corner) {
          dragRef.current = { type:"measure_ep", measureId:selectedMeasureId, ...corner };
          return true;
        }
        // 테두리 = 몸통. 안쪽은 비워 둔다 (findHitMeasure 주석 참고)
        if (findHitMeasure(pos.x, pos.y, [m], xScale, yScale, candles)) {
          dragRef.current = { type:"measure_move", measureId:selectedMeasureId,
            startX:pos.x, startY:pos.y,
            startT1:m.t1, startP1:m.p1, startT2:m.t2, startP2:m.p2 };
          return true;
        }
        return false;
      },
    },
    // 5. 도형 선택/해제 (drawMode 중에는 실행 안 함)
    {
      when: !drawMode,
      handle() {
        const hit = findHitLine(pos.x, pos.y, lines, xScale, yScale, candles, 8, isLog);
        if (hit)   { selectDrawable(drawables, "line",    hit.id);   setSelectedBox(null); return true; }
        const hitCh = findHitChannel(pos.x, pos.y, channels ?? [], xScale, yScale, candles, 8, isLog);
        if (hitCh) { selectDrawable(drawables, "channel", hitCh.id); setSelectedBox(null); return true; }
        const hitCi = findHitCircle(pos.x, pos.y, circles ?? [], xScale, yScale, candles);
        if (hitCi) { selectDrawable(drawables, "circle",  hitCi.id); setSelectedBox(null); return true; }
        // 피보나치는 도형 하나가 가로선 7~10개라 선·채널·원보다 넓게 걸린다 → 그 뒤에서 판정.
        // 다만 x 범위가 두 앵커 사이로 한정돼 있어 구조·ZZ만큼 화면을 덮지는 않는다
        const hitFb = findHitFib(pos.x, pos.y, fibs ?? [], xScale, yScale, candles, isLog);
        if (hitFb) { selectDrawable(drawables, "fib",     hitFb.id); setSelectedBox(null); return true; }
        // 측정 박스 — 테두리만 잡으므로 피보나치처럼 화면을 넓게 삼키지는 않는다.
        // 그래도 사각형이라 걸치는 x 범위가 넓어 구조·ZZ보다는 앞이다
        const hitMs = findHitMeasure(pos.x, pos.y, measures ?? [], xScale, yScale, candles);
        if (hitMs) { selectDrawable(drawables, "measure", hitMs.id); setSelectedBox(null); return true; }
        // 구조는 여러 봉에 걸친 폴리라인이라 클릭을 많이 삼키므로 맨 뒤에서 판정
        const hitSt = findHitStructure(pos.x, pos.y, structures ?? [], xScale, yScale, candles);
        if (hitSt) { selectDrawable(drawables, "structure", hitSt.id); setSelectedBox(null); return true; }
        // 자동 ZZ는 그보다 더 넓게 깔리므로 마지막. 선택되면 금색 + 투명도 조절 대상이 된다.
        //
        // ※ 다른 도형과 달리 **선택하면서 팬 드래그도 함께 건다.** 자동 지그재그는
        //   차트 전 구간을 가로질러서, 선택이 팬을 막으면 차트를 끌 수 없는 지점이
        //   화면 곳곳에 생긴다. 사용자가 그린 도형(몇 개 안 됨)과는 사정이 다르다.
        //   → 클릭만 하면 선택, 끌면 팬.
        if (showZZ && findHitZzLeg(pos.x, pos.y, zzSegments, xScale, yScale)) {
          selectDrawable(drawables, "zz", ZZ_ID);
          setSelectedBox(null);
          dragRef.current = { type: "pan", startX: pos.x, xDom0: [...xDomainRef.current] };
          return true;
        }
        clearAllSelections(drawables);
        return false;
      },
    },
    // 6. 팬 (기본)
    // 박스 그리기는 위 3.7에서 처리됨 (drawMode && !locked) — 여기엔 중복 분기 두지 않음
    {
      when: true,
      handle() {
        setSelectedBox(null);
        dragRef.current = { type:"pan", startX:pos.x, xDom0:[...xDomainRef.current] };
      },
    },
  ];
}
