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
import { PlanCard, OrphanPendingCard } from "./PlanCard";
import { StatsCard }    from "./StatsCard";
import { ReplayStatsCard } from "./ReplayStatsCard";
import { computePaperDailyLoss } from "../../replay/dailyLoss";


export function SidebarPanel({ lastPrice, onCancelOrder, onClosePosition,
  onScaleIn, onCancelScaleIn, onAddSplitTp, onCancelSplitTp, onDrawModeToggle }) {
  const { theme } = useTheme();
  const online = useHealth();

  const {
    balance, balError, _refetchBal,
    position, tpsl, tpslSaving,
    riskPctLong, riskPctShort, setRiskPct, leverage, setLeverage,
    drawMode, drawing, orderStatus, setOrderStatus,
    liveClose, executeOrder, replayOn, paperBroker, replayNowMs,
  } = useStore(useShallow(s => ({
    balance: s.balance, balError: s.balError, _refetchBal: s._refetchBal,
    position: s.position, tpsl: s.tpsl, tpslSaving: s.tpslSaving,
    riskPctLong: s.riskPctLong, riskPctShort: s.riskPctShort, setRiskPct: s.setRiskPct,
    leverage: s.leverage, setLeverage: s.setLeverage,
    drawMode: s.drawMode, drawing: s.drawing, orderStatus: s.orderStatus, setOrderStatus: s.setOrderStatus,
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
    longPendingExists, shortPendingExists, hasPending,
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

  // 플랜 박스가 가리키는 사이드의 리스크 — 슬라이더가 둘이라 어느 쪽 값인지 여기서 고른다
  const planRiskPct = drawing ? riskPctFor({ riskPctLong, riskPctShort }, drawing.isLong) : riskPctLong;

  const posCalc = useMemo(() => {
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

    return calcPosition(balance.availableBalance ?? 0, planRiskPct / 100, drawing.entry, drawing.sl, leverage);
  }, [balance, drawing, planRiskPct, leverage, position?.pending]);

  return (
    <div style={{
      width:`${SIDEBAR_W}px`, height:"100%", flexShrink:0,
      borderLeft:`1px solid ${theme.border}`,
      background:theme.bgSidebar,
      display:"flex", flexDirection:"column", overflow:"hidden",
    }}>

      {/* 잔고 헤더 — 스크롤 고정 */}
      <div style={{ padding:"12px 16px", borderBottom:`1px solid ${theme.border}`, flexShrink:0 }}>
        <BalanceCard balance={balance} error={balError} onRefetch={_refetchBal} online={online} />
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
              style={{
                width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
                background:"transparent", border:"none", cursor:"pointer", padding:0,
              }}
            >
              <span style={{ fontSize:"12px", color: isExceeded ? "#f6465d" : theme.textMuted }}>일일 손실 한도</span>
              <span style={{ fontSize:"10px", color:theme.textFaint }}>{dailyLossOpen ? "▲" : "▼"}</span>
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
          style={{
            width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
            background:"transparent", border:"none", cursor:"pointer", padding:0,
          }}
        >
          {/* 리플레이면 같은 자리에 연습 성적을 띄운다 — 실계좌 통계가 섞이면
              어느 쪽 성적인지 알 수 없고, 그 조회는 백엔드를 부른다 */}
          <span style={{ fontSize:"12px", color:theme.textMuted }}>
            {replayOn ? "연습 성적" : "거래 통계"}
          </span>
          <span style={{ fontSize:"10px", color:theme.textFaint }}>{statsOpen ? "▲" : "▼"}</span>
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
          style={{
            width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
            background:"transparent", border:"none", cursor:"pointer", padding:0,
            marginBottom: settingsOpen ? "8px" : 0,
          }}
        >
          <span style={{ fontSize:"12px", color:theme.textMuted }}>설정</span>
          <span style={{ fontSize:"10px", color:theme.textFaint }}>{settingsOpen ? "▲" : "▼"}</span>
        </button>
        {/* ⚠ 리스크 %는 **롱·숏 따로**다 (2026-08-19 사용자 요청).
            레버리지는 하나뿐인데, 바이낸스가 심볼 단위로만 받아서 사이드별로 나눌 수가 없다
            (`POST /fapi/v1/leverage`에 positionSide가 없다 — settingsSlice 주석 참고).
            리스크는 거래소에 안 보내고 수량 계산에만 쓰이므로 나눠도 어긋날 게 없다.
            ▲/▼ 기호와 초록/빨강은 이 앱에서 롱·숏을 가리키는 색 그대로다 —
            값 크기에 따라 색을 바꾸던 옛 규칙(초록/금색/빨강)은 여기선 쓸 수 없다.
            슬라이더가 둘이 되는 순간 "숏이라서 빨강"인지 "리스크가 높아서 빨강"인지
            구분이 안 되기 때문.
            ※ "자본의 N% — 일일 한도 4%" 경고 문구는 2026-08-19 사용자 요청으로 제거됐다.
              일일 손실 한도는 바로 위 아코디언이 실제 잔여액으로 이미 답하고 있다 */}
        {settingsOpen && <>
        <Slider label="▲ 롱 리스크" value={riskPctLong} min={0.5} max={3} step={0.1}
          onChange={v => setRiskPct(true, v)} format={v => `${v}%`} color="#0ecb81" />
        <div style={{ height:"6px" }} />
        <Slider label="▼ 숏 리스크" value={riskPctShort} min={0.5} max={3} step={0.1}
          onChange={v => setRiskPct(false, v)} format={v => `${v}%`} color="#f6465d" />
        <div style={{ height:"8px" }} />
        <div style={{ opacity: hasPending ? 0.45 : 1, pointerEvents: hasPending ? "none" : "auto" }}>
          <Slider label="레버리지"
            value={pendingLeverage ?? leverage}
            min={leverageMin} max={50} step={1}
            onChange={handleLeverageChange} format={v => `${v}x`}
            color={leverage<=10?"#0ecb81":leverage<=20?"#f0b90b":"#f6465d"} />
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
          <div style={{
            marginTop:8, padding:"10px 12px",
            border:`1px solid #f0b90b55`, borderLeft:`2px solid #f0b90b`,
            borderRadius:5,
          }}>
            <div style={{ fontSize:12, color:"#f0b90b", fontWeight:700, marginBottom:8 }}>
              레버리지 변경 확인
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <span style={{ fontSize:12, color:theme.textMuted }}>현재</span>
              <span style={{ fontSize:13, color:theme.textPrimary, fontWeight:600 }}>{leverage}x</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
              <span style={{ fontSize:12, color:theme.textMuted }}>변경</span>
              <span style={{ fontSize:13, color:"#f0b90b", fontWeight:700 }}>{pendingLeverage}x</span>
            </div>
            {leverageErr && (
              <div style={{ fontSize:11, color:"#f6465d", marginBottom:8 }}>
                실패: {leverageErr}
              </div>
            )}
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={cancelLeverageChange} style={{
                flex:1, padding:"7px 0", borderRadius:4, cursor:"pointer",
                background:"transparent", border:`1px solid ${theme.borderSec}`,
                color:theme.textMuted, fontSize:12, fontFamily:"inherit",
              }}>취소</button>
              <button onClick={confirmLeverageChange} disabled={leverageLoading} style={{
                flex:2, padding:"7px 0", borderRadius:4, cursor:leverageLoading?"not-allowed":"pointer",
                background: leverageLoading ? theme.borderSec : "#f0b90b",
                border:"none", color:"#000",
                fontSize:13, fontFamily:"inherit", fontWeight:700,
              }}>
                {leverageLoading ? "적용 중..." : `${pendingLeverage}x 적용`}
              </button>
            </div>
          </div>
        )}</>}
      </div>

      {/* 플랜 버튼 — 헷지모드: 양쪽 포지션 모두 있거나 pending 주문 추적 중일 때만 잠금 */}
      {(() => {
        const planLocked = hasBoth || !!(drawing?.orderId);
        return (
          <div style={{ padding:"8px 16px", borderBottom:`1px solid ${theme.border}`, flexShrink:0 }}>
            <button
              onClick={() => !planLocked && onDrawModeToggle?.()}
              style={{
                width:"100%", padding:"7px 0", borderRadius:5,
                cursor: planLocked ? "not-allowed" : "pointer",
                fontSize:"13px", fontFamily:"inherit", fontWeight: drawMode ? "700" : "500",
                background: drawMode ? "#a78bfa" : "transparent",
                border:`1px solid ${drawMode ? "#a78bfa" : theme.borderSec}`,
                color: planLocked ? theme.textDisabled : drawMode ? "#000" : theme.textMuted,
                opacity: planLocked ? 0.4 : 1,
                transition:"all 0.15s",
              }}
            >플랜</button>
          </div>
        );
      })()}

      {/* 스크롤 컨텐츠 */}
      <div style={{ flex:1, overflowY:"auto", padding:"12px 16px" }}>

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


        {drawing && (
          <PlanCard
            drawing={drawing} posCalc={posCalc} leverage={leverage} riskPct={planRiskPct}
            position={position}
            hasPending={drawing.isLong ? longPendingExists : shortPendingExists}
            onConfirm={executeOrder}
            onCancel={() => onCancelOrder(isLongToPosition(drawing.isLong))}
          />
        )}
        {/* 헷지모드: 각 사이드 orphan pending을 별도 카드로 표시 (drawing이 매칭되는 사이드는 PlanCard가 대체) */}
        {longPendingExists && !(drawing && drawing.isLong) && (
          <OrphanPendingCard
            pending={position.pending.long}
            onCancel={() => onCancelOrder("LONG")}
          />
        )}
        {shortPendingExists && !(drawing && !drawing.isLong) && (
          <OrphanPendingCard
            pending={position.pending.short}
            onCancel={() => onCancelOrder("SHORT")}
          />
        )}


      </div>
    </div>
  );
}
