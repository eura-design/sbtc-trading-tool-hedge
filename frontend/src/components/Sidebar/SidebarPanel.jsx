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
import { Divider }   from "../Divider";
import { StatusAlert }                from "../StatusAlert";
import { ConfirmModal }               from "../ConfirmModal";
import { BalanceCard }                from "./BalanceCard";
import { MarketInfoCard }            from "./MarketInfoCard";
import { PositionCard, PendingCard }  from "./PositionCard";
import { PlanCard, OrphanPendingCard } from "./PlanCard";
import { ScaleInCard }  from "./ScaleInCard";
import { SplitTPCard }  from "./SplitTPCard";
import { StatsCard }    from "./StatsCard";

function SectionTitle({ children }) {
  const { theme } = useTheme();
  return (
    <div style={{ fontSize:"10px", color:theme.textBare, fontWeight:"600",
      letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:"10px" }}>
      {children}
    </div>
  );
}

export function SidebarPanel({ lastPrice, openConfirm, onCancelOrder, onClosePosition, onSwapPosition,
  onScaleIn, onCancelScaleIn, onAddSplitTp, onCancelSplitTp }) {
  const { theme } = useTheme();
  const online = useHealth();
  const dailyLoss = useDailyLoss();

  const {
    balance, balError, _refetchBal,
    position, tpsl, tpslSaving,
    riskPct, setRiskPct, leverage, setLeverage,
    drawing, orderStatus, setOrderStatus,
    liveClose,
    confirmInfo, setConfirmInfo, executeOrder,
  } = useStore(useShallow(s => ({
    balance: s.balance, balError: s.balError, _refetchBal: s._refetchBal,
    position: s.position, tpsl: s.tpsl, tpslSaving: s.tpslSaving,
    riskPct: s.riskPct, setRiskPct: s.setRiskPct,
    leverage: s.leverage, setLeverage: s.setLeverage,
    drawing: s.drawing, orderStatus: s.orderStatus, setOrderStatus: s.setOrderStatus,
    liveClose: s.liveClose, confirmInfo: s.confirmInfo,
    setConfirmInfo: s.setConfirmInfo, executeOrder: s.executeOrder,
  })));

  const hasPos     = position?.open === true;
  const hasPending = !!position?.pending;
  const locked     = hasPos || hasPending;
  const effectiveLastPrice = liveClose ?? lastPrice;

  const posLeverage = position?.leverage ?? null;
  const leverageMin = hasPos ? (posLeverage ?? leverage) : 1;

  const [pendingLeverage, setPendingLeverage] = useState(null);
  const [leverageLoading, setLeverageLoading] = useState(false);
  const [leverageErr, setLeverageErr]         = useState(null);

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

      {/* 스크롤 컨텐츠 */}
      <div style={{ flex:1, overflowY:"auto", padding:"12px 16px" }}>

        <StatusAlert status={orderStatus} onClose={() => setOrderStatus(null)} />

        {/* 포지션 / 플랜 */}
        <PositionCard position={position} tpsl={tpsl} tpslSaving={tpslSaving} onClose={onClosePosition} onSwap={onSwapPosition} lastPrice={effectiveLastPrice} />
        {hasPos && <ScaleInCard position={position} lastPrice={effectiveLastPrice} onScaleIn={onScaleIn}
          scaleInOrders={position?.scaleInOrders} onCancelScaleIn={onCancelScaleIn} />}
        {hasPos && <SplitTPCard position={position} tpsl={tpsl} lastPrice={effectiveLastPrice}
          onAddSplitTp={onAddSplitTp} onCancelSplitTp={onCancelSplitTp} />}
        {!hasPos && <PendingCard pending={position?.pending} />}

        {confirmInfo ? (
          <ConfirmModal
            info={confirmInfo}
            onConfirm={executeOrder}
            onCancel={() => setConfirmInfo(null)}
          />
        ) : drawing ? (
          <PlanCard
            drawing={drawing} posCalc={posCalc} leverage={leverage} riskPct={riskPct}
            locked={locked} hasPos={hasPos} hasPending={hasPending}
            onConfirm={openConfirm} onCancel={onCancelOrder}
          />
        ) : hasPending ? (
          <OrphanPendingCard pending={position?.pending} onCancel={onCancelOrder} />
        ) : null}

        <Divider />

        {/* 주문 설정 */}
        <SectionTitle>설정</SectionTitle>
        <div style={{ marginBottom:"6px" }}>
          <Slider label="리스크 %" value={riskPct} min={0.5} max={3} step={0.1}
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
          )}
        </div>

        <Divider />

        {/* 일일 손실 한도 */}
        {dailyLoss && <>
          <SectionTitle>일일 손실 한도</SectionTitle>
          {(() => {
            const isExceeded = dailyLoss.remaining <= 0;
            return (
              <div style={{
                padding:"6px 10px", borderRadius:5,
                background: isExceeded ? theme.bgError : "transparent",
                border: isExceeded ? "1px solid #f6465d44" : "none",
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:11, color:theme.textMuted }}>
                    오늘 {dailyLoss.todayPnl >= 0 ? "+" : ""}{dailyLoss.todayPnl.toFixed(2)}
                  </span>
                  <span style={{ fontSize:11, color: isExceeded ? "#f6465d" : "#94a3b8", fontWeight:600 }}>
                    {isExceeded
                      ? `한도 초과 · 리셋 ${(() => {
                          const now = new Date();
                          const reset = new Date(now);
                          reset.setUTCDate(reset.getUTCDate() + 1);
                          reset.setUTCHours(0, 0, 0, 0);
                          const diff = reset - now;
                          const h = Math.floor(diff / 3600000);
                          const m = Math.floor((diff % 3600000) / 60000);
                          return `${h}h ${m}m`;
                        })()}`
                      : `잔여 ${dailyLoss.remaining.toFixed(1)}`}
                  </span>
                </div>
              </div>
            );
          })()}
        </>}

        <Divider />

        {/* 거래 통계 */}
        <SectionTitle>거래 통계</SectionTitle>
        <StatsCard />

      </div>
    </div>
  );
}
