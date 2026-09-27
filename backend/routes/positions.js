// GET /api/positions — **계정 전체**의 포지션 한 벌 (사이드바의 하늘색 포지션 카드용)
//
// ⚠ `GET /api/position`(단수)과 역할이 다르다. 저쪽은 **지금 보고 있는 심볼 하나**를
//   거래소에 직접 물어보고, 레버리지·미체결 진입·추가 진입·펀딩비·진입 시각까지 준다.
//   여기는 **다른 코인 카드가 보여주는 일곱 줄**에 필요한 것만 준다.
//
// ⚠ **거래소를 부르지 않는다.** `orderWatcher.watchAccount`가 3초마다 뜬 관측을
//   `services/accountSnapshot.js`에서 읽는다 (그래서 호출 가중치가 0이다).
//   ⚠ 여기서 심볼별로 직접 조회하도록 바꾸지 말 것 — 이 요청은 폴링이라,
//     코인 수 × 주기만큼 호출이 늘어난다.
//
// ⚠ 진입 시각·평단 변화 이력(`entrySteps`)은 **주지 않는다.** 그건 차트 진입선만 쓰고,
//   만들려면 거래 내역을 3개월까지 거꾸로 훑어야 한다(`services/entryTime.js`).
//   게다가 그 캐시는 심볼을 구분하지 않아서, 코인마다 부르면 폴링마다 캐시가 엇갈려
//   무거운 조회가 매번 다시 돈다. 하늘색 카드는 이 값이 필요 없다.
const express = require("express");
const store = require("../store/pendingOrders");
const accountSnapshot = require("../services/accountSnapshot");
const symbolInfo = require("../services/symbolInfo");
const { presetTpslIds, buildTpslView } = require("../utils/tpslView");
const { openRow } = require("../utils/position");
const router = express.Router();

// 하늘색 카드가 읽는 일곱 줄의 재료. `routes/position.js`의 `makePos`와 **같은 필드명**이어야
// 한다 — 같은 `PositionCard`가 두 응답을 모르는 채로 읽는다.
// ⚠ 레버리지는 없다: v3 positionRisk가 그 필드를 안 준다 (orderWatcher 주석 참고).
//   카드에 레버리지 줄이 없어서 문제가 되지 않는다 — 줄을 추가하려면 재료부터 정해야 한다
const makePos = (p) => {
  const size = Math.abs(parseFloat(p.positionAmt));
  const entryPrice = parseFloat(p.entryPrice);
  // ⚠ 미실현은 **거래소가 준 값**이다 (마크 가격 기준). 보고 있는 코인은 화면이
  //   체결가로 다시 계산하지만(`utils/equity.js`), 다른 코인은 체결가 스트림이 열려
  //   있지 않다. 필드가 없으면 마크 가격으로 같은 기준을 만든다
  const given = parseFloat(p.unRealizedProfit);
  const mark = parseFloat(p.markPrice);
  const sign = p.positionSide === "LONG" ? 1 : -1;
  return {
    size, entryPrice,
    unrealizedPnl: Number.isFinite(given) ? given
      : (Number.isFinite(mark) ? (mark - entryPrice) * size * sign : 0),
    liquidationPrice: parseFloat(p.liquidationPrice) || null,
  };
};

// 그 코인의 호가·수량 단위 — **표시 전용**이다 (청산가 자릿수·수량 자릿수·코인 이름).
//
// ⚠ 왜 응답에 싣나: 화면은 `useSymbolFilters`로 **지금 보는 심볼 하나**의 규칙만 스토어에
//   들고 있다. 다른 코인의 단위를 모르면 DOGE 청산가가 `$0`으로, 수량이 엉뚱한 자릿수로
//   보인다 (CLAUDE.md "가격을 d3.format(",.0f")로 찍지 말 것").
// ⚠ **주문 계산에 쓰지 말 것.** 주문으로 나갈 수량·가격은 화면에서도 `useSymbolFilters`가
//   정해야 한다 — 그쪽이 유일한 출처다. 이 값은 하늘색 카드가 **읽기만** 하는 값이다.
// 원본은 같다: `/api/symbols`도 이 `symbolInfo`에서 나온다
const rulesOf = (symbol) => {
  if (!symbolInfo.has(symbol)) return null;   // exchangeInfo를 아직 못 받았거나 없는 심볼
  const f = symbolInfo.filtersOf(symbol);
  return { base: f.baseAsset, tick: Number(f.tickSize), step: Number(f.stepSize) };
};

router.get("/", (req, res) => {
  const snap = accountSnapshot.get();
  // 아직 한 번도 못 봤다 (서버를 켠 직후 최대 3초) — 빈 목록이다.
  // ⚠ 여기서 거래소를 대신 부르지 말 것. 3초 뒤 저절로 채워진다
  if (!snap) return res.json({ at: null, items: [] });

  const presetIds = presetTpslIds(store.entries());
  const pctOf = (orderId) => store.get(orderId)?.pct ?? null;
  const items = [];

  for (const g of snap.groups) {
    // 분류 규칙은 `GET /api/tpsl`과 **같은 함수**다 (`utils/tpslView.js`) —
    // 그래야 같은 포지션의 손절 가격이 카드마다 달라지지 않는다.
    // ⚠ 이 라우트는 store를 **읽기만** 한다. `GET /api/tpsl`이 하는 SPLIT_TP 정리는
    //   여기서 하지 않는다 — 여러 심볼을 한 번에 보므로, 한 심볼의 주문 목록으로
    //   다른 심볼의 기록을 지울 수 없다
    const view = buildTpslView(g.orders, g.algos, { presetIds, pctOf });
    for (const [side, key] of [["LONG", "long"], ["SHORT", "short"]]) {
      const p = openRow(g.positions, side);
      if (!p) continue;
      items.push({ symbol: g.symbol, side, posData: makePos(p), tpsl: view[key],
                   rules: rulesOf(g.symbol) });
    }
  }

  // ⚠ 정렬은 **심볼 이름 순**이다 (프론트가 다시 정렬하지만 응답도 안정적이어야 한다).
  //   미실현 순으로 하지 말 것 — 가격이 움직일 때마다 카드가 자리를 바꿔서
  //   누르려던 `차트 보기` 버튼이 도망간다
  items.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.side.localeCompare(b.side));
  res.json({ at: snap.at, items });
});

module.exports = router;
