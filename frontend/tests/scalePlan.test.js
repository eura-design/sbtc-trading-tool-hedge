// 스케일 플랜 — 층 가격·수량 계산
//
// ⚠ **여기가 틀리면 실제로 돈이 틀리게 나간다.** 층 가격이 손절선을 넘으면 사자마자
//   손절되고, 수량이 하한을 못 넘으면 거래소가 거절하고, 평단이 틀리면 리스크 %가 틀린다.
//
// 사용자가 정한 규칙 (2026-09-27):
//   · 층은 진입가에서 시작해 **손절선 직전까지** (손절선 자리는 비운다)
//   · 수량은 층마다 **균등**
//   · 총수량은 **전부 체결 시 평단**으로 리스크 %를 맞춘다

import test from "node:test";
import assert from "node:assert/strict";
import { scaleLayerPrices, scalePlanCalc, maxScaleLayers, scalePreview,
         SCALE_LAYER_CAP } from "../src/utils/scalePlan.js";
import { calcPosition } from "../src/utils/calc.js";

// ── 층 가격 ────────────────────────────────────────────────────────────────
test("롱 — 진입가부터 아래로, 손절선 자리는 비운다", () => {
  const p = scaleLayerPrices({ entry: 100, sl: 90, count: 4, tick: 0.1, isLong: true });
  assert.deepEqual(p, [100, 97.5, 95, 92.5]);
  assert.ok(p[p.length - 1] > 90, "마지막 층이 손절선보다 위여야 한다");
});

test("숏 — 진입가부터 위로, 손절선 자리는 비운다", () => {
  const p = scaleLayerPrices({ entry: 100, sl: 110, count: 4, tick: 0.1, isLong: false });
  assert.deepEqual(p, [100, 102.5, 105, 107.5]);
  assert.ok(p[p.length - 1] < 110);
});

test("층 1개는 진입가 하나 — 단일 진입과 같은 자리다", () => {
  assert.deepEqual(scaleLayerPrices({ entry: 100, sl: 90, count: 1, tick: 0.1, isLong: true }), [100]);
});

test("⚠ 호가 단위 때문에 층이 겹치면 버린다 — 개수가 줄어들 수 있다", () => {
  // 구간이 0.3인데 호가 단위가 0.1이면 4층을 넣을 자리가 없다
  const p = scaleLayerPrices({ entry: 100, sl: 99.7, count: 4, tick: 0.1, isLong: true });
  assert.ok(p.length < 4, `겹친 층을 버려야 한다 (받은 값: ${p.join()})`);
  assert.equal(new Set(p).size, p.length, "같은 가격이 두 번 나오면 안 된다");
  for (const x of p) assert.ok(x > 99.7, `${x}는 손절선 아래다`);
});

test("방향이 뒤집힌 입력은 빈 배열 — 롱인데 손절이 진입가 위", () => {
  assert.deepEqual(scaleLayerPrices({ entry: 100, sl: 110, count: 4, tick: 0.1, isLong: true }), []);
  assert.deepEqual(scaleLayerPrices({ entry: 100, sl: 90, count: 4, tick: 0.1, isLong: false }), []);
});

// ── 수량 ───────────────────────────────────────────────────────────────────
const ARGS = { capital: 10000, riskPct: 0.01, entry: 100, sl: 90, isLong: true,
               leverage: 10, step: 0.001, minQty: 0.001, tick: 0.1, minNotional: 0 };

test("손절 시 손실이 리스크 금액과 같다 — 수량이 늘어도 손실은 그대로다", () => {
  const plan = scalePlanCalc({ ...ARGS, count: 4 });
  const loss = plan.totalQty * (plan.avgEntry - ARGS.sl);
  // 내림 때문에 조금 **작을** 수 있다 (덜 쓰는 쪽은 안전하다). 넘으면 안 된다
  const risk = ARGS.capital * ARGS.riskPct;
  assert.ok(loss <= risk + 1e-6, `손실 ${loss}이 리스크 ${risk}를 넘는다`);
  assert.ok(loss > risk * 0.9, `너무 적게 쓴다 (${loss})`);
});

test("평단이 손절선에 가까워 단일 진입보다 수량이 많다", () => {
  const single = calcPosition(ARGS.capital, ARGS.riskPct, 100, 90, ARGS.leverage,
                              ARGS.step, ARGS.minQty, ARGS.tick, 0);
  const plan = scalePlanCalc({ ...ARGS, count: 4 });
  assert.ok(plan.totalQty > single.actualQty,
    `스케일 ${plan.totalQty} vs 단일 ${single.actualQty}`);
  assert.ok(plan.avgEntry < 100 && plan.avgEntry > 90);
});

test("층 수량은 균등하다 — 남는 조각을 어느 층에도 얹지 않는다", () => {
  const plan = scalePlanCalc({ ...ARGS, count: 3 });
  assert.equal(plan.totalQty, plan.perLayerQty * plan.prices.length);
});

test("층 하나가 최소 수량을 못 넘으면 만들지 않는다 (null)", () => {
  // 자본이 작아 총수량이 최소 단위 몇 개뿐인데 10층으로 쪼개려는 경우
  //   (자본 3 → 총 0.006개 → 10층이면 층당 0.0006개로 최소 단위 0.001 미달)
  assert.equal(scalePlanCalc({ ...ARGS, capital: 3, count: 10 }), null);
  // 층을 줄이면 같은 자본으로도 낼 수 있다
  assert.ok(scalePlanCalc({ ...ARGS, capital: 3, count: 3 }));
});

