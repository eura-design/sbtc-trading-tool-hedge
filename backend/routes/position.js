const express = require("express");
const { binance } = require("../services/binanceClient");
const store   = require("../store/pendingOrders");
const { resolveOrphans } = require("../services/orderWatcher");
const { resolveEntryInfo } = require("../services/entryTime");
const { isLiveLimit, limitKind } = require("../utils/orderKind");
const { log, errOf } = require("../store/logStore");
const symbolInfo = require("../services/symbolInfo");
const router  = express.Router();

router.get("/", async (req, res) => {
  try {
    // 화면이 보고 있는 심볼 하나. ⚠ 여기는 **v2**를 심볼 지정으로 부른다 —
    // 화면이 레버리지를 쓰는데 v3에는 그 필드가 없다 (orderWatcher 주석 참고).
    // 심볼을 지정하면 한 행이라 v2의 1784행 문제도 없다
    const symbol = symbolInfo.fromRequest(req);
    const [{ data: posData }, { data: openOrders }, { data: fundingData }] = await Promise.all([
      binance("GET", "/fapi/v2/positionRisk", { symbol }),
      binance("GET", "/fapi/v1/openOrders",   { symbol }),
      binance("GET", "/fapi/v1/premiumIndex", { symbol }),
    ]);

    // 헷지모드: LONG / SHORT 각각 분리
    const longPos  = posData.find(p => p.positionSide === "LONG"  && parseFloat(p.positionAmt) > 0);
    const shortPos = posData.find(p => p.positionSide === "SHORT" && parseFloat(p.positionAmt) < 0);

    const makePos = p => !p ? null : {
      size:             Math.abs(parseFloat(p.positionAmt)),
      entryPrice:       parseFloat(p.entryPrice),
      unrealizedPnl:    parseFloat(p.unRealizedProfit),
      leverage:         parseInt(p.leverage),
      liquidationPrice: parseFloat(p.liquidationPrice) || null,
      entryTime:        null,   // 아래에서 채운다
      entrySteps:       null,   // 〃
    };

    // ⚠ **미체결 LIMIT의 정체는 store가 아니라 `utils/orderKind.js`가 정한다**
    //   (2026-08-23). 예전엔 store 기록(SCALE_IN/SPLIT_TP)으로만 갈랐다 — 그래서
    //   **바이낸스 앱·웹에서 직접 낸 주문은 화면에 제대로 나타나지 않았다**:
    //   외부 분할 익절·추가 진입은 아예 안 보이고, 외부 진입 주문만 "외부 미체결 주문"
    //   카드로 떴다. 기록이 유실된 우리 주문도 같은 증상이었다 (사용자 신고).
    //   → 판정 근거를 주문 자체(방향)와 포지션 유무로 옮겨서, **store가 통째로 없어도
    //     화면이 맞게 나온다.** store는 이제 우리만 아는 부가정보(플랜 박스·예약 TP/SL·
    //     등록 당시 비율)만 담는다
    const hasPosFor  = { LONG: !!longPos, SHORT: !!shortPos };
    const liveLimits = openOrders.filter(isLiveLimit);
    const kindOf      = o => limitKind(o, hasPosFor, store.get(String(o.orderId)));
    const entryOrders = liveLimits.filter(o => kindOf(o) === "ENTRY");
    const scaleIns    = liveLimits.filter(o => kindOf(o) === "SCALE_IN");

    // 헷지모드: LONG/SHORT 각각 독립 pending 추적
    let longPending  = null;
    let shortPending = null;
    for (const o of entryOrders) {
      const stored = store.get(String(o.orderId));
      const pendingObj = {
        orderId: String(o.orderId),
        side:    o.side,
        price:   parseFloat(o.price),
        qty:     parseFloat(o.origQty),
        status:  o.status,
        drawing: stored?.drawing ?? null,
        tp:      stored?.tp ?? null,
        sl:      stored?.sl ?? null,
        source:  stored ? "system" : "external",
      };
      if (o.positionSide === "LONG") longPending = pendingObj;
      else if (o.positionSide === "SHORT") shortPending = pendingObj;
    }
    const pending = (longPending || shortPending)
      ? { long: longPending, short: shortPending }
      : null;

    // store에 WATCHING인데 바이낸스 미체결 목록에 없는 주문 → 실제 상태를 확인해 처리
    //
    // ⚠ **여기서 바로 store.delete를 하지 말 것** (2026-08-15, 실계좌 재현).
    //   체결된 주문과 취소된 주문은 **둘 다** openOrders에서 사라진다. 구분 없이 지우면
    //   체결된 주문의 store 항목이 없어지고, 그 순간 TP/SL을 등록할 경로가 **전부** 죽는다
    //   (onFilled의 `!store.has` / pollForFills의 WATCHING 필터 / reconcile의 relevant 필터).
    //   실제로 orderId 1103367652357(LIMIT BUY LONG)이 이렇게 SL 없이 1.6시간 방치됐다.
    //   게다가 이 유예(30초)가 reconcile 주기(60초)보다 **짧아서**, 복구가 오기 전에
    //   삭제가 먼저 도달하는 게 오히려 일반적이었다.
    //   → 지우는 판단은 바이낸스에 물어본 뒤 resolveOrphans가 한다.
    const GRACE_PERIOD = 30_000;
    const now = Date.now();
    const openIds = new Set(openOrders.map(o => String(o.orderId)));
    const orphans = [...store.entries()].filter(([orderId, info]) =>
      info.status === "WATCHING" &&
      !openIds.has(String(orderId)) &&
      !(info.createdAt && now - info.createdAt < GRACE_PERIOD)
    );
    // fire-and-forget — 폴링 응답을 주문 조회만큼 늦추지 않는다
    if (orphans.length) resolveOrphans(orphans)
      .catch(e => log("ORPHAN_RESOLVE_FAILED", { level: "warn", count: orphans.length, err: errOf(e) }));

    // 추가 진입 목록 — 위에서 판정한 것을 그대로 쓴다 (외부 주문도 여기 들어온다)
    const scaleInOrders = scaleIns
      .map(o => ({
        orderId: String(o.orderId),
        price:   parseFloat(o.price),
        qty:     parseFloat(o.origQty),
        side:    o.side,
      }))
      .sort((a, b) => b.price - a.price);

    const funding = {
      rate:            parseFloat(fundingData.lastFundingRate) * 100,
      nextFundingTime: fundingData.nextFundingTime,
    };

    const out = { long: makePos(longPos), short: makePos(shortPos) };

    // entryTime / entrySteps — 차트 진입선을 **진입봉부터 계단식으로** 긋는 데 쓴다
    // (PositionLines.jsx). entrySteps = [{ t, avg }] — 그 시각부터 유효했던 평단.
    // ⚠ positionRisk의 updateTime을 쓰지 말 것. 그건 "마지막으로 바뀐 시각"이라
    //   부분 청산 때마다 앞으로 밀린다 (실측 8시간 차이) — services/entryTime.js 주석 참고.
    // 포지션이 바뀌지 않으면 캐시라 추가 요청이 없다. 실패하면 null이고,
    // 그때는 프론트가 예전처럼 전 폭 직선으로 긋는다
    const entry = await resolveEntryInfo(out, symbol);
    for (const [key, side] of [["long", "LONG"], ["short", "SHORT"]]) {
      if (!out[key]) continue;
      out[key].entryTime  = entry[side]?.time  ?? null;
      out[key].entrySteps = entry[side]?.steps ?? null;
    }

    res.json({
      ...out,
      pending,
      scaleInOrders,
      funding,
    });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
