import { useState, useEffect, useRef, useMemo } from "react";

import { useTheme }  from "./ThemeContext";
import { useStore }  from "./store";

import { useCandles }                from "./hooks/useCandles";
import { useBalance }                from "./hooks/useBalance";
import { usePosition }               from "./hooks/usePosition";
import { useTpsl }                   from "./hooks/useTpsl";
import { useRSI }                    from "./hooks/useRSI";
import { useSRLevels }               from "./hooks/useSRLevels";
import { useTrendLines }             from "./hooks/useTrendLines";
import { useOrderFlow }              from "./hooks/useOrderFlow";
import { useFVG }                    from "./hooks/useFVG";
import { useOrderBlock }             from "./hooks/useOrderBlock";
import { useMarketStructure }        from "./hooks/useMarketStructure";
import { useRealtimeData }           from "./hooks/useRealtimeData";
import { useToast }                  from "./hooks/useToast";
import { useTrendLineAlert }         from "./hooks/useTrendLineAlert";
import { usePositionCloseAlert }     from "./hooks/usePositionCloseAlert";
import { useNotificationSettings }   from "./hooks/useNotificationSettings";
import { useAlertMonitor }           from "./hooks/useAlertMonitor";
import { useIndicatorParams }        from "./hooks/useIndicatorParams";
import { useEMA }                    from "./hooks/useEMA";
import { useKeyboardShortcuts }      from "./hooks/useKeyboardShortcuts";
import { useShortcutSettings }      from "./hooks/useShortcutSettings";
import { derivePositionFlags }      from "./hooks/usePositionFlags";
import { TopBar }       from "./components/TopBar";
import { SidebarPanel } from "./components/Sidebar/SidebarPanel";
import { ChartArea }    from "./components/ChartArea";
import { Toast }        from "./components/Toast";

