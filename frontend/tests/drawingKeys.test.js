// 도형 저장 키 (심볼별) + 이사
//
// ⚠ 이 이사는 **브라우저마다 딱 한 번** 돈다. 틀리면 그려둔 도형과 플랜 박스가
//   전부 사라진 것처럼 보이고, 플래그가 이미 찍혀 있어 다시 시도되지도 않는다.
//   그래서 실제 함수로 검산한다.

import test from "node:test";
import assert from "node:assert/strict";

// localStorage 흉내 (utils/storage.js가 전역 localStorage를 본다)
class FakeLS {
  #m = new Map();
  get length() { return this.#m.size; }
  key(i) { return [...this.#m.keys()][i] ?? null; }
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); }
}
globalThis.localStorage = new FakeLS();
globalThis.window = { localStorage: globalThis.localStorage, addEventListener() {} };

const { migrateDrawingsToSymbol, drawingKey, clearReplayDrawings, hasReplayDrawings } =
  await import("../src/replay/drawingKeys.js");

const ls = globalThis.localStorage;

test("키 모양 — replay_로 시작하는 것이 연습용이라는 규칙이 유지된다", () => {
  assert.equal(drawingKey("fibs", false, "ETHUSDT"), "ETHUSDT:fibs");
  assert.equal(drawingKey("fibs", true,  "ETHUSDT"), "replay_ETHUSDT:fibs");
  assert.ok(drawingKey("fibs", true,  "ETHUSDT").startsWith("replay_"));
  assert.ok(!drawingKey("fibs", false, "ETHUSDT").startsWith("replay_"));
  // 심볼을 안 넘기면 기본 심볼 (호출부가 빠뜨려도 BTC 도형이 사라지지는 않게)
  assert.equal(drawingKey("fibs", false), "BTCUSDT:fibs");
});

test("옛 키가 BTCUSDT로 복사된다 — 원본은 남는다", () => {
  ls.setItem("trendLines",  '[{"id":1}]');
  ls.setItem("structures",  '[{"id":2}]');
  ls.setItem("drawing",     '{"long":{"entry":70000}}');   // 플랜 박스도 같이 간다
  ls.setItem("replay_fibs", '[{"id":3}]');

  const moved = migrateDrawingsToSymbol("BTCUSDT");
  assert.equal(moved, 4, `옮긴 개수가 ${moved}`);
  assert.equal(ls.getItem("BTCUSDT:trendLines"),   '[{"id":1}]');
  assert.equal(ls.getItem("BTCUSDT:structures"),   '[{"id":2}]');
  assert.equal(ls.getItem("BTCUSDT:drawing"),      '{"long":{"entry":70000}}');
  assert.equal(ls.getItem("replay_BTCUSDT:fibs"),  '[{"id":3}]');
  // ⚠ 원본을 지우지 않는다 — 되돌릴 여지와 백업을 남기려는 것이다
  assert.equal(ls.getItem("trendLines"), '[{"id":1}]');
});

test("두 번 돌아도 덮어쓰지 않는다", () => {
  // 이사 뒤에 그린 도형이 옛 키의 내용으로 되돌아가면 안 된다
  ls.setItem("BTCUSDT:trendLines", '[{"id":"이사 뒤에 그린 것"}]');
  const moved = migrateDrawingsToSymbol("BTCUSDT");
  assert.equal(moved, 0, "플래그가 있는데 또 옮겼다");
  assert.equal(ls.getItem("BTCUSDT:trendLines"), '[{"id":"이사 뒤에 그린 것"}]');
});

test("성적 초기화는 심볼을 가리지 않되 실거래 도형은 건드리지 않는다", () => {
  ls.setItem("replay_ETHUSDT:trendLines", '[{"id":9}]');
  ls.setItem("replay_SOLUSDT:measures",   '[{"id":10}]');
  ls.setItem("ETHUSDT:trendLines",        '[{"id":11}]');

  assert.equal(hasReplayDrawings(), true);
  clearReplayDrawings();
  assert.equal(hasReplayDrawings(), false, "연습 도형이 남았다");
  assert.equal(ls.getItem("replay_ETHUSDT:trendLines"), null);
  assert.equal(ls.getItem("replay_SOLUSDT:measures"),   null);
  // ⚠ 실거래 도형을 지우면 그건 사고다
  assert.equal(ls.getItem("ETHUSDT:trendLines"), '[{"id":11}]', "실거래 도형까지 지웠다");
});
