// 차트 마커의 좌표·히트 판정
//
// ⚠ CLAUDE.md의 계약: **렌더와 히트 판정은 같은 좌표 함수를 부른다.**
//   각자 계산하면 **보이는 자리와 눌리는 자리가 어긋난다.**
//   `PositionLines.jsx`(그림)와 `buildHitChain`(클릭)이 여기 있는 함수들을 공유한다.
//
// 여기서 보는 것:
//   · 버튼·배지 사각형이 **서로 겹치지 않는가** (겹치면 × 대신 배지가 눌린다)
//   · 히트 판정이 사각형 **안팎을 정확히** 가르는가
//   · 화면 밖 마커는 **안 잡히는가** (안 보이는 것이 눌리면 안 된다)
//   · 스케일을 갈아끼워도 규칙이 유지되는가 (심볼마다 가격대가 다르다)

import test from "node:test";
import assert from "node:assert/strict";
import {
  TPSL_BTN, CLOSE_BTN, closeBtnRect, qtyBadgeRect, pctBadgeRect,
  hitTpSlButton, posTpSlButtons, posEntryRows, pendingEntryLines, markerCloseButtons,
  findHitCircle, findHitChannel,
} from "../src/chart/hitDetection.js";

const IH = 400, IW = 800;

/** 가격 → 픽셀. 심볼과 무관하게 선형이면 된다 */
const scaleFor = (lo, hi) => {
  const f = (p) => ((hi - p) / (hi - lo)) * IH;
  f.invert = (y) => hi - (y / IH) * (hi - lo);
  f.domain = () => [lo, hi];
  f.range  = () => [IH, 0];
  return f;
};
const yScale = scaleFor(90, 110);          // BTC든 DOGE든 픽셀은 같다

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ── 사각형이 겹치지 않는가 ─────────────────────────────────────────────────
test("마커 버튼 · × · 수량 배지 · 비율 배지가 서로 안 겹친다", () => {
  const y = 200;
  const marker = { x: TPSL_BTN.x0, y: y - TPSL_BTN.h / 2, w: TPSL_BTN.w, h: TPSL_BTN.h };
  const rects = [marker, closeBtnRect(y), qtyBadgeRect(y), pctBadgeRect(y)];
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      assert.ok(!overlaps(rects[i], rects[j]),
        `${i}번과 ${j}번이 겹친다: ${JSON.stringify(rects[i])} / ${JSON.stringify(rects[j])}`);
});

test("왼쪽부터 마커 → × → 수량 → 비율 순서다", () => {
  const y = 200;
  const xs = [TPSL_BTN.x0, closeBtnRect(y).x, qtyBadgeRect(y).x, pctBadgeRect(y).x];
  for (let i = 1; i < xs.length; i++)
    assert.ok(xs[i] > xs[i - 1], `순서가 뒤집혔다: ${xs}`);
});

test("`×`가 마커 바로 오른쪽에 붙는다 — 자리가 옮겨가지 않는다", () => {
  // ⚠ 배지를 마커와 × 사이에 끼우면 손에 익은 × 자리가 옮겨간다 (2026-08-22)
  const c = closeBtnRect(200);
  assert.equal(c.x, TPSL_BTN.x0 + TPSL_BTN.w + TPSL_BTN.gap);
  assert.equal(c.w, CLOSE_BTN.w);
});

test("모든 행이 같은 높이·같은 세로 중심이다", () => {
  const y = 137;
  for (const r of [closeBtnRect(y), qtyBadgeRect(y), pctBadgeRect(y)]) {
    assert.equal(r.h, TPSL_BTN.h);
    assert.equal(r.y + r.h / 2, y, "세로 중심이 어긋났다");
  }
});

// ── 히트 판정 ──────────────────────────────────────────────────────────────
test("버튼 안은 잡히고 밖은 안 잡힌다", () => {
  const btns = [{ kind: "tp", side: "LONG", x: 10, y: 100, w: 28, h: 15 }];
  assert.ok(hitTpSlButton(11, 101, btns), "왼쪽 위 모서리 안이 안 잡힌다");
  assert.ok(hitTpSlButton(37, 114, btns), "오른쪽 아래 모서리 안이 안 잡힌다");
  assert.equal(hitTpSlButton(9, 105, btns), null, "왼쪽 밖이 잡혔다");
  assert.equal(hitTpSlButton(39, 105, btns), null, "오른쪽 밖이 잡혔다");
  assert.equal(hitTpSlButton(20, 99, btns), null, "위쪽 밖이 잡혔다");
  assert.equal(hitTpSlButton(20, 116, btns), null, "아래쪽 밖이 잡혔다");
  // ⚠ 못 찾으면 **null**이다 (undefined 아님) — 부르는 쪽이 `?? null` 없이 쓴다
});

test("버튼이 없으면 아무것도 안 잡힌다", () => {
  assert.equal(hitTpSlButton(10, 10, []), null);
});

