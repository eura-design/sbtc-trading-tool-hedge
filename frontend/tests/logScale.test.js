// 로그 눈금(`L`)의 **바닥값** — 1달러 미만 코인이 화면에서 사라지지 않는가
//
// ⚠ 2026-09-06 실측한 결함: 로그 축은 0 이하를 계산할 수 없어 세로 범위의 아래를 막아
//   두는데, 그 바닥이 **1(=1달러)**이었다. BTC(70,000)·ETH(3,000)는 바닥 근처에 갈 일이
//   없어 멀쩡했지만, **가격 전체가 1달러보다 아래인 코인**은 세로 범위가 통째로 1달러
//   근처로 끌려 올라갔다:
//     DOGE 0.2 → 화면이 보여주는 범위 `0.99994 ~ 1.00106`,
//                최고가가 화면 500px 중 **715,068px 자리**에 찍혔다 = 차트가 텅 빈다.
//   `CLAUDE.md`가 적어 둔 "BTC 스케일 상수는 다수에서 틀린다"의 한 사례다
//   (축을 `d3.format(",.0f")`로 찍어 DOGE에서 전부 `$0`이 됐던 것과 같은 종류).

import test from "node:test";
import assert from "node:assert/strict";
import { fitYDomain, getScales, padYDomain } from "../src/chart/scales.js";

const bars = (l, h) => [{ l, h }];
/** 그 코인의 로그 세로 범위가 캔들을 실제로 감싸는가 */
const wraps = (c) => {
  const [lo, hi] = fitYDomain(c, [0, 0], true);
  return lo < c[0].l && hi > c[0].h;
};

test("1달러 미만 코인의 로그 범위가 **캔들을 감싼다**", () => {
  for (const [name, c] of [
    ["DOGE 0.2",    bars(0.18, 0.22)],
    ["XRP 0.5",     bars(0.48, 0.52)],
    ["1000PEPE 0.01", bars(0.009, 0.011)],
    ["아주 싼 코인",  bars(0.00001, 0.000012)],
  ]) {
    assert.ok(wraps(c), `${name}: 캔들이 세로 범위 밖이다 — 화면이 빈다`);
  }
});

test("1달러 이상 코인은 **예전과 똑같다** (고치면서 딴 데를 건드리지 않았다)", () => {
  // 2026-09-06에 고치기 **전** 값을 그대로 적어 둔다 — 여기가 흔들리면 회귀다
  const btc = fitYDomain(bars(69000, 71000), [0, 0], true);
  assert.ok(Math.abs(btc[0] - 68881.8) < 0.1, `BTC 아래쪽이 ${btc[0]}`);
  assert.ok(Math.abs(btc[1] - 71121.8) < 0.1, `BTC 위쪽이 ${btc[1]}`);

  const eth = fitYDomain(bars(2900, 3100), [0, 0], true);
  assert.ok(Math.abs(eth[0] - 2888.42) < 0.01, `ETH 아래쪽이 ${eth[0]}`);
  assert.ok(Math.abs(eth[1] - 3112.43) < 0.01, `ETH 위쪽이 ${eth[1]}`);
});

test("캔들이 화면에서 **같은 자리**에 그려진다 (가격대와 무관하게)", () => {
  // 여백이 비율로 정해지므로, 최고가는 어느 코인이든 화면의 같은 높이에 와야 한다.
  // 예전에는 DOGE만 715,068px(화면은 500px)로 튀었다
  const px = (c) => {
    const yDom = fitYDomain(c, [0, 0], true);
    const sc = getScales(c, { current: [0, 0] }, { current: yDom }, 800, 500, true);
    return sc.yScale(c[0].h);
  };
  const btc = px(bars(69000, 71000));
  for (const c of [bars(0.18, 0.22), bars(0.48, 0.52), bars(2900, 3100)]) {
    assert.ok(Math.abs(px(c) - btc) < 0.5, `화면 위치가 ${px(c)} (BTC는 ${btc})`);
  }
  assert.ok(btc > 0 && btc < 500, `화면(500px) 안에 안 들어온다: ${btc}`);
});

test("0 이하가 들어와도 **NaN·무한대를 만들지 않는다**", () => {
  // 화면 이동 모드에서 선형으로 0 아래까지 끌어 내린 뒤 로그를 켤 수 있다.
  // 로그 축에 0이 들어가면 축·캔들·도형이 통째로 안 그려진다
  const sc = getScales(bars(100, 200), { current: [0, 0] }, { current: [-5, 200] }, 800, 500, true);
  const y = sc.yScale(150);
  assert.ok(Number.isFinite(y), `축이 깨졌다: ${y}`);

  const [lo, hi] = padYDomain(-3, 10, 0.06, true);
  assert.ok(Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > lo,
    `여백 계산이 깨졌다: ${lo} ~ ${hi}`);
});

test("바닥은 **실제 가격보다 한참 아래**여야 한다 (상대값으로 바꾸지 말 것)", () => {
  // 10만 배 움직인 코인을 긴 구간으로 볼 때, 바닥을 "최고가의 1만분의 1"처럼 상대값으로
  // 잡으면 아래쪽 정상 구간이 잘린다. 절대값이라 안 잘린다
  const [lo, hi] = fitYDomain([{ l: 0.000001, h: 0.1 }], [0, 0], true);
  assert.ok(lo < 0.000001, `아래쪽이 잘렸다: ${lo}`);
  assert.ok(hi > 0.1);
});
