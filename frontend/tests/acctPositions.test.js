// 다른 코인의 포지션 카드(하늘색) 목록 만들기
//
// ⚠ 지금 보는 코인을 빼는 것이 이 함수의 핵심이다. 안 빼면 같은 포지션이 **두 줄**로
//   보이고, 한 줄은 주문이 되고 한 줄은 안 되는 화면이 된다.
// ⚠ 정렬이 심볼 이름 순인 것도 검산한다. 미실현 순으로 바꾸면 가격이 움직일 때마다
//   카드가 자리를 바꿔서 누르려던 `차트 보기` 버튼이 손 아래에서 도망간다.

import test from "node:test";
import assert from "node:assert/strict";
import { otherPositionCards, cardFilters, shownSymbol, livePriceFor } from "../src/utils/acctPositions.js";

const item = (symbol, side, size = 1) => ({ symbol, side, posData: { size, entryPrice: 1 } });

test("지금 보는 코인은 목록에서 뺀다 — 기존 카드가 이미 그린다", () => {
  const out = otherPositionCards(
    [item("BTCUSDT", "LONG"), item("ETHUSDT", "SHORT")], "BTCUSDT");
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, "ETHUSDT");
});

test("심볼 이름 순으로, 같은 코인 안에서는 롱을 위에 둔다", () => {
  const out = otherPositionCards([
    item("SOLUSDT", "SHORT"), item("DOGEUSDT", "SHORT"),
    item("SOLUSDT", "LONG"),  item("ETHUSDT", "LONG"),
  ], "BTCUSDT");
  assert.deepEqual(out.map(o => `${o.symbol}:${o.side}`),
    ["DOGEUSDT:SHORT", "ETHUSDT:LONG", "SOLUSDT:LONG", "SOLUSDT:SHORT"]);
});

test("수량 0은 포지션이 아니다 — 카드를 만들지 않는다", () => {
  assert.equal(otherPositionCards([item("ETHUSDT", "LONG", 0)], "BTCUSDT").length, 0);
});

test("응답이 없거나 배열이 아니면 빈 목록이다 — 화면이 터지지 않는다", () => {
  for (const bad of [undefined, null, {}, "", 0]) {
    assert.deepEqual(otherPositionCards(bad, "BTCUSDT"), []);
  }
});

test("그 코인의 단위를 받으면 그것을 쓴다 (DOGE 청산가가 $0이 되지 않게)", () => {
  const fallback = { step: 0.001, base: "BTC", tick: 0.1, minQty: 0.001 };
  const f = cardFilters({ base: "DOGE", tick: 0.00001, step: 1 }, fallback);
  assert.equal(f.base, "DOGE");
  assert.equal(f.tick, 0.00001);
  assert.equal(f.step, 1);
  // 나머지 칸은 그대로 남는다 — 하늘색 카드가 쓰지 않는 값까지 비우면 안 된다
  assert.equal(f.minQty, 0.001);
});

test("그 코인의 단위를 모르면 지금 보는 심볼의 단위로 떨어진다 — 카드는 남는다", () => {
  const fallback = { step: 0.001, base: "BTC", tick: 0.1 };
  assert.deepEqual(cardFilters(null, fallback), fallback);
});

// ── 코인을 바꾼 직후의 어긋남 (2026-09-27) ─────────────────────────────────
//
// `symbol`은 즉시 바뀌는데 `GET /api/position` 응답은 나중에 온다. 그 사이를 잘못 읽으면
// 사이드바가 들썩인다 — 카드가 한 장 늘었다 줄고, 잔고 글자 크기가 한 단계 작아졌다 돌아온다.

test("포지션 응답이 아직 옛 코인의 것이면 그 옛 코인을 답한다", () => {
  assert.equal(shownSymbol({ symbol: "BTCUSDT" }, "ETHUSDT"), "BTCUSDT");
});

test("짝이 맞으면 그 심볼이다", () => {
  assert.equal(shownSymbol({ symbol: "ETHUSDT" }, "ETHUSDT"), "ETHUSDT");
});

test("응답이 아직 없으면 화면 심볼로 본다", () => {
  assert.equal(shownSymbol(null, "ETHUSDT"), "ETHUSDT");
  assert.equal(shownSymbol(undefined, "ETHUSDT"), "ETHUSDT");
});

