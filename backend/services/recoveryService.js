const { binance, placeTPSL, checkExistingTPSL } = require("./binanceClient");
const store = require("../store/pendingOrders");
const { startUserDataStream } = require("./orderWatcher");
const { closeToPosition, positionToSide } = require("../utils/side");

async function recoverPendingOrders() {
  // store.load()는 모듈 로드 시점에 호출됨 (pendingOrders.js 모듈 레벨)

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
          const orderPosSide = closeToPosition(info.closeSide);
          // 헷지모드: 주문 사이드와 매칭되는 포지션이 있어야만 TP/SL 등록 시도
          // (반대쪽만 열려있을 때 잘못된 사이드로 placeTPSL 호출하면 5회 재시도 = 31초 낭비)
          const pos = posData.find(p =>
            p.positionSide === orderPosSide && parseFloat(p.positionAmt) !== 0
          );

          if (pos) {
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
    // 헷지모드: LONG/SHORT 각각 독립적으로 확인
    const { data: posCheck } = await binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" });
    const openPositions = posCheck.filter(p => parseFloat(p.positionAmt) !== 0);
    const PRICE_TOLERANCE = 0.02; // 현재 포지션 entryPrice ±2% 내 매칭만 신뢰
    const usedRecoverIds = new Set();
    for (const openPos of openPositions) {
      // positionSide 필드 없으면 positionAmt 부호로 판단
      const openPosSide = openPos.positionSide === "LONG" || openPos.positionSide === "SHORT"
        ? openPos.positionSide
        : parseFloat(openPos.positionAmt) > 0 ? "LONG" : "SHORT";
      const hasTpsl = await checkExistingTPSL(openPosSide);
      if (!hasTpsl) {
        const posEntry = parseFloat(openPos.entryPrice);
        console.error("==================================================");
        console.error("[안전망] 포지션이 열려 있지만 TP/SL이 없습니다!");
        console.error(`  방향: ${openPosSide}`);
        console.error(`  수량: ${Math.abs(parseFloat(openPos.positionAmt))} BTC`);
        console.error(`  진입가: ${posEntry}`);

        // 해당 사이드의 TP/SL 정보가 있는 주문 중 현재 진입가 근접 + 최신 항목만 신뢰
        const entrySide = positionToSide(openPosSide);
        const candidates = [...store.entries()]
          .filter(([orderId, o]) => {
            if (usedRecoverIds.has(orderId)) return false;
            if (!o.tp || !o.sl || o.side !== entrySide) return false;
            // 체결가 정보가 있으면 entry 근접도 검증 (없으면 stale 데이터로 간주하고 거부)
            if (!o.fillPrice || !posEntry) return false;
            const dist = Math.abs(o.fillPrice - posEntry) / posEntry;
            return dist <= PRICE_TOLERANCE;
          })
          .sort((a, b) => (b[1].filledAt ?? b[1].createdAt ?? 0) - (a[1].filledAt ?? a[1].createdAt ?? 0));

        const recoverable = candidates[0];
        if (recoverable) {
          const [recoverId, recoverInfo] = recoverable;
          usedRecoverIds.add(recoverId);
          console.log(`[안전망] ${openPosSide} 매칭 entry 발견 (orderId=${recoverId}, fillPrice=${recoverInfo.fillPrice}) → 자동 등록 시도`);
          try {
            const tpsl = await placeTPSL(recoverInfo);
            if (tpsl.failed.length === 0) {
              console.log(`[안전망] ${openPosSide} TP/SL 자동 복구 성공!`);
              store.set(recoverId, { ...recoverInfo, status: "TPSL_PLACED", tpsl });
            } else {
              const failed = tpsl.failed.map(f => f.type).join(", ");
              console.error(`[안전망] ${openPosSide} TP/SL 자동 복구 부분 실패: ${failed} → 수동 설정 필요!`);
            }
          } catch (e) {
            console.error(`[안전망] ${openPosSide} TP/SL 자동 복구 실패:`, e.message);
          }
        } else {
          console.error(`  ${openPosSide} store에 신뢰 가능한 TP/SL 정보 없음 (진입가 ±${PRICE_TOLERANCE*100}% 매칭 실패)`);
          console.error(`  → Binance에서 수동으로 TP/SL 설정하세요!`);
        }
        console.error("==================================================");
      }
    }

    await store.flush();

    if (limitOrders.length === 0 && store.size === 0) {
      console.log("[복구] 복구할 주문 없음");
    }

  } catch (e) {
    console.warn("[복구] 복구 실패:", e.response?.data?.msg || e.message);
  }

  // try 밖에서 호출 — 복구 실패해도 체결 감지는 반드시 시작
  await startUserDataStream();
}

module.exports = { recoverPendingOrders };
