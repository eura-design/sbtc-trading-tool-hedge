const { binance, placeTPSL, checkExistingTPSL } = require("./binanceClient");
const store = require("../store/pendingOrders");
const { startUserDataStream } = require("./orderWatcher");

async function recoverPendingOrders() {
  store.load();

  try {
    // ── 1단계: 미체결 지정가 주문 복구 ──────────────────────────────────────
    const { data: openOrds } = await binance("GET", "/fapi/v1/openOrders", { symbol: "BTCUSDT" });
    const limitOrders = openOrds.filter(o =>
      o.type === "LIMIT" && (o.status === "NEW" || o.status === "PARTIALLY_FILLED")
    );

    for (const o of limitOrders) {
      const saved = store.get(o.orderId);

      // SCALE_IN, SPLIT_TP은 진입 주문이 아님 → 기존 상태 그대로 유지
      if (saved?.status === "SCALE_IN" || saved?.status === "SPLIT_TP") {
        console.log(`[복구] ${saved.status} 주문 유지: orderId=${o.orderId}`);
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
          pct:    saved?.pct ?? null,
          createdAt: saved?.createdAt ?? Date.now(),
        });
        console.log(`[복구] SPLIT_TP 주문 복구: orderId=${o.orderId} price=${o.price}`);
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
        console.log(`[복구] 미체결 주문 복구 (TP/SL 보존): orderId=${o.orderId}`);
      } else {
        console.warn(`[복구] 미체결 주문 복구 (TP/SL 없음!): orderId=${o.orderId}`);
      }
    }

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
        const { data } = await binance("GET", "/fapi/v1/order", { symbol: "BTCUSDT", orderId });

        if (data.status === "FILLED" && info.tp && info.sl) {
          console.log(`[복구] 서버 다운 중 체결된 주문: orderId=${orderId}`);
          const { data: posData } = await binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" });
          const pos = posData.find(p => parseFloat(p.positionAmt) !== 0);

          if (pos) {
            const orderPosSide = info.closeSide === "SELL" ? "LONG" : "SHORT";
            const hasTpsl = await checkExistingTPSL(orderPosSide);
            if (!hasTpsl) {
              const tpsl = await placeTPSL(info);
              if (tpsl.failed.length > 0) {
                store.set(orderId, { ...info, status: "TPSL_PARTIAL", tpsl });
              } else {
                console.log(`[복구] TP/SL 등록 완료: orderId=${orderId}`);
                store.set(orderId, { ...info, status: "TPSL_PLACED", tpsl });
              }
            } else {
              store.set(orderId, { ...info, status: "TPSL_PLACED" });
            }
          }
        } else if (data.status === "FILLED") {
          console.error(`[복구] 체결됐으나 TP/SL 정보 없음: orderId=${orderId} — 수동 확인 필요!`);
        } else if (data.status === "CANCELED" || data.status === "EXPIRED") {
          console.log(`[복구] 서버 다운 중 취소된 주문: orderId=${orderId} (${data.status}) → store 제거`);
          store.delete(orderId);
        }
      } catch (e) {
        console.warn(`[복구] 주문 조회 실패 (orderId=${orderId}):`, e.response?.data?.msg || e.message);
      }
    }

    // ── 3단계: 안전망 — 포지션이 열려 있는데 TP/SL 없으면 자동 복구 시도 ─────
    const { data: posCheck } = await binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" });
    const openPos = posCheck.find(p => parseFloat(p.positionAmt) !== 0);
    if (openPos) {
      // positionSide 필드 없으면 positionAmt 부호로 판단
      const openPosSide = openPos.positionSide === "LONG" || openPos.positionSide === "SHORT"
        ? openPos.positionSide
        : parseFloat(openPos.positionAmt) > 0 ? "LONG" : "SHORT";
      const hasTpsl = await checkExistingTPSL(openPosSide);
      if (!hasTpsl) {
        console.error("==================================================");
        console.error("[안전망] 포지션이 열려 있지만 TP/SL이 없습니다!");
        console.error(`  방향: ${parseFloat(openPos.positionAmt) > 0 ? "LONG" : "SHORT"}`);
        console.error(`  수량: ${Math.abs(parseFloat(openPos.positionAmt))} BTC`);

        // store에서 TP/SL 정보가 있는 주문을 찾아 자동 등록 시도
        const recoverable = [...store.entries()].find(([, o]) => o.tp && o.sl);
        if (recoverable) {
          const [recoverId, recoverInfo] = recoverable;
          console.log(`[안전망] store에서 TP/SL 정보 발견 (orderId=${recoverId}) → 자동 등록 시도`);
          try {
            const tpsl = await placeTPSL(recoverInfo);
            if (tpsl.failed.length === 0) {
              console.log("[안전망] TP/SL 자동 복구 성공!");
              store.set(recoverId, { ...recoverInfo, status: "TPSL_PLACED", tpsl });
            } else {
              const failed = tpsl.failed.map(f => f.type).join(", ");
              console.error(`[안전망] TP/SL 자동 복구 부분 실패: ${failed} → 수동 설정 필요!`);
            }
          } catch (e) {
            console.error("[안전망] TP/SL 자동 복구 실패:", e.message);
          }
        } else {
          console.error("  store에 TP/SL 정보 없음 → Binance에서 수동으로 설정하세요!");
        }
        console.error("==================================================");
      }
    }

    await store.flush();

    if (limitOrders.length === 0 && store.size === 0) {
      console.log("[복구] 복구할 주문 없음");
    }

    // User Data Stream 시작 (listenKey 기반 체결 감지)
    await startUserDataStream();

  } catch (e) {
    console.warn("[복구] 복구 실패:", e.response?.data?.msg || e.message);
  }
}

module.exports = { recoverPendingOrders };