test("⚠ symbol 필드가 없는 스냅샷은 화면 심볼로 본다 (연습 계좌)", () => {
  // 페이퍼 스냅샷에는 `symbol`이 없다. 없는 것을 "다른 코인"으로 읽으면
  // 연습 중 미실현이 총자산에서 빠진다
  assert.equal(shownSymbol({ long: { size: 1 }, short: null }, "ETHUSDT"), "ETHUSDT");
});

test("옛 코인이 초록 카드에 남아 있는 동안 하늘색 목록에서는 그 코인을 뺀다", () => {
  // BTC를 보다가 ETH로 바꾼 직후 — 응답은 아직 BTC다
  const items = [item("BTCUSDT", "LONG"), item("ETHUSDT", "LONG")];
  const out = otherPositionCards(items, shownSymbol({ symbol: "BTCUSDT" }, "ETHUSDT"));
  assert.deepEqual(out.map(o => o.symbol), ["ETHUSDT"],
    "BTC가 초록 카드와 하늘색 카드에 동시에 뜨면 카드 수가 출렁인다");
  // 응답이 도착한 뒤 — 이제 BTC가 하늘색으로 넘어간다
  const after = otherPositionCards(items, shownSymbol({ symbol: "ETHUSDT" }, "ETHUSDT"));
  assert.deepEqual(after.map(o => o.symbol), ["BTCUSDT"]);
  assert.equal(out.length, after.length, "카드 수가 변하지 않는다 — 그래서 들썩이지 않는다");
});

// ── 미실현에 쓸 가격 — 어긋난 동안에는 쓰지 않는다 (2026-09-27) ─────────────
//
// 코인을 바꾸면 포지션과 가격이 **각자 다른 시점에** 새 코인 것으로 바뀐다.
// 짝이 안 맞는 조합으로 곱하면 총자산이 엉뚱한 자릿수가 되고, 잔고 줄의 글자 크기가
// 한 단계 작아졌다 돌아온다.

const P = (symbol) => ({ symbol, long: { size: 1, entryPrice: 1 } });

test("짝이 맞으면 틱 가격을 쓴다 (총자산이 실시간으로 움직여야 한다)", () => {
  assert.equal(livePriceFor({ screenSymbol: "ETHUSDT", position: P("ETHUSDT"),
    liveClose: 3000, liveCloseSymbol: "ETHUSDT", candlePrice: 2990 }), 3000);
});

test("포지션이 늦게 오는 동안에는 가격을 쓰지 않는다", () => {
  assert.equal(livePriceFor({ screenSymbol: "ETHUSDT", position: P("BTCUSDT"),
    liveClose: 3000, liveCloseSymbol: "ETHUSDT", candlePrice: 2990 }), null);
});

test("⚠ 가격이 늦게 오는 동안에도 쓰지 않는다 (이쪽이 더 흔하다)", () => {
  // 포지션은 새 코인인데 현재가가 아직 옛 코인이다 — 90,000을 3,000짜리 포지션에 곱하면
  // 총자산이 통째로 튄다
  assert.equal(livePriceFor({ screenSymbol: "ETHUSDT", position: P("ETHUSDT"),
    liveClose: 90000, liveCloseSymbol: "BTCUSDT", candlePrice: undefined }), null);
});

test("틱 가격이 없으면 마지막 캔들 종가를 쓴다 (그건 늘 지금 심볼의 것이다)", () => {
  assert.equal(livePriceFor({ screenSymbol: "ETHUSDT", position: P("ETHUSDT"),
    liveClose: null, liveCloseSymbol: null, candlePrice: 2990 }), 2990);
});

test("둘 다 없으면 null — 거래소가 준 미실현을 쓴다", () => {
  assert.equal(livePriceFor({ screenSymbol: "ETHUSDT", position: P("ETHUSDT"),
    liveClose: null, liveCloseSymbol: null, candlePrice: undefined }), null);
});

test("⚠ 연습 계좌(스냅샷에 symbol이 없다)에서도 가격을 쓴다", () => {
  // 없는 것을 "다른 코인"으로 읽으면 연습 중 총자산이 틱마다 움직이지 않는다
  assert.equal(livePriceFor({ screenSymbol: "BTCUSDT", position: { long: { size: 1 } },
    liveClose: 90000, liveCloseSymbol: "BTCUSDT", candlePrice: 89000 }), 90000);
});
