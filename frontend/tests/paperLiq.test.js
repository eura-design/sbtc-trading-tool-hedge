// 연습 청산가는 **심볼의 유지증거금률**을 따른다 (2026-09-02)
//
// ⚠ 실측: BTC·ETH 0.004 / SOL 0.005 / DOGE 0.0065, 작은 코인은 0.1까지 간다
//   (`/fapi/v1/leverageBracket`). **25배 차이**라 하나로 박아 두면 연습 청산가가
//   실제와 완전히 달라지고, 그러면 연습이 잘못된 것을 가르친다.

import test from "node:test";
import assert from "node:assert/strict";
import { PaperBroker } from "../src/replay/paperBroker.js";

// 청산가만 보므로 최소한으로 포지션을 심는다
function brokerWith({ maintRate, step = 0.001 }) {
  const b = new PaperBroker({ startBalance: 10_000, maintRate, step });
  b.pos.LONG = { size: 1, entryPrice: 100, leverage: 10 };
  return b;
}

test("유지증거금률이 다르면 청산가가 다르다", () => {
  const btc  = brokerWith({ maintRate: 0.004  })._liqPrice("LONG");
  const doge = brokerWith({ maintRate: 0.0065 })._liqPrice("LONG");
  const tiny = brokerWith({ maintRate: 0.1    })._liqPrice("LONG");
  // 유지증거금이 클수록 **더 빨리** 청산된다 → 롱이면 청산가가 높다
  assert.ok(doge > btc,  `DOGE ${doge} <= BTC ${btc}`);
  assert.ok(tiny > doge, `0.1짜리 ${tiny} <= DOGE ${doge}`);
  // 옛 코드는 셋이 전부 같았다 (0.004 고정)
  assert.notEqual(btc, doge);
});

test("BTC 값은 예전 그대로다 (기본값 = 0.004)", () => {
  // 진입 100 / 10배 → 100 * (1/10 - 0.004) = 9.6 아래 = 90.4
  assert.ok(Math.abs(brokerWith({ maintRate: 0.004 })._liqPrice("LONG") - 90.4) < 1e-9);
  const dflt = new PaperBroker({ startBalance: 10_000 });
  dflt.pos.LONG = { size: 1, entryPrice: 100, leverage: 10 };
  assert.ok(Math.abs(dflt._liqPrice("LONG") - 90.4) < 1e-9, "안 넘겼을 때 기본값이 바뀌었다");
});

test("숏은 반대 방향이다", () => {
  const b = brokerWith({ maintRate: 0.004 });
  b.pos.LONG = null;
  b.pos.SHORT = { size: 1, entryPrice: 100, leverage: 10 };
  assert.ok(Math.abs(b._liqPrice("SHORT") - 109.6) < 1e-9);
});

test("이상한 값은 기본값으로 떨어진다 (계산이 죽지 않게)", () => {
  for (const bad of [0, -1, null, undefined, NaN, "x"]) {
    const b = brokerWith({ maintRate: bad });
    assert.ok(Math.abs(b._liqPrice("LONG") - 90.4) < 1e-9, `maintRate=${bad}`);
  }
});
