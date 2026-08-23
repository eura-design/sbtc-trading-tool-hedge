const express = require("express");
const { binance, cancelOrder } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const { isLiveLimit, limitKind } = require("../utils/orderKind");
const router  = express.Router();

// DELETE /api/orders — 바이낸스 미체결 LIMIT 진입 주문 취소 (source of truth: Binance)
// body: { side?: "LONG"|"SHORT", orderId?: string }
//   orderId 지정 → **그 주문 하나만** / side만 지정 → 그 사이드 전부 / 둘 다 생략 → 전체
//
// ⚠ **부르는 쪽이 orderId를 알면 반드시 실어 보낼 것** (2026-08-23).
//   사이드로만 지우면 그 사이드의 진입 주문을 **싹 다** 취소한다. 우리 시스템은
//   "사이드당 진입 주문 하나"를 전제로 하지만, **밖에서 낸 주문이 같은 사이드에 있으면
//   그 전제가 깨진다** — 내 플랜 박스를 드래그해 수량을 다시 잡는 것만으로
//   바이낸스 웹에서 TP/SL까지 걸어 둔 주문이 조용히 같이 취소된다
router.delete("/", async (req, res) => {
  try {
    const { side, orderId } = req.body ?? {};
    // 바이낸스에서 실제 미체결 LIMIT 주문 조회 후 취소
    // ⚠ **취소 대상은 `utils/orderKind.js`가 정한다** (2026-08-23).
    //   예전엔 store 기록으로 걸렀는데, **밖에서 낸 추가 진입은 기록이 없어서
    //   진입 주문으로 오인돼 같이 취소됐다.** 포지션 유무를 봐야 그게 갈린다
    // ⚠ **포지션 조회가 실패해도 취소가 죽지 않게 한다** (2026-08-23).
    //   정체 판정이 포지션 유무를 보므로, `Promise.all`로 묶으면 그 조회 한 번이 튈 때
    //   **취소 자체가 안 된다.** 전에는 store만 봐서 실패할 일이 없던 기능이라 후퇴다.
    //   → 포지션을 못 읽으면 **`orderId`로 콕 집은 경우에만** 진행한다.
    //     "이 주문 하나"는 대상이 분명하고, 방향·store 가드가 그대로 서 있다.
    //     사이드 일괄 취소는 무엇이 딸려갈지 모르므로 그때는 거절한다
    const [ooRes, posRes] = await Promise.allSettled([
      binance("GET", "/fapi/v1/openOrders",   { symbol: "BTCUSDT" }),
      binance("GET", "/fapi/v2/positionRisk", { symbol: "BTCUSDT" }),
    ]);
    if (ooRes.status !== "fulfilled") throw ooRes.reason;
    const openOrders = ooRes.value.data;
    const hasPosFor = posRes.status === "fulfilled" ? {
      LONG:  posRes.value.data.some(p => p.positionSide === "LONG"  && parseFloat(p.positionAmt) > 0),
      SHORT: posRes.value.data.some(p => p.positionSide === "SHORT" && parseFloat(p.positionAmt) < 0),
    } : null;
    if (!hasPosFor) {
      const why = posRes.reason?.response?.data?.msg || posRes.reason?.message;
      console.warn("[orders] 포지션 조회 실패 →", orderId ? "orderId 지정분만 취소" : "취소 거절", why);
      if (!orderId) {
        return res.status(503).json({
          error: "포지션 상태를 읽지 못해 취소를 중단했습니다 — 잠시 후 다시 시도하세요",
        });
      }
    }
    const entryOrders = openOrders.filter(o => {
      if (!isLiveLimit(o)) return false;
      // ⚠ orderId를 줘도 **정체 판정은 그대로 통과시킨다** — 잘못된 id가 와도
      //   분할 TP나 추가 진입이 취소되지 않는다 (id는 대상을 좁히기만 한다)
      if (limitKind(o, hasPosFor, store.get(String(o.orderId))) !== "ENTRY") return false;
      if (orderId && String(o.orderId) !== String(orderId)) return false;
      // side 지정 시 해당 사이드만 취소
      if (side && o.positionSide !== side) return false;
      return true;
    });

    for (const o of entryOrders) {
      await cancelOrder({ orderId: o.orderId })
        .catch(e => console.warn(`주문 취소 실패 (orderId=${o.orderId}):`, e.response?.data?.msg));
      store.delete(String(o.orderId));
    }

    // store에만 남아있는 WATCHING 정리
    // ⚠ **바이낸스에 살아 있는 주문의 메모는 건드리지 않는다** (2026-08-23).
    //   예전엔 side를 지정해도 WATCHING을 **전부** 지웠다 → 롱만 취소했는데 숏 미체결
    //   주문의 tp/sl 기록까지 날아가고, 그 주문이 체결되면 **TP/SL을 걸 근거가 없어
    //   무방비 포지션**이 된다 (2026-08-15에 고친 사고와 같은 모양).
    //   "store에만 남아있는"이라는 원래 의도대로 openOrders에 없는 것만 지운다
    const liveIds = new Set(openOrders.map(o => String(o.orderId)));
    for (const [id, info] of store.entries()) {
      if (info.status !== "WATCHING") continue;
      if (liveIds.has(String(id))) continue;
      store.delete(id);
    }

    res.json({ success: true, cancelled: entryOrders.length });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
