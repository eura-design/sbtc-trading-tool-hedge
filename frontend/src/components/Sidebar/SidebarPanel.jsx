import { useMemo, useCallback, useState } from "react";
import { SIDEBAR_W } from "../../constants";
import { useTheme }  from "../../ThemeContext";
import { useHealth } from "../../hooks/useHealth";
import { useStore }  from "../../store";
import { useShallow } from "zustand/react/shallow";
import { calcPosition } from "../../utils/calc";
import { api }       from "../../api/client";
import { useDailyLoss } from "../../hooks/useDailyLoss";
import { Slider }    from "../Slider";
import { StatusAlert }                from "../StatusAlert";
import { BalanceCard }                from "./BalanceCard";
import { MarketInfoCard }            from "./MarketInfoCard";
import { PositionCard, PendingCard }  from "./PositionCard";
import { PlanCard, OrphanPendingCard } from "./PlanCard";
import { StatsCard }    from "./StatsCard";


export function SidebarPanel({ lastPrice, onCancelOrder, onClosePosition,
  onScaleIn, onCancelScaleIn, onAddSplitTp, onCancelSplitTp, onDrawModeToggle }) {
  const { theme } = useTheme();
  const online = useHealth();
  const dailyLoss = useDailyLoss();

  const {
    balance, balError, _refetchBal,
    position, tpsl, tpslSaving,
    riskPct, setRiskPct, leverage, setLeverage,
    drawMode, drawing, orderStatus, setOrderStatus,
    liveClose, executeOrder,
  } = useStore(useShallow(s => ({
    balance: s.balance, balError: s.balError, _refetchBal: s._refetchBal,
    position: s.position, tpsl: s.tpsl, tpslSaving: s.tpslSaving,
    riskPct: s.riskPct, setRiskPct: s.setRiskPct,
    leverage: s.leverage, setLeverage: s.setLeverage,
    drawMode: s.drawMode, drawing: s.drawing, orderStatus: s.orderStatus, setOrderStatus: s.setOrderStatus,
    liveClose: s.liveClose, executeOrder: s.executeOrder,
  })));

  const hasLong    = !!position?.long;
  const hasShort   = !!position?.short;
  const hasPos     = hasLong || hasShort;
  const hasBoth    = hasLong && hasShort;
  const hasPending = !!position?.pending;
  const effectiveLastPrice = liveClose ?? lastPrice;

  const posLeverage = (position?.long ?? position?.short)?.leverage ?? null;
  const leverageMin = hasPos ? (posLeverage ?? leverage) : 1;

  const [pendingLeverage, setPendingLeverage] = useState(null);
  const [leverageLoading, setLeverageLoading] = useState(false);
  const [leverageErr, setLeverageErr]         = useState(null);
  const [statsOpen, setStatsOpen]         = useState(false);
  const [dailyLossOpen, setDailyLossOpen] = useState(false);
  const [settingsOpen, setSettingsOpen]   = useState(false);

  const handleLeverageChange = useCallback((val) => {
    if (hasPos && val < leverageMin) return; // 포지션 있을 때 감소 차단
    if (val === leverage) { setPendingLeverage(null); return; }
    setPendingLeverage(val);
    setLeverageErr(null);
  }, [hasPos, leverageMin, leverage]);

  const confirmLeverageChange = useCallback(async () => {
    if (!pendingLeverage) return;
    setLeverageLoading(true);
    setLeverageErr(null);
    try {
      if (hasPos) await api("POST", "/api/leverage", { leverage: pendingLeverage });
      setLeverage(pendingLeverage);
      setPendingLeverage(null);
    } catch (e) {
      setLeverageErr(e.message);
    } finally {
      setLeverageLoading(false);
    }
  }, [hasPos, pendingLeverage, setLeverage]);

  const cancelLeverageChange = useCallback(() => {
    setPendingLeverage(null);
    setLeverageErr(null);
  }, []);

  const posCalc = useMemo(() => {
    if (!drawing || !balance) return null;
    return calcPosition(balance.availableBalance ?? 0, riskPct / 100, drawing.entry, drawing.sl, leverage);
  }, [balance, drawing, riskPct, leverage]);

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
              onClick={() => setDailyLossOpen(v => !v)}
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
          onClick={() => setStatsOpen(v => !v)}
          style={{
            width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
            background:"transparent", border:"none", cursor:"pointer", padding:0,
          }}
        >
          <span style={{ fontSize:"12px", color:theme.textMuted }}>거래 통계</span>
          <span style={{ fontSize:"10px", color:theme.textFaint }}>{statsOpen ? "▲" : "▼"}</span>
        </button>
        {statsOpen && <div style={{ marginTop:"6px" }}><StatsCard /></div>}
      </div>

      {/* 설정 — 리스크% + 레버리지 */}
      <div style={{ padding:"8px 16px", borderBottom:`1px solid ${theme.border}`, flexShrink:0 }}>
        <button
          onClick={() => setSettingsOpen(v => !v)}
          style={{
            width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
            background:"transparent", border:"none", cursor:"pointer", padding:0,
            marginBottom: settingsOpen ? "8px" : 0,
          }}
        >
          <span style={{ fontSize:"12px", color:theme.textMuted }}>설정</span>
          <span style={{ fontSize:"10px", color:theme.textFaint }}>{settingsOpen ? "▲" : "▼"}</span>
        </button>
        {settingsOpen && <><Slider label="리스크 %" value={riskPct} min={0.5} max={3} step={0.1}
          onChange={setRiskPct} format={v => `${v}%`}
          color={riskPct<=1?"#0ecb81":riskPct<=2?"#f0b90b":"#f6465d"} />
        <div style={{ height:"8px" }} />
        <Slider label="레버리지"
          value={pendingLeverage ?? leverage}
          min={leverageMin} max={50} step={1}
          onChange={handleLeverageChange} format={v => `${v}x`}
          color={leverage<=10?"#0ecb81":leverage<=20?"#f0b90b":"#f6465d"} />
        {hasPos && posLeverage !== null && !pendingLeverage && (
          <div style={{ fontSize:10, color:theme.textFaint, marginTop:3, textAlign:"right" }}>
            포지션 보유 중 — {posLeverage}x 미만 불가
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


        {drawing ? (
          <PlanCard
            drawing={drawing} posCalc={posCalc} leverage={leverage} riskPct={riskPct}
            position={position} hasPending={hasPending}
            onConfirm={executeOrder} onCancel={onCancelOrder}
          />
        ) : hasPending ? (
          <OrphanPendingCard pending={position?.pending} onCancel={onCancelOrder} />
        ) : null}


      </div>
    </div>
  );
}
