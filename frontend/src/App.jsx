import { useState, useEffect, useRef, useMemo } from "react";

import { useTheme }  from "./ThemeContext";
import { useStore }  from "./store";
import { INTERVALS } from "./constants";

import { useCandles }                from "./hooks/useCandles";
import { useBalance }                from "./hooks/useBalance";
import { usePosition }               from "./hooks/usePosition";
import { useTpsl }                   from "./hooks/useTpsl";
import { useRSI }                    from "./hooks/useRSI";
import { useSRLevels }               from "./hooks/useSRLevels";
import { useTrendLines }             from "./hooks/useTrendLines";
import { useStructures }             from "./hooks/useStructures";
import { useOrderFlow }              from "./hooks/useOrderFlow";
import { useFVG }                    from "./hooks/useFVG";
import { useOrderBlock }             from "./hooks/useOrderBlock";
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

  // ── 지표 파라미터 ─────────────────────────────────────────────────────────
  // showStruct가 struct.tfs를 봐야 해서 지표 표시 여부보다 먼저 로드한다.
  const { params: indicatorParams, setParam: setIndicatorParam, setEmaList, resetIndicator } = useIndicatorParams();

  // ── 지표 표시 여부 ────────────────────────────────────────────────────────
  const showRsi = indicators.rsi !== false;
  const showSR  = indicators.sr  !== false;
  const showOB  = indicators.ob  !== false;
  const showFVG = indicators.fvg !== false;
  const showVol = indicators.vol !== false;
  const showEMA = indicators.ema !== false;
  const showZZ  = indicators.zz  !== false;
  // 수동 구조 — 자동 ZZ와 독립 토글 + 표시 타임프레임 필터(struct.tfs, 중복 선택 / 기본 1h).
  // 데이터는 여전히 전 TF 공유이고 "어느 TF에서 보여줄지"만 거르는 것이다.
  //  - structOn   : 지표 토글 자체. **그리기 가능 여부는 이것만 본다** —
  //                 TF 필터까지 묶으면 지표를 켜 뒀는데도 구조 버튼이 죽어 있어 고장으로 보인다
  //  - showStruct : 현재 TF에서 실제로 그려지는지 (렌더 + 히트 판정)
  const structOn   = indicators.struct !== false;
  const structTfs  = indicatorParams.struct?.tfs ?? [];
  const showStruct = structOn && structTfs.includes(interval_);

  // 표시 대상이 아닌 TF에서 구조 모드로 들어가면 그 TF를 표시 목록에 자동 추가한다.
  // (안 그러면 방금 그린 게 화면에 안 나온다 — 그리려 한 시점이 곧 "여기서도 보고 싶다"는 뜻)
  const ensureStructTf = () => {
    if (structTfs.includes(interval_)) return;
    const next = [...structTfs, interval_];
    setIndicatorParam("struct", "tfs", INTERVALS.filter(i => next.includes(i.value)).map(i => i.value));
  };

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

  // ── 수동 구조 (지그재그 + 자동 CHoCH) ─────────────────────────────────────
  const structs = useStructures();

  // 그리는 도중/선택한 채로 Custom Structure Zigzag를 끄거나(지표 토글),
  // 표시 대상이 아닌 TF로 넘어가면 편집 상태를 정리한다.
  // 안 그러면 안 보이는 draft가 남아 있다가 다시 켤 때 그리던 중간부터 튀어나온다.
  useEffect(() => {
    if (showStruct) return;
    structs.cancelStructDraw();
    structs.setSelectedStructId(null);
  }, [showStruct]); // eslint-disable-line react-hooks/exhaustive-deps

  const { toasts, addToast, addLineAlert, removeToast } = useToast();
  const { settings: notifSettings, toggle: notifToggle } = useNotificationSettings();
  useAlertMonitor(notifSettings, addToast, indicatorParams.rsi);

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
  // ZZ(Structure Zigzag)는 진행 중 봉까지 반영해야 하므로 candleRenderer가 candlesRef로 직접 계산 — 여기서 계산하지 않음
  const { srLevels, srLoading, refreshSR } = useSRLevels();

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
    structure: {
      id: structs.selectedStructId, items: structs.structures,
      setSelectedId: structs.setSelectedStructId,
      // Delete 키 → 꼭짓점/선분이 선택돼 있으면 그것만, 아니면 구조 전체 삭제
      delete:        structs.deleteStructSelection,
      toggleAlert:   () => {},   // 구조는 근접 알림 대상이 아님 (chart/drawables.js 주석 참고)
      toggleLock:    structs.toggleStructLock,
      setOpacity:    structs.setStructOpacity,
    },
  }), [
    trendLines.selectedLineId, trendLines.lines, trendLines.setSelectedLineId,
    trendLines.deleteLine, trendLines.toggleLineAlert, trendLines.toggleLineLock, trendLines.setLineOpacity,
    trendLines.selectedChannelId, trendLines.channels, trendLines.setSelectedChannelId,
    trendLines.deleteChannel, trendLines.toggleChannelAlert, trendLines.toggleChannelLock, trendLines.setChannelOpacity,
    trendLines.selectedCircleId, trendLines.circles, trendLines.setSelectedCircleId,
    trendLines.deleteCircle, trendLines.toggleCircleAlert, trendLines.toggleCircleLock, trendLines.setCircleOpacity,
    structs.selectedStructId, structs.structures, structs.setSelectedStructId,
    structs.deleteStructSelection, structs.toggleStructLock, structs.setStructOpacity,
  ]);

  // ── 키보드 단축키 ─────────────────────────────────────────────────────────
  useKeyboardShortcuts({
    shortcuts,
    setDrawMode,
    setCurrent,
    cancelDraw:        trendLines.cancelDraw,
    cancelChannelDraw: trendLines.cancelChannelDraw,
    cancelCircleDraw:  trendLines.cancelCircleDraw,
    cancelStructDraw:  structs.cancelStructDraw,
    setStructMode:     structs.setStructMode,
    structEnabled:     structOn,
    structMode:        structs.structMode,
    ensureStructTf,
    drawables,
    setSelectedBox,
    drawing, hasPending, locked: drawLocked, selectedBox,
    deleteBox,
    interval_,
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
            setDrawMode(false); trendLines.cancelChannelDraw(); trendLines.cancelCircleDraw(); structs.cancelStructDraw();
            trendLines.setLineMode(m => { if (m) trendLines.cancelDraw(); return !m; });
          }}
          channelMode={trendLines.channelMode} onChannelModeToggle={() => {
            setDrawMode(false); trendLines.cancelDraw(); trendLines.cancelCircleDraw(); structs.cancelStructDraw();
            trendLines.setChannelMode(m => { if (m) trendLines.cancelChannelDraw(); return !m; });
          }}
          circleMode={trendLines.circleMode} onCircleModeToggle={() => {
            setDrawMode(false); trendLines.cancelDraw(); trendLines.cancelChannelDraw(); structs.cancelStructDraw();
            trendLines.setCircleMode(m => { if (m) trendLines.cancelCircleDraw(); return !m; });
          }}
          structMode={structs.structMode} structEnabled={structOn} onStructModeToggle={() => {
            if (!structOn) return;   // 지표 OFF면 그려도 안 보이므로 진입 차단
            if (!structs.structMode) ensureStructTf();   // 진입할 때만 — 나갈 때 추가하면 엉뚱하다
            setDrawMode(false);
            trendLines.cancelDraw(); trendLines.cancelChannelDraw(); trendLines.cancelCircleDraw();
            structs.setStructMode(m => { if (m) structs.cancelStructDraw(); return !m; });
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
          showRsi={showRsi} showSR={showSR} showOB={showOB} showFVG={showFVG}
          showVol={showVol} showEMA={showEMA}
          showZZ={showZZ} showStruct={showStruct}
          indicatorParams={indicatorParams}
          current={current} setCurrent={setCurrent}
          actionsRef={chartActionsRef}
          drawables={drawables}
          {...trendLines}
          {...structs}
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
            structs.cancelStructDraw();
            setDrawMode(m => !m);
          }}
        />
      </div>

      <Toast toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