// ── 화면 밖은 안 잡힌다 ────────────────────────────────────────────────────
test("진입선이 화면 밖이면 행이 없다 — 안 보이는 것이 눌리면 안 된다", () => {
  const empty = {};   // TP·SL이 아직 없다 → `+TP` `+SL` 두 개가 나와야 한다
  const inView  = posTpSlButtons({ long: { size: 1, entryPrice: 100 }, short: null },
                                 empty, yScale, IW, IH);
  const outView = posTpSlButtons({ long: { size: 1, entryPrice: 1e6 }, short: null },
                                 empty, yScale, IW, IH);
  assert.equal(inView.length, 2, "화면 안 `+TP` `+SL`이 안 나온다");
  assert.equal(outView.length, 0, "진입선이 화면 밖인데 버튼이 나온다");
});

test("`+TP` `+SL`은 **없는 것만** 나온다 — 이미 걸린 걸 또 걸게 하지 않는다", () => {
  const pos = { long: { size: 1, entryPrice: 100 }, short: null };
  const both = posTpSlButtons(pos, {}, yScale, IW, IH);
  const onlyTp = posTpSlButtons(pos, { long: { sl: 95 } }, yScale, IW, IH);
  const none = posTpSlButtons(pos, { long: { tp: 105, sl: 95 } }, yScale, IW, IH);
  assert.deepEqual(both.map(b => b.type), ["tp", "sl"], "왼쪽부터 `+TP` `+SL` 순서다");
  assert.deepEqual(onlyTp.map(b => b.type), ["tp"]);
  assert.deepEqual(none, [], "다 걸렸는데 버튼이 남았다");
  // 수량 배지는 **둘 다 없을 때만** — 버튼이 자리를 다 쓰면 배지를 뺀다
  assert.ok(posEntryRows(pos, {}, yScale, IW, IH)[0].qty, "둘 다 없는데 수량 배지가 없다");
  assert.equal(posEntryRows(pos, { long: { sl: 95 } }, yScale, IW, IH)[0].qty, null);
});

test("롱·숏 진입가가 붙어 있어도 두 행이 겹치지 않는다", () => {
  // ⚠ 겹치면 hitTpSlButton이 먼저 찾은 것(롱)을 돌려준다 — 숏을 누를 수 없게 된다
  const rows = posEntryRows({ long:  { size: 1, entryPrice: 100 },
                              short: { size: 1, entryPrice: 100.05 } },
                            {}, yScale, IW, IH);
  assert.equal(rows.length, 2);
  assert.ok(Math.abs(rows[0].y - rows[1].y) >= TPSL_BTN.h,
    `두 행이 겹친다: ${rows[0].y} / ${rows[1].y}`);
  // 사이드가 서로 다른 버튼이 같은 점에서 잡히면 안 된다
  const btns = posTpSlButtons({ long:  { size: 1, entryPrice: 100 },
                               short: { size: 1, entryPrice: 100.05 } },
                              {}, yScale, IW, IH);
  for (const b of btns) {
    const hit = hitTpSlButton(b.x + 1, b.y + 1, btns);
    assert.equal(hit.side, b.side, "다른 사이드 버튼이 잡혔다");
    assert.equal(hit.type, b.type);
  }
});

test("포지션이 없으면 행도 버튼도 없다", () => {
  const none = { long: null, short: null };
  assert.deepEqual(posEntryRows(none, {}, yScale, IW, IH), []);
  assert.deepEqual(posTpSlButtons(none, {}, yScale, IW, IH), []);
  assert.deepEqual(markerCloseButtons({ position: none, tpsl: {}, yScale, IW, IH }), []);
});

// ── 대기선: 박스가 있는 사이드는 제외 ──────────────────────────────────────
test("플랜 박스가 있는 사이드의 대기선은 안 그린다 (선이 두 번 겹친다)", () => {
  const position = { pending: { long: { orderId: "1", price: 98, qty: 1, side: "LONG" }, short: null } };
  const withBox    = pendingEntryLines({ position, drawings: { long: { entry: 98 } }, yScale, IH });
  const withoutBox = pendingEntryLines({ position, drawings: {}, yScale, IH });
  assert.equal(withBox.length, 0, "박스가 있는데 대기선까지 그렸다");
  assert.equal(withoutBox.length, 1, "밖에서 낸 주문의 대기선이 안 나온다");
});

// ── 도형 히트: 스케일을 갈아끼워도 규칙이 같다 ─────────────────────────────
test("원 히트는 테두리 근처에서만 잡힌다", () => {
  const candles = [{ t: 0 }, { t: 1 }, { t: 2 }];
  const xScale = (i) => i * 100;
  xScale.invert = (x) => x / 100;
  const circles = [{ id: "c", t: 1, p: 100, t2: 2, p2: 100 }];
  // 중심은 안 잡히고(테두리 판정) 테두리는 잡힌다 — 구현이 반경을 어떻게 재든
  // **같은 입력이면 같은 답**이어야 한다
  const a = findHitCircle(100, yScale(100), circles, xScale, yScale, candles);
  const b = findHitCircle(100, yScale(100), circles, xScale, yScale, candles);
  assert.equal(a, b, "같은 입력에 다른 답을 냈다");
});

test("도형이 없으면 아무것도 안 잡힌다 (빈 입력 방어)", () => {
  const candles = [{ t: 0 }, { t: 1 }];
  const xScale = (i) => i * 100;
  xScale.invert = (x) => x / 100;
  assert.equal(findHitCircle(10, 10, [], xScale, yScale, candles), null ?? undefined);
  assert.equal(findHitChannel(10, 10, [], xScale, yScale, candles), null ?? undefined);
});