export default function App() {
  // ── 스토어 ────────────────────────────────────────────────────────────────
  const {
    interval_, setInterval_,
    indicators, toggleIndicator,
    setDrawMode,
    drawing, setDrawing,
    criticalAlert, setCriticalAlert,
    selectedBox, setSelectedBox,
    position,
  } = useStore();

  const {
    hasLong, hasShort, hasPos, hasBoth,
    longPendingExists, shortPendingExists, hasPending, drawLocked,
  } = derivePositionFlags(position);

  // ── 폴링 / 실시간 ────────────────────────────────────────────────────────
  useBalance();
  usePosition();
  useTpsl();
  useRealtimeData();

  // ── 지표 표시 여부 ────────────────────────────────────────────────────────
  const showRsi = indicators.rsi !== false;
  const showSR  = indicators.sr  !== false;
  const showOB  = indicators.ob  !== false;
  const showFVG = indicators.fvg !== false;
  const showDiv = indicators.div !== false;
  const showVol = indicators.vol !== false;
  const showEMA = indicators.ema !== false;
  const showMS  = indicators.ms  !== false;

  // ── drawing ↔ pending order 동기화 ────────────────────────────────────────
  useEffect(() => {
    if (!position) return;
    // 헷지모드: 같은 사이드 포지션이 열렸을 때만 drawing 제거 (MARKET 진입)
    if (drawing && !drawing.orderId) {
      if (drawing.isLong  && position.long)  { setDrawing(null); return; }
      if (!drawing.isLong && position.short) { setDrawing(null); return; }
    }
    // drawing이 주문과 연결됐는데 해당 사이드 pending이 사라진 경우 → drawing 제거
    if (drawing?.orderId) {
      const matchPending = drawing.isLong ? position.pending?.long : position.pending?.short;
      if (!matchPending) { setDrawing(null); return; }
    }
    // drawing 없고 pending 있으면 → 저장된 drawing으로 복원 (LONG 우선)
    if (!drawing) {
      const lp = position.pending?.long;
      const sp = position.pending?.short;
      const pd = lp?.drawing ? lp : sp?.drawing ? sp : null;
      if (pd) {
        const d = { ...pd.drawing };
        if (!d.tStart) { d.tStart = 0; d.tEnd = 0; }
        d.orderId = String(pd.orderId);
        setDrawing(d);
      }
    }
  }, [position, hasPos, hasPending, drawing, setDrawing]);

  useEffect(() => { if (!drawing) setSelectedBox(false); }, [drawing, setSelectedBox]);

  // ── 로컬 상태 ────────────────────────────────────────────────────────────
  const [isLog, setIsLog] = useState(() => localStorage.getItem("chart_isLog") === "true");
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("sidebar_open") !== "false");
  const [current, setCurrent] = useState(null); // 박스 그리기 중 드래그 사각형

  // ChartArea에서 resetDomain을 노출받는 ref
  const chartActionsRef = useRef(null);

  // ── 트렌드 라인 ───────────────────────────────────────────────────────────
  const trendLines = useTrendLines();

  const { toasts, addToast, addLineAlert } = useToast();
  const { settings: notifSettings, toggle: notifToggle } = useNotificationSettings();
  const { params: indicatorParams, setParam: setIndicatorParam, setEmaList, resetIndicator } = useIndicatorParams();
  const { divsByTF } = useAlertMonitor(notifSettings, addToast, indicatorParams.div, indicatorParams.rsi);

  // ── 캔들 데이터 ───────────────────────────────────────────────────────────
  const onTickRef = useRef(null);
  const { candles, candlesRef, loading: candleLoading } = useCandles(interval_, onTickRef);

  // ── 포지션 진입 스크린샷 ─────────────────────────────────────────────────

  useTrendLineAlert(
    trendLines.lines,    candles, addLineAlert, trendLines.setLineAlertOff,
    trendLines.channels, trendLines.setChannelAlertOff,
    trendLines.circles,  trendLines.setCircleAlertOff,
    isLog,
  );
  usePositionCloseAlert(position, addLineAlert);

  // ── 보조지표 계산 ─────────────────────────────────────────────────────────
  const rsiData = useRSI(candles, indicatorParams.rsi);
  const emaData = useEMA(candles, indicatorParams.ema);
  const fvgData = useFVG(candles, indicatorParams.fvg);
  const obData  = useOrderBlock(candles, indicatorParams.ob);
  const msData  = useMarketStructure(candles, indicatorParams.ms);
  const { srLevels, srLoading, refreshSR } = useSRLevels();

  // divsByTF → 메인 차트 캔들 인덱스로 변환
  const divData = useMemo(() => {
    const tfDivs = divsByTF[interval_] ?? [];
    if (!tfDivs.length || !candles.length) return [];
    const tMap = new Map(candles.map((c, i) => [+c.t, i]));
    return tfDivs.map(d => {
      const i1 = tMap.get(+d.t1), i2 = tMap.get(+d.t2);
      if (i1 == null || i2 == null) return null;
      return { type: d.type, dir: d.dir, i1, r1: d.r1, i2, r2: d.r2 };
    }).filter(Boolean);
  }, [divsByTF, interval_, candles]);

  // ── 주문 액션 ─────────────────────────────────────────────────────────────
  const { deleteBox, closePosition, scaleIn, cancelScaleIn, addSplitTp, cancelSplitTp } = useOrderFlow();

  // ── 단축키 설정 ─────────────────────────────────────────────────────────
  const { shortcuts, updateShortcut, resetShortcuts } = useShortcutSettings();

  // ── 도형 통합 인터페이스 (chart/drawables.js) ──────────────────────────
  const drawables = useMemo(() => ({
    line: {
      id: trendLines.selectedLineId, items: trendLines.lines,
      setSelectedId: trendLines.setSelectedLineId,
      delete:        trendLines.deleteLine,
      toggleAlert:   trendLines.toggleLineAlert,
      toggleLock:    trendLines.toggleLineLock,
      setOpacity:    trendLines.setLineOpacity,
    },
    channel: {
      id: trendLines.selectedChannelId, items: trendLines.channels,
      setSelectedId: trendLines.setSelectedChannelId,
      delete:        trendLines.deleteChannel,
      toggleAlert:   trendLines.toggleChannelAlert,
      toggleLock:    trendLines.toggleChannelLock,
      setOpacity:    trendLines.setChannelOpacity,
    },
    circle: {
      id: trendLines.selectedCircleId, items: trendLines.circles,
      setSelectedId: trendLines.setSelectedCircleId,
      delete:        trendLines.deleteCircle,
      toggleAlert:   trendLines.toggleCircleAlert,
      toggleLock:    trendLines.toggleCircleLock,
      setOpacity:    trendLines.setCircleOpacity,
    },
  }), [
    trendLines.selectedLineId, trendLines.lines, trendLines.setSelectedLineId,
    trendLines.deleteLine, trendLines.toggleLineAlert, trendLines.toggleLineLock, trendLines.setLineOpacity,
    trendLines.selectedChannelId, trendLines.channels, trendLines.setSelectedChannelId,
    trendLines.deleteChannel, trendLines.toggleChannelAlert, trendLines.toggleChannelLock, trendLines.setChannelOpacity,
    trendLines.selectedCircleId, trendLines.circles, trendLines.setSelectedCircleId,
    trendLines.deleteCircle, trendLines.toggleCircleAlert, trendLines.toggleCircleLock, trendLines.setCircleOpacity,
  ]);

  // ── 키보드 단축키 ─────────────────────────────────────────────────────────
  useKeyboardShortcuts({
    shortcuts,
    setDrawMode,
    setCurrent,
    cancelDraw:        trendLines.cancelDraw,
    cancelChannelDraw: trendLines.cancelChannelDraw,
    cancelCircleDraw:  trendLines.cancelCircleDraw,
    drawables,
    setSelectedBox,
    drawing, hasPending, locked: drawLocked, selectedBox,
    deleteBox,
    onIntervalChange:  val => { if (val === interval_) return; setInterval_(val); chartActionsRef.current?.resetDomain(); },
  });

  const { theme, isDark, toggle: toggleTheme } = useTheme();
  const last = candles[candles.length - 1];

  return (
    <div style={{
      display: "flex", width: "100%", height: "100vh",
      background: theme.bgMain, overflow: "hidden",
      fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace",
      color: theme.textPrimary,
    }}>

      {/* ── 차트 영역 ── */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden" }}>

        <TopBar
          interval_={interval_} onIntervalChange={val => { if (val === interval_) return; setInterval_(val); chartActionsRef.current?.resetDomain(); }}
          lineMode={trendLines.lineMode} onLineModeToggle={() => {
            setDrawMode(false); trendLines.cancelChannelDraw(); trendLines.cancelCircleDraw();
            trendLines.setLineMode(m => { if (m) trendLines.cancelDraw(); return !m; });
          }}
          channelMode={trendLines.channelMode} onChannelModeToggle={() => {
            setDrawMode(false); trendLines.cancelDraw(); trendLines.cancelCircleDraw();
            trendLines.setChannelMode(m => { if (m) trendLines.cancelChannelDraw(); return !m; });
          }}
          circleMode={trendLines.circleMode} onCircleModeToggle={() => {
            setDrawMode(false); trendLines.cancelDraw(); trendLines.cancelChannelDraw();
            trendLines.setCircleMode(m => { if (m) trendLines.cancelCircleDraw(); return !m; });
          }}
          isDark={isDark} onThemeToggle={toggleTheme}
          last={last} candleLoading={candleLoading}
          indicators={indicators} onIndicatorToggle={toggleIndicator}
          indicatorParams={indicatorParams} setIndicatorParam={setIndicatorParam}
          setEmaList={setEmaList} resetIndicator={resetIndicator}
          srLoading={srLoading} refreshSR={refreshSR}
          notifSettings={notifSettings} onNotifToggle={notifToggle}
          isLog={isLog} onLogToggle={() => setIsLog(v => {
            const next = !v; localStorage.setItem("chart_isLog", next); return next;
          })}
          shortcuts={shortcuts} onShortcutUpdate={updateShortcut} onShortcutReset={resetShortcuts}
        />

        {criticalAlert && (
          <div onClick={() => setCriticalAlert(null)} style={{
            padding: "8px 16px", background: "#7f0000", borderBottom: "2px solid #ff0000",
            fontSize: "13px", color: "#fff", fontWeight: "700", cursor: "pointer",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>🚨 {criticalAlert}</span>
            <span style={{ opacity: 0.7, fontSize: "11px" }}>클릭하여 닫기</span>
          </div>
        )}

        <ChartArea
          candles={candles} candlesRef={candlesRef} candleLoading={candleLoading}
          onTickRef={onTickRef} interval_={interval_} isDark={isDark} isLog={isLog}
          rsiData={rsiData} emaData={emaData} fvgData={fvgData} obData={obData} srData={srLevels}
          msData={msData}
          showRsi={showRsi} showSR={showSR} showOB={showOB} showFVG={showFVG}
          showVol={showVol} showEMA={showEMA} showDiv={showDiv}
          showMS={showMS}
          indicatorParams={indicatorParams}
          divData={divData}
          current={current} setCurrent={setCurrent}
          actionsRef={chartActionsRef}
          drawables={drawables}
          {...trendLines}
        />
      </div>

      {/* ── 사이드바 토글 ── */}
      <div
        onClick={() => setSidebarOpen(v => { const next = !v; localStorage.setItem("sidebar_open", next); return next; })}
        style={{
          width: "20px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", background: theme.bgMain,
          borderLeft: `1px solid ${theme.border}`, borderRight: `1px solid ${theme.border}`,
          color: theme.textFaint, fontSize: "9px", userSelect: "none",
          transition: "background 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = theme.borderSec}
        onMouseLeave={e => e.currentTarget.style.background = theme.bgMain}
        title={sidebarOpen ? "사이드바 닫기" : "사이드바 열기"}
      >
        {sidebarOpen ? "▶" : "◀"}
      </div>

      {/* ── 사이드바 ── */}
      <div style={{ width: sidebarOpen ? "272px" : "0px", overflow: "hidden", flexShrink: 0, transition: "width 0.2s ease" }}>
        <SidebarPanel
          lastPrice={last?.c}
          onCancelOrder={deleteBox}
          onClosePosition={closePosition}
          onScaleIn={scaleIn}
          onCancelScaleIn={cancelScaleIn}
          onAddSplitTp={addSplitTp}
          onCancelSplitTp={cancelSplitTp}
          onDrawModeToggle={() => {
            trendLines.cancelDraw(); trendLines.cancelChannelDraw(); trendLines.cancelCircleDraw();
            setDrawMode(m => !m);
          }}
        />
      </div>

      <Toast toasts={toasts} />
    </div>
  );
}