test("⚠ 층 하나가 **최소 금액**을 못 넘으면 만들지 않는다 (수량과 별개다)", () => {
  // DOGE류: 최소 수량은 통과하지만 주문 금액이 모자란 경우
  const r = scalePlanCalc({ ...ARGS, count: 10, minNotional: 5000 });
  assert.equal(r, null);
});

// ── 층 수 상한 ─────────────────────────────────────────────────────────────
test("낼 수 있는 최대 층수를 찾는다 — 그 층수로는 실제로 만들어진다", () => {
  const n = maxScaleLayers({ ...ARGS, minNotional: 200 });
  assert.ok(n >= 1 && n <= SCALE_LAYER_CAP);
  assert.ok(scalePlanCalc({ ...ARGS, minNotional: 200, count: n }),
    `${n}층은 만들어져야 한다`);
  if (n < SCALE_LAYER_CAP) {
    assert.equal(scalePlanCalc({ ...ARGS, minNotional: 200, count: n + 1 }), null,
      `${n + 1}층은 만들어지면 안 된다 — 상한이 틀렸다`);
  }
});

test("아무리 좁혀도 안 되면 1을 답한다 (화면이 0으로 나뉘지 않게)", () => {
  assert.equal(maxScaleLayers({ ...ARGS, capital: 0 }), 1);
});

// ── 미리보기 ───────────────────────────────────────────────────────────────
test("전부 체결 / 절반 체결 두 줄 — 절반은 위에서부터 센다", () => {
  const plan = scalePlanCalc({ ...ARGS, count: 4 });
  const pv = scalePreview(plan, 10);
  assert.equal(pv.full.layers, 4);
  assert.equal(pv.half.layers, 2);
  // 절반은 위쪽(비싼) 층이라 평단이 더 높다 = 손절선에서 멀다
  assert.ok(pv.half.avgEntry > pv.full.avgEntry);
  assert.equal(pv.half.qty, plan.perLayerQty * 2);
  // 증거금은 명목 ÷ 레버리지
  assert.ok(Math.abs(pv.full.margin - pv.full.notional / 10) < 1e-9);
});

test("절반 체결이 전부 체결보다 손실이 작다 — 부분 체결은 안전한 방향이다", () => {
  const plan = scalePlanCalc({ ...ARGS, count: 4 });
  const pv = scalePreview(plan, 10);
  const lossOf = (r) => r.qty * (r.avgEntry - ARGS.sl);
  assert.ok(lossOf(pv.half) < lossOf(pv.full));
});

// ── 화면이 만든 층이 **서버 검증을 통과하는가** ────────────────────────────
//
// ⚠ 층 가격 규칙이 두 곳에 있다: 화면은 `utils/scalePlan.scaleLayerPrices`가 만들고,
//   서버는 `middleware/validate.validateScalePlan`이 다시 본다 (서버는 화면을 신뢰하지
//   않는다). 둘이 갈리면 **화면에서 만든 계획이 서버에서 거절된다** — 버튼을 눌러야
//   알게 되는 종류의 어긋남이다. 그래서 두 구현을 직접 맞대어 본다
//   (`tests/qtyMirror.test.js`가 수량 규칙을 그렇게 맞대는 것과 같은 방식).
import backendValidate from "../../backend/middleware/validate.js";

const { validateScalePlan, MAX_SCALE_LAYERS } = backendValidate;

/** 서버 미들웨어를 그대로 돌려 본다 — 거절하면 그 문구를 돌려준다 */
function serverRejects(bodyIn) {
  let rejected = null;
  const res = { status: () => ({ json: (o) => { rejected = o.error; } }) };
  validateScalePlan({ body: bodyIn }, res, () => {});
  return rejected;
}

test("층 개수 상한이 화면과 서버에서 같다", () => {
  assert.equal(SCALE_LAYER_CAP, MAX_SCALE_LAYERS,
    "화면 상한이 서버보다 크면 만든 계획이 서버에서 거절된다");
});

test("⚠ 화면이 만든 층은 서버 검증을 통과한다 (롱·숏 · 여러 층수)", () => {
  const cases = [
    { entry: 100,    sl: 90,      tp: 130,     isLong: true,  tick: 0.1 },
    { entry: 0.2,    sl: 0.18,    tp: 0.25,    isLong: true,  tick: 0.00001 },
    { entry: 3000,   sl: 3300,    tp: 2500,    isLong: false, tick: 0.01 },
    { entry: 68000,  sl: 69500,   tp: 64000,   isLong: false, tick: 0.1 },
  ];
  for (const c of cases) {
    for (let n = 1; n <= SCALE_LAYER_CAP; n++) {
      const prices = scaleLayerPrices({ ...c, count: n });
      if (!prices.length) continue;
      const body = {
        side: c.isLong ? "BUY" : "SELL",
        entry: c.entry, tp: c.tp, sl: c.sl,
        layers: prices.map(price => ({ price, qty: 1 })),
      };
      assert.equal(serverRejects(body), null,
        `${c.isLong ? "롱" : "숏"} ${n}층이 서버에서 거절됐다 (${prices.join()})`);
    }
  }
});

test("서버는 손절선을 넘은 층을 거절한다 — 화면은 그런 층을 만들지 않는다", () => {
  // 규칙이 실제로 살아 있는지 (위 테스트가 헛돌지 않는지) 확인한다
  const bad = serverRejects({ side: "BUY", entry: 100, tp: 130, sl: 90,
    layers: [{ price: 100, qty: 1 }, { price: 89, qty: 1 }] });
  assert.ok(bad, "서버가 거절해야 한다");
});
