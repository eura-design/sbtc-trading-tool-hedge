import { useEffect, useState, useMemo } from "react";
import { api } from "../api/client";
import { MIN_QTY, QTY_STEP, DEFAULT_SYMBOL } from "../constants";

// 심볼별 거래 규칙 — 호가 단위(tickSize)·수량 단위(stepSize)·최소 수량
//
// ── 왜 서버에서 받나 ───────────────────────────────────────────────────────
// 2026-09-02 이전에는 `constants.js`에 0.001로 박혀 있었다. 그건 BTCUSDT의 값이고,
// 코인마다 다르다 — SOL은 0.01, **DOGE는 1**이다. 화면에 DOGE를 띄워 놓고 0.001로
// 계산하면 "0.001 DOGE"라는, 실제로는 낼 수 없는 수량이 플랜 카드에 뜬다.
//
// 원본은 바이낸스 `exchangeInfo`이고 백엔드가 캐시해 `GET /api/symbols`로 준다
// (backend/services/symbolInfo.js). **주문을 만드는 쪽과 같은 출처를 봐야**
// 미리보기에 뜬 수량과 실제로 나가는 수량이 어긋나지 않는다
// (splitLevels의 "미리보기와 실주문이 같은 함수를 본다"와 같은 원칙).
//
// ⚠ 목록은 한 번만 받는다. 상장·필터 변경은 몇 달에 한 번이라 새로고침이면 충분하고,
//   500개 남짓이라 다시 받을 이유도 없다.
// ⚠ 못 받았을 때는 **BTCUSDT 기본값으로 떨어진다** — 화면이 통째로 멈추는 것보다 낫다.
//   다만 그때 다른 코인을 고르면 수량이 틀리므로, 목록을 못 받으면 선택기가 비활성이다
//   (TopBar가 `symbols.length`로 판단한다)

const FALLBACK = {
  symbol: DEFAULT_SYMBOL, baseAsset: "BTC",
  tickSize: "0.10", stepSize: String(QTY_STEP), minQty: String(MIN_QTY), minNotional: "100",
};

// 단위 문자열의 유효 소수 자릿수 — backend/utils/round.js의 decimalsOf와 같은 규칙.
// ⚠ 한쪽만 바꾸면 화면에 뜨는 자릿수와 거래소로 나가는 자릿수가 갈린다
export function decimalsOf(step) {
  const s = String(step);
  if (/e/i.test(s)) {
    const n = Number(s);
    return n > 0 && n < 1 ? Math.max(0, -Math.floor(Math.log10(n))) : 0;
  }
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.slice(dot + 1).replace(/0+$/, "").length;
}

/**
 * @param symbol 지금 보고 있는 심볼
 * @returns { symbols, filters, qtyStep, minQty, tickSize, qtyDecimals, ready }
 *   symbols — 선택기용 전체 목록 (못 받았으면 빈 배열)
 *   filters — 이 심볼의 규칙 (못 받았으면 BTCUSDT 기본값)
 */
export function useSymbolFilters(symbol = DEFAULT_SYMBOL) {
  const [symbols, setSymbols] = useState([]);

  useEffect(() => {
    let dead = false;
    api("GET", "/api/symbols")
      .then(r => { if (!dead) setSymbols(Array.isArray(r?.symbols) ? r.symbols : []); })
      // 백엔드가 꺼져 있어도 차트는 그려져야 한다 — 조용히 기본값으로 간다
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  return useMemo(() => {
    const filters = symbols.find(s => s.symbol === symbol)
      ?? (symbol === DEFAULT_SYMBOL ? FALLBACK : null)
      ?? FALLBACK;
    const stepSize = filters.stepSize ?? QTY_STEP;
    return {
      symbols,
      filters,
      qtyStep:     Number(stepSize),
      minQty:      Number(filters.minQty ?? MIN_QTY),
      tickSize:    Number(filters.tickSize ?? 0.1),
      qtyDecimals: decimalsOf(stepSize),
      // 이 심볼의 진짜 규칙을 알고 있는가. false면 화면 숫자를 믿으면 안 된다
      ready: symbols.some(s => s.symbol === symbol),
    };
  }, [symbols, symbol]);
}
