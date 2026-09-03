const { binance, placeTPSL, checkExistingTPSL } = require("./binanceClient");
const symbolInfo = require("./symbolInfo");
const { pickRecoverable, PRICE_TOLERANCE } = require("../utils/recoverMatch");
const store = require("../store/pendingOrders");
const { startUserDataStream } = require("./orderWatcher");
const { closeToPosition } = require("../utils/side");
const { log, errOf } = require("../store/logStore");

async function recoverPendingOrders() {
  // store.load()는 모듈 로드 시점에 호출됨 (pendingOrders.js 모듈 레벨)

  try {
    // ── 1단계: 미체결 지정가 주문 복구 ──────────────────────────────────────
    const { data: openOrds } = await binance("GET", "/fapi/v1/openOrders", { symbol: symbolInfo.DEFAULT_SYMBOL });
    const limitOrders = openOrds.filter(o =>
      o.type === "LIMIT" && (o.status === "NEW" || o.status === "PARTIALLY_FILLED")
    );

    // ⚠ **주문마다 한 줄씩 찍지 않는다** (2026-08-25) — 내용이 전부 같아서,
    //   미체결이 20건이면 뜻 없는 줄이 20개 쌓인다. 모아서 한 줄에 목록으로 남긴다
    const kept = [];
    for (const o of limitOrders) {
      const saved = store.get(o.orderId);

      // SCALE_IN, SPLIT_TP은 진입 주문이 아님 → 기존 상태 그대로 유지
      if (saved?.status === "SCALE_IN" || saved?.status === "SPLIT_TP") {
        kept.push({ orderId: String(o.orderId), kindOf: saved.status });
        continue;
      }

      // 헤지 모드: closing LIMIT = SPLIT_TP (이전 재시작으로 상태 손상된 경우 포함)
      const isClosingLimit = (o.side === "SELL" && o.positionSide === "LONG") ||
                             (o.side === "BUY"  && o.positionSide === "SHORT");
      if (isClosingLimit) {
        store.set(String(o.orderId), {
          status: "SPLIT_TP",
          price:  parseFloat(o.price),
          qty:    parseFloat(o.origQty),
          side:   o.side,
          // 어느 쪽 포지션의 분할 TP인지 — 진단·복구용 메타 (판정은 utils/orderKind.js)
          positionSide: o.positionSide ?? closeToPosition(o.side),
          pct:    saved?.pct ?? null,
          createdAt: saved?.createdAt ?? Date.now(),
        });
        log("RECOVERY_ORDER_RESTORED", { orderId: o.orderId, kindOf: "SPLIT_TP",
          price: o.price, qty: o.origQty });
        continue;
      }

      const side      = o.side;
      const closeSide = side === "BUY" ? "SELL" : "BUY";
      const orderInfo = {
        side, closeSide,
        tp: saved?.tp ?? null, sl: saved?.sl ?? null,
        qty: o.origQty, status: "WATCHING", recovered: true,
        drawing: saved?.drawing ?? null,
      };
      store.set(o.orderId, orderInfo);
      if (saved?.tp && saved?.sl) {
        log("RECOVERY_ORDER_RESTORED", { orderId: o.orderId, kindOf: "ENTRY",
          price: o.price, qty: o.origQty, tp: saved.tp, sl: saved.sl });
      } else {
        log("RECOVERY_ORDER_NO_TPSL", { level: "warn", orderId: o.orderId,
          orderSide: o.side, qty: o.origQty, price: o.price });
      }
    }

    if (kept.length) log("RECOVERY_ORDER_KEPT", { count: kept.length, orders: kept });

    // ── 2단계: 서버 다운 중 체결된 주문 감지 ─────────────────────────────
    const openOrderIds = new Set(limitOrders.map(o => String(o.orderId)));
    const MAX_AGE_MS   = 24 * 60 * 60 * 1000; // 24시간 이내 주문만 처리
    const now          = Date.now();

    for (const [orderId, info] of store.entries()) {
      if (openOrderIds.has(orderId)) continue;
      if (info.status === "TPSL_PLACED") continue;
      if (info.status !== "WATCHING" && info.status !== "FILLED") continue;
      // 타임스탬프 없거나 24시간 초과 → 오래된 주문 스킵
      if (!info.createdAt || now - info.createdAt > MAX_AGE_MS) continue;

      try {
        // ⚠ 심볼은 **그 기록에 적힌 것**을 쓴다. 2026-09-02 이전 기록에는 필드가
        //   없는데, 그때는 전부 BTCUSDT였으므로 store.symbolOf가 그렇게 읽어 준다
        const rsym = store.symbolOf(orderId);
        const { data } = await binance("GET", "/fapi/v1/order", { symbol: rsym, orderId });

        if (data.status === "FILLED" && info.tp && info.sl) {
          log("RECOVERY_FILL_DETECTED", { orderId });
          const { data: posData } = await binance("GET", "/fapi/v2/positionRisk", { symbol: rsym });
          const orderPosSide = closeToPosition(info.closeSide);
          // 헷지모드: 주문 사이드와 매칭되는 포지션이 있어야만 TP/SL 등록 시도
          // (반대쪽만 열려있을 때 잘못된 사이드로 placeTPSL 호출하면 5회 재시도 = 31초 낭비)
          const pos = posData.find(p =>
            p.positionSide === orderPosSide && parseFloat(p.positionAmt) !== 0
          );

          if (pos) {
            // TP·SL 둘 다 있을 때만 완료로 본다 (한쪽만 있으면 placeTPSL이 양쪽 다시 건다)
            const { hasTP, hasSL } = await checkExistingTPSL(orderPosSide, rsym);
            if (!(hasTP && hasSL)) {
              const tpsl = await placeTPSL(info);
              if (tpsl.failed.length > 0) {
                store.set(orderId, { ...info, status: "TPSL_PARTIAL", tpsl });
              } else {
                log("TPSL_PLACED", { orderId, posSide: orderPosSide, ctx: "recovery",
                  tp: info.tp ?? null, sl: info.sl ?? null });
                store.set(orderId, { ...info, status: "TPSL_PLACED", tpsl });
              }
            } else {
              store.set(orderId, { ...info, status: "TPSL_PLACED" });
            }
          }
        } else if (data.status === "FILLED") {
          log("RECOVERY_FILL_NO_TPSL", { level: "error", orderId });
        } else if (data.status === "CANCELED" || data.status === "EXPIRED") {
          log("ORDER_GONE", { orderId, status: data.status, by: "recovery" });
          store.delete(orderId);
        }
      } catch (e) {
        log("QUERY_FAILED", { level: "warn", what: "order", ctx: "recovery", orderId, err: errOf(e) });
      }
    }

    // ── 3단계: 안전망 — 포지션이 열려 있는데 TP/SL 없으면 자동 복구 시도 ─────
    // 헷지모드: LONG/SHORT 각각 독립적으로 확인
    //
    // ⚠ **계정 전체를 본다** (2026-09-04). 예전엔 기본 심볼만 봐서, 다른 코인의
    //   무방비 포지션은 3초짜리 watchAccount의 **경보로만** 알려주고 손절은 안 걸었다.
    //   범위를 못 넓힌 이유는 "store 기록이 심볼별이 아니라 엉뚱한 값을 걸 수 있다"
    //   였는데, 그 전제가 사라졌다 — `store.set`이 `symbol`을 채우고(2026-09-02)
    //   `store.symbolOf`로 읽을 수 있다. 그래서 **심볼별로 후보를 나눠서** 고른다.
    //
    // ⚠ `/fapi/v3`를 쓴다 — 심볼을 안 주면 **열린 포지션만** 준다(0.6KB).
    //   v2는 심볼 없이 부르면 1784행 682KB다. v3에 `leverage`가 없지만 여기서는
    //   `symbol`·`positionSide`·`positionAmt`·`entryPrice`만 쓴다
    const posAllRes = await binance("GET", "/fapi/v3/positionRisk", {});
    const openPositions = (Array.isArray(posAllRes.data) ? posAllRes.data : [])
      .filter(p => parseFloat(p.positionAmt) !== 0);
    const usedRecoverIds = new Set();

    // 심볼별 후보 목록 — `pickRecoverable`은 import가 없어서 심볼을 못 본다.
    // 그래서 **여기서 갈라서** 넘긴다 (recoverMatch.js 상단 주석)
    const entriesBySymbol = new Map();
    for (const [orderId, info] of store.entries()) {
      const sym = store.symbolOf(orderId);
      if (!entriesBySymbol.has(sym)) entriesBySymbol.set(sym, []);
      entriesBySymbol.get(sym).push([orderId, info]);
    }
    for (const openPos of openPositions) {
      // positionSide 필드 없으면 positionAmt 부호로 판단
      const openPosSide = openPos.positionSide === "LONG" || openPos.positionSide === "SHORT"
        ? openPos.positionSide
        : parseFloat(openPos.positionAmt) > 0 ? "LONG" : "SHORT";
      // ⚠ **그 포지션의 심볼로** 확인한다 (기본 심볼이 아니라)
      const posSym = openPos.symbol ?? symbolInfo.DEFAULT_SYMBOL;
      const { hasTP, hasSL } = await checkExistingTPSL(openPosSide, posSym);
      if (!(hasTP && hasSL)) {
        const posEntry = parseFloat(openPos.entryPrice);
        // ⚠ `=====` 배너로 다섯 줄 찍던 것을 이벤트 한 줄로 바꿨다 (2026-08-25).
        //   줄이 나뉘어 있으면 grep으로 한 줄만 뽑았을 때 방향도 수량도 안 딸려온다
        log("NAKED_POSITION", { level: "error", ctx: "boot", symbol: posSym, posSide: openPosSide,
          qty: Math.abs(parseFloat(openPos.positionAmt)), entryPrice: posEntry,
          hasTP: !!hasTP, hasSL: !!hasSL });

        // ⚠ 고르는 규칙은 `utils/recoverMatch.js` 하나가 갖는다 — 잘못 고르면
        //   **엉뚱한 가격에 손절이 걸린다.** 실제 값으로 검산하려고 뺐다
        //   (tests/recoverMatch.test.js). 여기 규칙을 다시 적지 말 것
        const recoverable = pickRecoverable(
          entriesBySymbol.get(posSym) ?? [], openPosSide, posEntry, usedRecoverIds);
        if (recoverable) {
          const [recoverId, recoverInfo] = recoverable;
          usedRecoverIds.add(recoverId);
          log("NAKED_RECOVERY_MATCH", { symbol: posSym, posSide: openPosSide, orderId: recoverId,
            fillPrice: recoverInfo.fillPrice });
          try {
            // ⚠ 심볼을 실어 넘긴다 — 기록에 없으면(2026-09-02 이전) 그 포지션의 심볼로
            const tpsl = await placeTPSL({ ...recoverInfo, symbol: recoverInfo.symbol ?? posSym });
            if (tpsl.failed.length === 0) {
              log("NAKED_RECOVERED", { symbol: posSym, posSide: openPosSide, orderId: recoverId });
              store.set(recoverId, { ...recoverInfo, status: "TPSL_PLACED", tpsl });
            } else {
              log("NAKED_RECOVERY_PARTIAL", { level: "error", posSide: openPosSide,
                orderId: recoverId, failed: tpsl.failed.map(f => f.type) });
            }
          } catch (e) {
            log("NAKED_RECOVERY_FAILED", { level: "error", posSide: openPosSide,
              orderId: recoverId, err: errOf(e) });
          }
        } else {
          log("NAKED_NO_CANDIDATE", { level: "error", symbol: posSym, posSide: openPosSide,
            tolerancePct: PRICE_TOLERANCE * 100 });
        }
      }
    }

    await store.flush();

    if (limitOrders.length === 0 && store.size === 0) {
      log("RECOVERY_NONE", {});
    }

  } catch (e) {
    log("RECOVERY_FAILED", { level: "warn", err: errOf(e) });
  }

  // try 밖에서 호출 — 복구 실패해도 체결 감지는 반드시 시작
  await startUserDataStream();
}

module.exports = { recoverPendingOrders };
