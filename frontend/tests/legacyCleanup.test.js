// 이사가 끝난 옛 도형 키 정리
//
// ⚠ **지우는 코드다.** 조건을 느슨하게 하면 사용자가 그려 둔 도형이 영영 사라진다.
//   새 키가 실제로 있는 것만 지운다 — 이사가 못 옮긴 항목은 옛 키가 유일한 사본이다.

import test from "node:test";
import assert from "node:assert/strict";
import { cleanupLegacyDrawings, migrateDrawingsToSymbol, drawingKey } from "../src/replay/drawingKeys.js";

// localStorage 대역 (node에는 없다)
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  key: i => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
const reset = (seed = {}) => { store.clear(); for (const [k, v] of Object.entries(seed)) store.set(k, v); };
const has = k => store.has(k);

test("이사를 안 했으면 **아무것도 지우지 않는다**", () => {
  reset({ trendLines: "[1]" });          // 이사 플래그 없음
  assert.equal(cleanupLegacyDrawings("BTCUSDT"), 0);
  assert.ok(has("trendLines"), "이사도 안 했는데 옛 키를 지웠다");
});

test("이사한 뒤에는 옛 키를 지운다", () => {
  reset({ trendLines: "[1]", structures: "[2]" });
  migrateDrawingsToSymbol("BTCUSDT");
  assert.ok(has(drawingKey("trendLines", false, "BTCUSDT")), "이사가 안 됐다");
  const n = cleanupLegacyDrawings("BTCUSDT");
  assert.ok(n >= 2, `지운 개수가 ${n}`);
  assert.ok(!has("trendLines"), "옛 키가 남았다");
  assert.ok(!has("structures"));
  // 새 키는 그대로
  assert.equal(store.get(drawingKey("trendLines", false, "BTCUSDT")), "[1]");
});

test("**새 키가 없으면 지우지 않는다** — 옛 키가 유일한 사본이다", () => {
  reset({ trendLines: "[1]", drawingsSymbolScoped: "1" });   // 이사한 척, 그런데 안 옮겨졌다
  assert.equal(cleanupLegacyDrawings("BTCUSDT"), 0);
  assert.ok(has("trendLines"), "유일한 사본을 지웠다");
});

test("두 번 돌아도 한 번만 지운다", () => {
  reset({ trendLines: "[1]" });
  migrateDrawingsToSymbol("BTCUSDT");
  const first = cleanupLegacyDrawings("BTCUSDT");
  assert.ok(first > 0);
  // 두 번째 호출에서 옛 키를 새로 만들어 둬도 건드리지 않는다 (플래그가 있다)
  store.set("trendLines", "[9]");
  assert.equal(cleanupLegacyDrawings("BTCUSDT"), 0);
  assert.ok(has("trendLines"), "플래그가 있는데 또 지웠다");
});

test("연습용 옛 키(replay_)도 같이 지운다", () => {
  reset({ replay_trendLines: "[1]" });
  migrateDrawingsToSymbol("BTCUSDT");
  assert.ok(has(drawingKey("trendLines", true, "BTCUSDT")));
  cleanupLegacyDrawings("BTCUSDT");
  assert.ok(!has("replay_trendLines"), "연습용 옛 키가 남았다");
});

test("도형과 무관한 키는 건드리지 않는다", () => {
  reset({ trendLines: "[1]", theme: "dark", riskPct: "1", favoriteSymbols: '["SOLUSDT"]' });
  migrateDrawingsToSymbol("BTCUSDT");
  cleanupLegacyDrawings("BTCUSDT");
  assert.ok(has("theme") && has("riskPct") && has("favoriteSymbols"),
    "관계없는 설정을 지웠다");
});
