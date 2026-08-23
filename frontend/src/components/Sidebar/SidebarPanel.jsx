import { useMemo, useCallback, useState, useEffect } from "react";
import { SIDEBAR_W } from "../../constants";
import { useTheme }  from "../../ThemeContext";
import { useHealth } from "../../hooks/useHealth";
import { useStore }  from "../../store";
import { riskPctFor } from "../../store/settingsSlice";
import { useShallow } from "zustand/react/shallow";
import { calcPosition } from "../../utils/calc";
import { api }       from "../../api/client";
import { useDailyLoss } from "../../hooks/useDailyLoss";
import { useAccordion } from "../../hooks/useAccordion";
import { derivePositionFlags } from "../../hooks/usePositionFlags";
import { isLongToPosition } from "../../utils/side";
import { Slider }    from "../Slider";
import { StatusAlert }                from "../StatusAlert";
import { BalanceCard }                from "./BalanceCard";
import { MarketInfoCard }            from "./MarketInfoCard";
import { PositionCard }  from "./PositionCard";
import { PlanCard } from "./PlanCard";
import { StatsCard }    from "./StatsCard";
import { ReplayStatsCard } from "./ReplayStatsCard";
import { computePaperDailyLoss } from "../../replay/dailyLoss";
import { CONFIRM_ROW, primaryBtn, ghostBtn, actionBtn, SECTION_HEADER, headerArrow } from "../sidebarBtn";


export function SidebarPanel({ lastPrice, onCancelOrder, onClosePosition,
  onScaleIn, onCancelScaleIn, onAddSplitTp, onCancelSplitTp, onDrawModeToggle }) {
  const { theme } = useTheme();
  const online = useHealth();

  const {
    balance, balError, _refetchBal,
    position, tpsl, tpslSaving,
    riskPctLong, riskPctShort, setRiskPct, leverage, setLeverage,
    drawMode, drawings, orderStatus, setOrderStatus,
    liveClose, executeOrder, replayOn, paperBroker, replayNowMs,
  } = useStore(useShallow(s => ({
    balance: s.balance, balError: s.balError, _refetchBal: s._refetchBal,
    position: s.position, tpsl: s.tpsl, tpslSaving: s.tpslSaving,
    riskPctLong: s.riskPctLong, riskPctShort: s.riskPctShort, setRiskPct: s.setRiskPct,
    leverage: s.leverage, setLeverage: s.setLeverage,
    drawMode: s.drawMode, drawings: s.drawings, orderStatus: s.orderStatus, setOrderStatus: s.setOrderStatus,
    liveClose: s.liveClose, executeOrder: s.executeOrder,
    replayOn: s.replayOn, paperBroker: s.paperBroker, replayNowMs: s.replayNowMs,
  })));

  // ⚠ 스토어 구독 **뒤에** 와야 한다 — replayOn 등을 쓰므로 위로 올리면 TDZ 오류로
  //   사이드바가 통째로 렌더되지 않는다 (빈 화면이 된다)
  //
  // 리플레이면 연습 계좌의 한도를 **재생 시각 기준**으로 계산한다.
  // 실거래 값을 그대로 두면 과거를 보는 중에 오늘의 계좌 상태가 뜬다
  const realDailyLoss  = useDailyLoss(!replayOn);
  const paperDailyLoss = useMemo(
    () => replayOn
      ? computePaperDailyLoss(paperBroker?.trades ?? [], paperBroker?.startBalance ?? 0,
                              paperBroker?.balance ?? 0, replayNowMs)
      : null,
    // balance는 값 자체를 안 쓰지만, 체결이 일어날 때마다 새 객체가 되므로
    // 이걸 넣어야 trades가 in-place로 자란 걸 놓치지 않는다
    [replayOn, paperBroker, replayNowMs, balance],  // eslint-disable-line react-hooks/exhaustive-deps
  );
  const dailyLoss = replayOn ? paperDailyLoss : realDailyLoss;

  const {
    hasLong, hasShort, hasPos, hasBoth,
    longPendingExists, shortPendingExists, hasPending, drawLocked,
  } = derivePositionFlags(position);
  const effectiveLastPrice = liveClose ?? lastPrice;

  // 헷지모드: 양쪽 포지션의 레버리지 중 더 큰 값을 최소값으로 사용 (낮은 레버리지로 변경 시 오류 방지)
  const longLeverage  = position?.long?.leverage  ?? null;
  const shortLeverage = position?.short?.leverage ?? null;
  const posLeverage = (longLeverage !== null && shortLeverage !== null)
    ? Math.max(longLeverage, shortLeverage)
    : (longLeverage ?? shortLeverage);
  const leverageMin = hasPos ? (posLeverage ?? leverage) : 1;

  const [pendingLeverage, setPendingLeverage] = useState(null);
  const [leverageLoading, setLeverageLoading] = useState(false);
  const [leverageErr, setLeverageErr]         = useState(null);
  const [statsOpen,     toggleStats]     = useAccordion("accordion_stats");
  const [dailyLossOpen, toggleDailyLoss] = useAccordion("accordion_dailyLoss");
  const [settingsOpen,  toggleSettings]  = useAccordion("accordion_settings");

  const handleLeverageChange = useCallback((val) => {
    if (hasPending) return; // 대기 주문 있을 때 변경 차단
    if (hasPos && val < leverageMin) return; // 포지션 있을 때 감소 차단
    if (val === leverage) { setPendingLeverage(null); return; }
    setPendingLeverage(val);
    setLeverageErr(null);
  }, [hasPending, hasPos, leverageMin, leverage]);

  const confirmLeverageChange = useCallback(async () => {
    if (!pendingLeverage) return;
    setLeverageLoading(true);
    setLeverageErr(null);
    try {
      if (replayOn) {
        // 연습 계좌는 백엔드가 없다. 보유 중인 페이퍼 포지션의 레버리지를 직접 바꾼다
        // (청산가·증거금이 여기서 나오므로 반영해야 화면이 맞는다).
        // 안 하면 POST가 가드에 막혀 "실제 주문을 보낼 수 없습니다" 에러만 뜬다
        const b = useStore.getState().paperBroker;
        if (b) {
          for (const side of ["LONG", "SHORT"]) {
            if (b.pos[side]) b.pos[side].leverage = pendingLeverage;
          }
          useStore.getState().syncPaper();
          useStore.getState().scheduleReplaySave?.();
        }
      } else if (hasPos) {
        await api("POST", "/api/leverage", { leverage: pendingLeverage });
      }
      setLeverage(pendingLeverage);
      setPendingLeverage(null);
    } catch (e) {
      setLeverageErr(e.message);
    } finally {
      setLeverageLoading(false);
    }
  }, [hasPos, pendingLeverage, setLeverage, replayOn]);

  const cancelLeverageChange = useCallback(() => {
    setPendingLeverage(null);
    setLeverageErr(null);
  }, []);

  // ⚠ 모드를 바꾸면 확인 대기 중인 레버리지 변경을 버린다 (2026-08-19).
  //   리스크·레버리지는 모드별로 따로 저장되므로(settingsSlice.swapTradeSettings),
  //   이걸 안 지우면 **실거래에서 고르던 값이 연습 화면에 확인 버튼째로 남아 있다가
  //   그대로 적용된다** — 분리한 의미가 사라진다
  useEffect(() => {
    setPendingLeverage(null);
    setLeverageErr(null);
  }, [replayOn]);

  // ⚠ 플랜 박스가 **롱·숏 각각 하나**라 수량 계산도 사이드마다 따로 돈다 (2026-08-19).
  //   리스크 %도 사이드별이므로(settingsSlice) 두 값이 짝을 이뤄야 한다 —
  //   한쪽 리스크로 양쪽 수량을 내면 화면과 실제 주문이 어긋난다.
  //
  //   ⚠ **두 박스는 같은 `availableBalance`를 본다.** 둘 다 실행하면 첫 주문이
  //     증거금을 묶은 뒤라 두 번째는 여기 보이던 수량보다 작게 나갈 수 있다
  //     (calcPosition의 레버리지 상한에 걸린다). 합계를 미리 빼서 보여주지는 않는다 —
  //     어느 쪽을 먼저 낼지는 사용자가 정하는 것이고, 순서를 가정하면 둘 다 틀린 값이 된다
  const calcFor = (drawing) => {
    if (!drawing || !balance) return null;
    
    if (drawing.orderId && position?.pending) {
      const p = drawing.isLong ? position.pending.long : position.pending.short;
      if (p && p.orderId === drawing.orderId) {
        return {
          actualQty: p.qty,
          idealQty: p.qty,
          idealRiskPct: 0,
          actualRiskPct: 0,
          isMinCapped: false,
          isLeverageCapped: false,
        };
      }
    }

    const risk = riskPctFor({ riskPctLong, riskPctShort }, drawing.isLong);
    return calcPosition(balance.availableBalance ?? 0, risk / 100, drawing.entry, drawing.sl, leverage);
  };

  const deps = [balance, drawings, riskPctLong, riskPctShort, leverage, position?.pending];
  const longCalc  = useMemo(() => calcFor(drawings.long),  deps);  // eslint-disable-line react-hooks/exhaustive-deps
  const shortCalc = useMemo(() => calcFor(drawings.short), deps);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      width:`${SIDEBAR_W}px`, height:"100%", flexShrink:0,
      borderLeft:`1px solid ${theme.border}`,
      background:theme.bgSidebar,
      display:"flex", flexDirection:"column", overflow:"hidden",
    }}>

      {/* 잔고 헤더 — 스크롤 고정 */}
      <div style={{ padding:"12px 16px", borderBottom:`1px solid ${theme.border}`, flexShrink:0 }}>
        <BalanceCard balance={balance} position={position} lastPrice={effectiveLastPrice}
                     error={balError} onRefetch={_refetchBal} online={online} />
      </div>

      {/* 시장 정보 — 펀딩비 + 공포탐욕지수 */}
      <MarketInfoCard />

      {/* 일일 손실 한도 */}
      {dailyLoss && (() => {
        const isExceeded = dailyLoss.remaining <= 0;
        const resetStr = (() => {
          const now = new Date();
          const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
          const diff = reset - now;
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          return `${h}h ${m}m`;
        })();
        const rows = [
          ["오늘 손익", `${dailyLoss.todayPnl >= 0 ? "+" : ""}${dailyLoss.todayPnl.toFixed(2)}`, "#94a3b8"],
          [isExceeded ? "한도 초과" : "잔여 한도", isExceeded ? `리셋 ${resetStr}` : `${dailyLoss.remaining.toFixed(1)}`, isExceeded ? "#f6465d" : "#94a3b8"],
        ];
        return (
          <div style={{ padding:"8px 16px", borderBottom:`1px solid ${theme.border}`, flexShrink:0,
            background: isExceeded ? theme.bgError : "transparent" }}>
            <button
              onClick={toggleDailyLoss}
              style={SECTION_HEADER}
            >
              <span style={{ fontSize:"12px", color: isExceeded ? "#f6465d" : theme.textMuted }}>일일 손실 한도</span>
              <span style={headerArrow(theme)}>{dailyLossOpen ? "▲" : "▼"}</span>
            </button>
            {dailyLossOpen && (
              <div style={{ marginTop:"6px" }}>
                {rows.map(([l, v, c]) => (
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"4px 0", borderBottom:`1px solid ${theme.border}` }}>
                    <span style={{ fontSize:"12px", color:theme.textMuted }}>{l}</span>
                    <span style={{ fontSize:"13px", color:c, fontWeight:"600" }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* 거래 통계 */}
      <div style={{ padding:"8px 16px", borderBottom:`1px solid ${theme.border}`, flexShrink:0 }}>
        <button
          onClick={toggleStats}
          style={SECTION_HEADER}
        >
          {/* 리플레이면 같은 자리에 연습 성적을 띄운다 — 실계좌 통계가 섞이면
              어느 쪽 성적인지 알 수 없고, 그 조회는 백엔드를 부른다 */}
          <span style={{ fontSize:"12px", color:theme.textMuted }}>
            {replayOn ? "연습 성적" : "거래 통계"}
          </span>
          <span style={headerArrow(theme)}>{statsOpen ? "▲" : "▼"}</span>
        </button>
        {statsOpen && (
          <div style={{ marginTop:"6px" }}>
            {replayOn ? <ReplayStatsCard /> : <StatsCard />}
          </div>
        )}
      </div>

      {/* 설정 — 리스크% + 레버리지 */}
      <div style={{ padding:"8px 16px", borderBottom:`1px solid ${theme.border}`, flexShrink:0 }}>
        <button
          onClick={toggleSettings}
          style={{ ...SECTION_HEADER, marginBottom: settingsOpen ? "8px" : 0 }}
        >
          <span style={{ fontSize:"12px", color:theme.textMuted }}>설정</span>
          <span style={headerArrow(theme)}>{settingsOpen ? "▲" : "▼"}</span>
        </button>
        {/* ⚠ 리스크 %는 **롱·숏 따로**다 (2026-08-19 사용자 요청).
            레버리지는 하나뿐인데, 바이낸스가 심볼 단위로만 받아서 사이드별로 나눌 수가 없다
            (`POST /fapi/v1/leverage`에 positionSide가 없다 — settingsSlice 주석 참고).
            리스크는 거래소에 안 보내고 수량 계산에만 쓰이므로 나눠도 어긋날 게 없다.
            ⚠ **세 슬라이더 색은 전부 금색이다** (2026-08-22 사용자 확정) —
              `color` prop을 넘기지 않아 Slider 기본값(#f0b90b)을 쓴다.
              롱·숏 구분은 `▲`/`▼` 기호가 한다. 색으로 나누지 말 것:
              ① 초록/빨강으로 나눴더니 숏만 손잡이와 값이 빨개서 **경고처럼 보였다**
                 — 값이 최소면 채움 폭이 0이라 그 둘만 빨갛다 (사용자 지적)
              ② 레버리지에 있던 값별 색(≤10 초록 / ≤20 금색 / 그 외 빨강)도 함께 없앴다.
                 셋이 나란한데 하나만 값에 따라 색이 변하면 규칙이 둘로 읽힌다
              ※ 사이드바에서 빨강은 손실·위험을 뜻하는 색으로 남겨 둔다.
            ※ "자본의 N% — 일일 한도 4%" 경고 문구는 2026-08-19 사용자 요청으로 제거됐다.
              일일 손실 한도는 바로 위 아코디언이 실제 잔여액으로 이미 답하고 있다 */}
        {settingsOpen && <>
        <Slider label="▲ 롱 리스크" value={riskPctLong} min={0.5} max={3} step={0.1}
          onChange={v => setRiskPct(true, v)} format={v => `${v}%`} />
        <div style={{ height:"6px" }} />
        <Slider label="▼ 숏 리스크" value={riskPctShort} min={0.5} max={3} step={0.1}
          onChange={v => setRiskPct(false, v)} format={v => `${v}%`} />
        <div style={{ height:"8px" }} />
        <div style={{ opacity: hasPending ? 0.45 : 1, pointerEvents: hasPending ? "none" : "auto" }}>
          <Slider label="레버리지"
            value={pendingLeverage ?? leverage}
            min={leverageMin} max={50} step={1}
            onChange={handleLeverageChange} format={v => `${v}x`} />
        </div>
        {hasPending && !pendingLeverage && (
          <div style={{
            fontSize:10, color:"#f59e0b", marginTop:4, textAlign:"right",
            display:"flex", alignItems:"center", justifyContent:"flex-end", gap:3,
          }}>
            🔒 대기 주문 체결 전까지 변경 불가
          </div>
        )}
        {!hasPending && hasPos && posLeverage !== null && !pendingLeverage && (
          <div style={{ fontSize:10, color:theme.textFaint, marginTop:3, textAlign:"right" }}>
            {longLeverage !== null && shortLeverage !== null && longLeverage !== shortLeverage
              ? `L ${longLeverage}x / S ${shortLeverage}x — ${posLeverage}x 미만 불가`
              : `포지션 보유 중 — ${posLeverage}x 미만 불가`}
          </div>
        )}
        {pendingLeverage && (
          /* ⚠ 버튼 둘뿐이다 (2026-08-22 사용자 요청).
             규격은 `components/confirmBtn.js` — 시장가 청산의 `✓ 확인 / ✕ 취소`와
             **같은 크기·같은 모양**이어야 해서 스타일을 그쪽 한 곳에 둔다.
             ※ 예전엔 제목 + `현재`/`변경` 두 줄 → `5x → 10x` 한 줄로 줄였다가
               이제 그것도 없다. **바뀌는 값은 슬라이더가 이미 보여준다**
               (`value={pendingLeverage ?? leverage}` — 오른쪽 숫자가 바로 그 값이다).
               호박색 테두리 상자도 같이 없앴다 — 버튼 둘이 떠 있는 것 자체가
               "아직 적용 전"이라는 신호다 */
          <div style={{ marginTop:8 }}>
            <div style={CONFIRM_ROW}>
              <button onClick={cancelLeverageChange} style={ghostBtn(theme)}>취소</button>
              <button onClick={confirmLeverageChange} disabled={leverageLoading}
                style={primaryBtn(theme, "#f0b90b", "#000", leverageLoading)}>
                {leverageLoading ? "적용 중" : "적용"}
              </button>
            </div>
            {leverageErr && (
              <div style={{ fontSize:11, color:"#f6465d", marginTop:5 }}>
                실패: {leverageErr}
              </div>
            )}
          </div>
        )}</>}
      </div>

      {/* 플랜 버튼 — 헷지모드: 양쪽 포지션 모두 있거나 pending 주문 추적 중일 때만 잠금 */}
      {(() => {
        // ⚠ **양쪽 슬롯이 다 막혔을 때만** 잠근다 (2026-08-19).
        //   예전엔 박스가 하나뿐이라 "그 박스에 주문이 걸리면 잠금"(`drawing?.orderId`)이었는데,
        //   지금은 롱에 주문이 걸려 있어도 숏 플랜은 새로 그릴 수 있어야 한다.
        //   ⚠ 판정은 차트 쪽 잠금(`drawLocked` — hitDetection 3.7의 `locked`)과 **같은 값**이다.
        //     따로 만들면 버튼은 살아 있는데 차트에서는 안 그려지는(또는 반대) 상태가 생긴다.
        //   ※ 주문을 낸 직후 position 재조회(1.5초) 전까지는 여기가 아직 false지만,
        //     그 창에서 같은 사이드를 덮어 그리는 건 `draw.onUp`이 되돌린다 (이중 방어)
        const planLocked = drawLocked;
        return (
          <div style={{ padding:"8px 16px", borderBottom:`1px solid ${theme.border}`, flexShrink:0 }}>
            <button
              onClick={() => !planLocked && onDrawModeToggle?.()}
              style={{
                ...actionBtn(theme, drawMode ? "#a78bfa" : theme.borderSec, false,
                             drawMode ? "700" : "500"),
                background: drawMode ? "#a78bfa" : "transparent",
                color: planLocked ? theme.textDisabled : drawMode ? "#000" : theme.textMuted,
                cursor: planLocked ? "not-allowed" : "pointer",
                opacity: planLocked ? 0.4 : 1,
              }}
            >플랜</button>
          </div>
        );
      })()}

      {/* 스크롤 컨텐츠 */}
      {/* 스크롤 막대만 감춘다 — 스크롤은 그대로다 (index.css `.no-scrollbar`) */}
      <div className="no-scrollbar" style={{ flex:1, overflowY:"auto", padding:"12px 16px" }}>

        <StatusAlert status={orderStatus} onClose={() => setOrderStatus(null)} />

        {/* 포지션 카드 — 롱/숏 각각 (추가진입·분할TP 아코디언 포함) */}
        <PositionCard
          posData={position?.long} side="LONG"
          tpsl={tpsl.long ?? { tp: null, sl: null, splitTps: [] }}
          tpslSaving={tpslSaving} onClose={onClosePosition} lastPrice={effectiveLastPrice}
          scaleInOrders={position?.scaleInOrders?.filter(o => o.side === "BUY")}
          onScaleIn={onScaleIn} onCancelScaleIn={onCancelScaleIn}
          onAddSplitTp={onAddSplitTp} onCancelSplitTp={onCancelSplitTp}
        />
        <PositionCard
          posData={position?.short} side="SHORT"
          tpsl={tpsl.short ?? { tp: null, sl: null, splitTps: [] }}
          tpslSaving={tpslSaving} onClose={onClosePosition} lastPrice={effectiveLastPrice}
          scaleInOrders={position?.scaleInOrders?.filter(o => o.side === "SELL")}
          onScaleIn={onScaleIn} onCancelScaleIn={onCancelScaleIn}
          onAddSplitTp={onAddSplitTp} onCancelSplitTp={onCancelSplitTp}
        />


        {/* 플랜 카드도 사이드마다 하나 — 롱을 위에 둔다 (차트 라벨 ▲/▼와 같은 순서) */}
        {[[true, drawings.long, longCalc, longPendingExists],
          [false, drawings.short, shortCalc, shortPendingExists]].map(([isLong, box, calc, pend]) => box && (
          <PlanCard
            key={isLong ? "long" : "short"}
            drawing={box} posCalc={calc} leverage={leverage}
            riskPct={riskPctFor({ riskPctLong, riskPctShort }, isLong)}
            position={position}
            hasPending={pend}
            onConfirm={(orderType) => executeOrder(orderType, isLong)}
            onCancel={() => onCancelOrder(isLongToPosition(isLong))}
          />
        ))}
        {/* ⚠ **박스 없는 미체결 주문 카드(OrphanPendingCard)는 제거됐다** (2026-08-23 사용자 요청).
            그 자리를 **차트의 대기선**이 대신한다 — 점선 + 좌측 `대기` 버튼 + 수량 + `×`
            (PositionLines / hitDetection.pendingEntryLines).
            사이드바 카드는 **가격을 글자로만** 알려줬는데, 미체결 주문에서 정작 궁금한 건
            "지금 가격에서 얼마나 떨어져 있나"라 차트에 선으로 있는 편이 낫다.
            취소도 그 선의 `×`로 되므로 카드가 하던 일이 전부 옮겨갔다.
            되살리려면 대기선을 같이 지울 것 — 둘 다 두면 같은 주문이 두 군데서 취소된다 */}


      </div>
    </div>
  );
}
