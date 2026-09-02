import { useState, useEffect, useRef, useMemo } from "react";

import { useTheme }  from "./ThemeContext";
import { useStore }  from "./store";
import { SESSION_MAX_MS } from "./store/replaySlice";
import { INTERVALS } from "./constants";
import { ZZ_ID }         from "./chart/drawables";
import { installStructDebug } from "./chart/structDebug";
import { installLegDebug }    from "./chart/legDebug";

import { useCandles }                from "./hooks/useCandles";
import { useReplay }                 from "./hooks/useReplay";
import { useBalance }                from "./hooks/useBalance";
import { usePosition }               from "./hooks/usePosition";
import { useTpsl }                   from "./hooks/useTpsl";
import { useRSI }                    from "./hooks/useRSI";
import { usePivotLevels }            from "./hooks/usePivotLevels";
import { useTrendLines }             from "./hooks/useTrendLines";
import { useFibs }                   from "./hooks/useFibs";
import { useMeasures }               from "./hooks/useMeasures";
import { useStructures }             from "./hooks/useStructures";
import { useOrderFlow }              from "./hooks/useOrderFlow";
import { useFVG }                    from "./hooks/useFVG";
import { useOrderBlock }             from "./hooks/useOrderBlock";
import { useRealtimeData }           from "./hooks/useRealtimeData";
import { useToast }                  from "./hooks/useToast";
import { useTrendLineAlert }         from "./hooks/useTrendLineAlert";
import { useChochAlert }             from "./hooks/useChochAlert";
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
import { ReplayBar }    from "./components/ReplayBar";
import { Toast }        from "./components/Toast";
import { lsGet, lsSet } from "./utils/storage";

// 지표를 껐을 때 넘기는 빈 TF 목록 — 매 렌더 새 배열을 만들지 않으려고 모듈 상수로 둔다
const EMPTY_TFS = [];

export default function App() {
  // ── 스토어 ────────────────────────────────────────────────────────────────
  const {
    interval_, setInterval_,
    indicators, toggleIndicator,
    setDrawMode, setOrderPick,
    drawings, setDrawing, clearDrawings,
    criticalAlerts, dismissCriticalAlert,
    selectedBox, setSelectedBox,
    position,
    // ── 리플레이 ──
    // replayOn 하나가 "지금 화면은 과거다"의 기준이다 — 캔들 소스·지표 미래 차단·
    // 알림 차단이 전부 이 값을 본다 (store/replaySlice.js)
    replayOn, setReplayOn,
    replayStartMs, replayEndMs, setReplayRange,
    replayNowMs, setReplayClock,
  } = useStore();

  // 도형 저장소 선택 — 리플레이 중에는 연습용 키(`replay_*`)를 쓴다 (replay/drawingKeys.js).
  // ※ "기존 도형 보기"는 2026-08-15 사용자 요청으로 제거됐다 — 리플레이에서 실거래 도형은 안 보인다
  // gen — 🎲로 연습 도형을 통째로 지웠을 때 증가한다. 키는 그대로라
  // 이게 없으면 지운 도형이 React 상태에 남아 다음 저장에 되살아난다
  const [drawingGen, setDrawingGen] = useState(0);
  const drawingMode = useMemo(
    () => ({ replayOn, gen: drawingGen }),
    [replayOn, drawingGen],
  );

  const {
    hasLong, hasShort, hasPos, hasBoth,
    longPendingExists, shortPendingExists, hasPending, drawLocked,
  } = derivePositionFlags(position);

  // ── 토스트 ────────────────────────────────────────────────────────────────
  // ⚠ **토스트는 한 종류뿐이다** (2026-08-25 사용자 지정) — 알림 종류별로 다른 함수를
  //   쓰지 않는다. RSI·봉마감·CHoCH·근접·포지션 종료·백엔드 notice가 전부 `addToast`다
  // ⚠ 여기가 **useRealtimeData보다 위여야 한다**. 백엔드 경보 중 급하지 않은 것을
  //   토스트로 내려보내는데, 그 콜백을 useRealtimeData가 인자로 받는다.
  //   아래로 내리면 undefined가 넘어가고 **그 경보들이 아무 데도 안 뜬다**(에러도 안 난다)
  const { toasts, addToast, removeToast } = useToast();

  // ── 폴링 / 실시간 ────────────────────────────────────────────────────────
  // 리플레이 중에는 실계좌를 읽지 않는다 — 폴링이 돌면 페이퍼 잔고·포지션을
  // 실계좌 값으로 덮어써서, 연습 중이던 포지션이 몇 초마다 화면에서 사라진다.
  // (주문 전송 차단은 별개로 api/client.js가 맡는다)
  useBalance(!replayOn);
  usePosition(!replayOn);
  useTpsl(!replayOn);
  useRealtimeData(addToast);

  // ── 지표 파라미터 ─────────────────────────────────────────────────────────
  // showStruct가 struct.tfs를 봐야 해서 지표 표시 여부보다 먼저 로드한다.
  const { params: indicatorParams, setParam: setIndicatorParam, setEmaList, resetIndicator } = useIndicatorParams();

  // ── 지표 표시 여부 ────────────────────────────────────────────────────────
  // RSI — 지표 토글은 **전 TF 공통**이다. RSI 패널(선)은 어느 프레임에서든 보인다.
  //
  // `rsi.tfs`(중복 선택, 기본 전체)가 거르는 건 **메인 차트의 과매수/과매도 구간 배경뿐**이다
  // (2026-08-14 사용자 확정 — 처음엔 지표 전체를 걸렀다가 정정된 요구사항).
  // 배경은 캔들 위에 깔리는 것이라 TF마다 밀도가 크게 다르지만(5m은 온통 물든다),
  // RSI 선 자체는 어느 TF에서나 보고 싶은 값이라 둘을 나눈다. 다시 합치지 말 것.
  // ⚠ 알림(useAlertMonitor)은 이 필터와 **무관**하다 — 저쪽은 TF별 WebSocket을 따로 감시하고
  //   설정도 NotificationMenu에 따로 있다. 배경을 끈 TF의 RSI 알림도 계속 울려야 한다
  const rsiTfs       = indicatorParams.rsi?.tfs ?? [];
  const showRsi      = indicators.rsi !== false;
  const showRsiZones = showRsi && rsiTfs.includes(interval_);
  // Pivot Levels — 지지/저항 지표 (구 S/R Levels(KDE) 대체). chart/pivotLevels.js 참고
  const showPivot = indicators.pivot !== false;
  const showOB  = indicators.ob  !== false;
  const showFVG = indicators.fvg !== false;
  const showVol = indicators.vol !== false;
  const showEMA = indicators.ema !== false;
  const showZZ  = indicators.zz  !== false;
  // ※ 피보나치에는 **지표 토글이 없다** (2026-08-15 사용자 요청으로 지표 행째 제거).
  //   선/채널/원과 완전히 같은 도형이라 항상 그려지고, TopBar 버튼도 항상 살아 있다.
  //   레벨 목록도 도형별이라 전역 파라미터가 없다 (chart/fib.js [F1]).
  //   ⚠ 지표 메뉴에 다시 넣지 말 것 — "지표를 켜야만 그리기 버튼이 활성화되는 게
  //     이상하다"가 없앤 이유다. 선·채널·원 어느 것도 그런 관문을 갖지 않는다
  // 자동 ZZ 선택 상태 — 도형처럼 클릭하면 금색으로 강조되고 투명도 조절 대상이 된다.
  // 저장하지 않는 순수 UI 상태라 App 로컬 (drawables의 "zz"가 이걸 id로 노출)
  const [zzSelected, setZzSelected] = useState(false);
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

  // ── drawings ↔ pending order 동기화 ───────────────────────────────────────
  // ⚠ **사이드마다 완전히 독립이다** (2026-08-19). 예전엔 박스가 하나뿐이라 하나만
  //   보고 return했는데, 지금 그렇게 하면 롱을 정리하는 턴에 숏이 통째로 건너뛰어진다.
  //   그래서 return이 아니라 두 사이드를 다 훑는다
  useEffect(() => {
    if (!position) return;
    for (const isLong of [true, false]) {
      const key   = isLong ? "long" : "short";
      const box   = drawings[key];
      const pend  = position.pending?.[key];

      // ⚠ **"같은 사이드 포지션이 있으면 박스를 지운다"는 규칙은 여기 없다** (2026-08-19).
      //   막는 것 자체는 사용자가 원하는 게 맞지만, **지우는 방식이 틀렸다**:
      //   박스가 그려진 뒤 조용히 증발해서 왜 사라졌는지 알 수 없었다
      //   (숏 포지션 보유 중 숏 박스를 그리면 그리는 순간 사라져 고장으로 보였다 — 실측).
      //   → 지금은 `dragStateMachine.js`의 `draw.onUp`이 **그리는 순간 되돌리고
      //     이유를 배너로 띄운다.** 여기로 되돌리지 말 것 (증상이 그대로 재발한다)
      //   ※ MARKET 진입 후 정리는 `executeOrder`가 직접 한다(`setDrawing(isLong, null)`),
      //     지정가는 아래 orderId 규칙이 받는다 — 이 규칙이 없어도 둘 다 정리된다
      //   ※ PlanCard의 `sameSidePos` 분기(`포지션이 이미 있습니다 / 청산 후 주문 가능`)는
      //     아직 살아 있다 — 박스를 그려 둔 **뒤에** 그 사이드 포지션이 생기는 경로
      //     (외부 진입·추가 진입 등)가 남아 있어서, 그리기 가드만으로는 못 덮는다
      // 주문과 연결됐는데 그 사이드 pending이 사라졌다 → 박스도 정리
      if (box?.orderId && !pend)       { setDrawing(isLong, null); continue; }
      // 박스는 없는데 pending이 살아 있다 → 서버가 들고 있던 박스로 복원
      if (!box && pend?.drawing) {
        const d = { ...pend.drawing };
        if (!d.tStart) { d.tStart = 0; d.tEnd = 0; }
        d.orderId = String(pend.orderId);
        // ⚠ 슬롯과 박스의 사이드가 어긋나면 안 된다 — 서버 값이 이상하면 버린다
        if (!!d.isLong === isLong) setDrawing(isLong, d);
      }
    }
  }, [position, hasPos, hasPending, drawings, setDrawing]);

  // 선택했던 박스가 사라지면 선택도 푼다 (선택은 `"long"`|`"short"`|null)
  useEffect(() => {
    if (selectedBox && !drawings[selectedBox]) setSelectedBox(null);
  }, [drawings, selectedBox, setSelectedBox]);

  // 콘솔에서 `__structDebug()` — 수동 구조의 CHoCH 판정 근거를 표로 출력
  useEffect(() => { installStructDebug(); }, []);


  // ── 로컬 상태 ────────────────────────────────────────────────────────────
  const [isLog, setIsLog] = useState(() => lsGet("chart_isLog") === "true");
  const [sidebarOpen, setSidebarOpen] = useState(() => lsGet("sidebar_open") !== "false");
  const [current, setCurrent] = useState(null); // 박스 그리기 중 드래그 사각형

  // ChartArea에서 resetDomain을 노출받는 ref
  const chartActionsRef = useRef(null);

  // ── 트렌드 라인 ───────────────────────────────────────────────────────────
  const trendLines = useTrendLines(drawingMode);

  // ── 피보나치 되돌림 ───────────────────────────────────────────────────────
  // 지표 토글이 없으므로 "꺼지면 draft 정리" 이펙트도 없다 (선/채널/원과 같다)
  const fibTool = useFibs(drawingMode);

  // 측정 박스 — 사각형을 끌면 그 구간의 등락률·가격 차이·기간을 보여준다 (2026-08-26).
  // 선·원·피보나치와 같은 계열의 도형이라 저장·투명도·잠금·삭제가 전부 같은 경로다
  const measureTool = useMeasures(drawingMode);

  // ── 수동 구조 (지그재그 + 자동 CHoCH) ─────────────────────────────────────
  const structs = useStructures(drawingMode);

  // 그리는 도중/선택한 채로 Custom Structure Zigzag를 끄거나(지표 토글),
  // 표시 대상이 아닌 TF로 넘어가면 편집 상태를 정리한다.
  // 안 그러면 안 보이는 draft가 남아 있다가 다시 켤 때 그리던 중간부터 튀어나온다.
  useEffect(() => {
    if (showStruct) return;
    structs.cancelStructDraw();
    structs.setSelectedStructId(null);
  }, [showStruct]); // eslint-disable-line react-hooks/exhaustive-deps

  // 리플레이 진입·이탈과 "기존 도형 보기" 전환은 **도형 저장소를 통째로 갈아끼운다**.
  // 그리던 draft와 선택은 이전 저장소의 것이라, 안 지우면 없는 도형을 가리키거나
  // 연습 캔버스에 실거래에서 그리던 선이 이어져 그려진다.
  useEffect(() => {
    trendLines.cancelDraw(); trendLines.cancelChannelDraw(); trendLines.cancelCircleDraw();
    fibTool.cancelFibDraw(); measureTool.cancelMeasureDraw(); structs.cancelStructDraw();
    trendLines.setSelectedLineId(null);
    trendLines.setSelectedChannelId(null);
    trendLines.setSelectedCircleId(null);
    fibTool.setSelectedFibId(null);
    measureTool.setSelectedMeasureId(null);
    structs.setSelectedStructId(null);
  }, [replayOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const { settings: notifSettings, toggle: notifToggle } = useNotificationSettings();
  // 리플레이 중에는 끈다 — 재생 시점에서는 알 수 없는 "현재 시각의 RSI"가 울리면
  // 그 자체가 미래 정보다
  useAlertMonitor(notifSettings, addToast, indicatorParams.rsi, !replayOn);

  // ── 캔들 데이터 ───────────────────────────────────────────────────────────
  // 실거래와 리플레이는 **같은 계약**(`{ candles, candlesRef, loading }`)을 돌려주므로
  // 아래 지표·렌더는 어느 쪽이 물렸는지 모른 채 그대로 동작한다.
  // 훅은 둘 다 항상 호출하고(리액트 규칙), 꺼진 쪽이 스스로 아무것도 안 한다.
  const onTickRef = useRef(null);
  const live   = useCandles(interval_, onTickRef, !replayOn);
  const replay = useReplay({
    enabled: replayOn, tf: interval_, onTickRef,
    startMs: replayStartMs,
    // ⚠ 여기서 `?? Date.now()`로 채우지 말 것. 렌더마다 새 값이 나와 useReplay의
    //   effect deps가 매번 바뀌고, 리플레이 데이터가 무한 재로드된다.
    //   끝 시각은 리플레이에 **진입할 때 한 번** 스토어에 고정한다 (onReplayToggle)
    endMs: replayEndMs,
  });
  const { candles, candlesRef } = replayOn ? replay : live;
  const candleLoading = replayOn ? replay.loading : live.loading;

  // 리플레이 시계를 스토어로 — 지표(usePivotLevels)가 이걸 보고 미래를 자르고,
  // TopBar·사이드바가 현재가 자리에 리플레이 가격을 쓴다.
  // ⚠ liveClose까지 리플레이 값으로 덮는다. 실시간 useCandles가 꺼져 있어 충돌은 없고,
  //   이걸 안 하면 과거를 보는 중인데 헤더에 오늘 시세가 뜬다
  useEffect(() => {
    if (!replayOn) return;
    setReplayClock(replay.nowMs, replay.price);
    if (replay.price != null) useStore.getState().setLiveClose(replay.price);
  }, [replayOn, replay.nowMs, replay.price, setReplayClock]);

  // ⚠ 모드를 바꾸거나 시작 시점을 옮기면 **x 도메인을 되돌려야 한다.**
  // 캔들의 시간 범위가 통째로 바뀌는데 뷰포트가 그대로면 화면이 텅 빈다 —
  // 리플레이를 켰을 때 2024년 캔들을 다 받아 놓고도 도메인이 오늘을 가리켜
  // 빈 차트가 나왔다(실제 증상). 로드가 끝난 뒤에 불러야 캔들 기준으로 잡힌다.
  //
  // ⚠ **실제로 바뀌었을 때만 부른다.** 예전엔 candleLoading이 deps에 있다는 이유로
  //   페이지를 처음 열 때도(로딩 false로 떨어지는 순간) 한 번 돌았다. 그때는 이미
  //   ChartArea가 캔들 기준으로 도메인을 잡아 둔 뒤라, 그걸 도로 지워서 차트가
  //   납작하게 그려졌다 (useChartRenderer의 resetDomain 주석 참고).
  //   candleLoading은 "언제 부를지"를 정할 뿐 "부를지 말지"의 근거가 아니다 —
  //   TF 전환·WS 재로드로도 오르내리므로 그때마다 리셋하면 사용자의 팬/줌이 날아간다.
  const domainKeyRef = useRef(null);
  useEffect(() => {
    if (candleLoading) return;           // 로딩이 끝나면 이 이펙트가 다시 들어온다
    const key = `${replayOn ? 1 : 0}|${replayStartMs ?? ""}`;
    if (domainKeyRef.current === key) return;
    const first = domainKeyRef.current === null;
    domainKeyRef.current = key;
    if (first) return;                   // 최초 로드 — 이미 캔들 기준으로 잡혀 있다
    chartActionsRef.current?.resetDomain();
  }, [replayOn, replayStartMs, candleLoading]);

  // 콘솔에서 `__legDebug()` — 레그 hover의 거래량 비교(↑↓%)가 안 뜨는 이유를 레그별로 출력.
  // 진행 중 레그는 candlesRef(진행 중 봉 최신값)로 판정해야 화면과 값이 같다.
  const legDebugCtx = useRef(null);
  legDebugCtx.current = { structures: structs.structures, candles: candlesRef.current };
  useEffect(() => { installLegDebug(() => legDebugCtx.current); }, []);

  // ── 포지션 진입 스크린샷 ─────────────────────────────────────────────────

  useTrendLineAlert(
    trendLines.lines,    candles, addToast, trendLines.setLineAlertOff,
    trendLines.channels, trendLines.setChannelAlertOff,
    trendLines.circles,  trendLines.setCircleAlertOff,
    isLog,
    // 피보나치는 레벨 가로선 각각이 근접 대상이다.
    // 레벨은 도형마다 다르므로 훅 안에서 fibLevelsOf(fb)로 읽는다 ([F1])
    fibTool.fibs, fibTool.setFibAlertOff,
  );
  // 실계좌 포지션 종료 알림 — 리플레이 중에는 억누른다. 페이퍼 화면 위로 실거래
  // 알림이 뜨면 어느 쪽 포지션이 닫힌 건지 구분이 안 된다
  usePositionCloseAlert(replayOn ? null : position, addToast);

  // CHoCH 발생 알림 — 자동 ZZ + 수동 구조. 둘 다 기본 OFF,
  // 자동 ZZ는 indicatorParams.zz.alert_choch / 수동 구조는 구조별 alertChoch로 켠다.
  //
  // **어느 TF를 감시할지는 지표 메뉴의 `CHoCH 알림 타임프레임`이 정한다** (2026-09-02 사용자
  // 요청). RSI 알림과 같은 방식이라 **보고 있는 화면과 무관하다** — 5분 차트를 보는 중에도
  // 1시간 CHoCH가 울린다. 훅이 TF마다 캔들을 따로 받아 굴린다 (useChochAlert 참고).
  // ⚠ 그래서 여기서 `interval_`이나 표시 TF(struct.tfs)를 섞지 말 것 — 섞는 순간
  //   "화면과 무관하게"가 깨지고, 예전처럼 보고 있는 TF만 울리게 된다
  // ※ 예전엔 "sticky가 아니라 일반 토스트"라는 구분이 여기 있었다 —
  //   2026-08-25에 토스트가 한 종류로 합쳐지면서 그 구분 자체가 없어졌다.
  useChochAlert({
    structures: structs.structures,
    zzParams:   indicatorParams.zz,
    zzTfs:      showZZ && indicatorParams.zz?.alert_choch === true
                  ? (indicatorParams.zz?.alert_tfs ?? []) : EMPTY_TFS,
    structTfs:  structOn ? (indicatorParams.struct?.alert_tfs ?? []) : EMPTY_TFS,
    onAlert:    addToast,
    enabled:    !replayOn,
  });

  // ── 보조지표 계산 ─────────────────────────────────────────────────────────
  const rsiData = useRSI(candles, indicatorParams.rsi);
  const emaData = useEMA(candles, indicatorParams.ema);
  const fvgData = useFVG(candles, indicatorParams.fvg);
  const obData  = useOrderBlock(candles, indicatorParams.ob);
  // ZZ(Structure Zigzag)는 진행 중 봉까지 반영해야 하므로 candleRenderer가 candlesRef로 직접 계산 — 여기서 계산하지 않음
  // 멀티 TF — 차트 캔들이 아니라 pivot.tfs에서 고른 TF들을 직접 받아 계산한다
  // ⚠ 리플레이에서는 **반드시 시뮬 시각까지만** 계산한다. 안 그러면 2023년을 재생하는
  //   중에 오늘까지의 고/저점으로 만든 지지·저항이 그려져 연습이 무의미해진다
  const pivotLevels = usePivotLevels(indicatorParams.pivot, replayOn ? replayNowMs : null);

  // ── 주문 액션 ─────────────────────────────────────────────────────────────
  // ⚠ `addSplitTp`/`addPartialSl`은 여기로 내려보내지 않는다 (2026-08-27) —
  //   등록은 이제 **차트에서** 하고, `store/orderSlice.placeSplitOrders`가
  //   스토어 안에서 직접 부른다. 사이드바 카드에는 취소만 남았다
  const { deleteBox, closePosition, scaleIn, cancelScaleIn, cancelSplitTp,
          cancelPartialSl } = useOrderFlow();

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
    // 피보나치 — 선/채널/원과 완전히 같은 평범한 도형이다.
    // 투명도·잠금·근접 알림·삭제에 더해 **표시할 레벨도 도형별**이라
    // 전부 더블클릭 팝업에서 조작한다 (chart/fib.js [F1], 2026-08-15)
    fib: {
      id: fibTool.selectedFibId, items: fibTool.fibs,
      setSelectedId: fibTool.setSelectedFibId,
      delete:        fibTool.deleteFib,
      toggleAlert:   fibTool.toggleFibAlert,
      toggleLock:    fibTool.toggleFibLock,
      setOpacity:    fibTool.setFibOpacity,
      toggleLevel:   fibTool.toggleFibLevel,   // 표시할 레벨 체크박스 (팝업)
      resetLevels:   fibTool.resetFibLevels,   // 〃 기본값 버튼
    },
    // 측정 박스 — 선·원과 같은 평범한 도형이다 (2026-08-26).
    // ⚠ `toggleAlert`가 **없다** — 근접 알림 대상이 아니라서다. 그래서 단축키 `a`는
    //   이 도형에서 아무 일도 하지 않고, 팝업에도 🔔이 뜨지 않는다 (LineOpacityPopup).
    //   넣으려면 useTrendLineAlert에 사각형 근접 판정을 먼저 만들어야 한다
    measure: {
      id: measureTool.selectedMeasureId, items: measureTool.measures,
      setSelectedId: measureTool.setSelectedMeasureId,
      delete:        measureTool.deleteMeasure,
      toggleLock:    measureTool.toggleMeasureLock,
      setOpacity:    measureTool.setMeasureOpacity,
    },
    // 자동 ZZ — 도형이 아니라 지표지만, 선택(금색)·투명도·CHoCH 알림을 다른 도형과
    // 똑같이 조작하려고 같은 인터페이스로 감쌌다 (chart/drawables.js의 "zz" 참고).
    // 항목이 하나뿐이라 id는 상수 ZZ_ID, 삭제·잠금은 no-op.
    zz: {
      id: zzSelected ? ZZ_ID : null,
      // 필드명은 수동 구조와 맞춘다 — 팝업/단축키가 종류별 분기 없이 읽는다
      items: [{
        id: ZZ_ID,
        opacity:    indicatorParams.zz?.opacity ?? 1.0,
        // ⚠ 알림·거래량 비교는 **기본 OFF**다 (2026-08-24 사용자 요청, 수동 구조와 통일)
        //   → `!== false`가 아니라 `=== true`. 되돌리면 저장값이 없을 때 켜진 채로 뜬다
        alertChoch: indicatorParams.zz?.alert_choch === true,
        showChoch:  indicatorParams.zz?.show_choch  !== false,
        maxChoch:   indicatorParams.zz?.max_choch ?? null,   // null = 전체
        // 레그 hover 거래량 비교 3줄 — 2026-08-24 되살림 (수동 구조와 짝을 맞춘다).
        // 2026-08-14~24에는 없었다: 그때 사용자가 뺐고, 같은 사용자가 다시 요청했다.
        // ⚠ 수동 구조는 **구조마다** 값을 들고 있지만(st.showLegVol) 자동 ZZ는
        //   지표라 값이 하나다 → indicatorParams.zz.show_legvol
        showLegVol: indicatorParams.zz?.show_legvol === true,
      }],
      setSelectedId: (id) => setZzSelected(id != null),
      delete:     () => {},   // 지표는 지울 대상이 아니다
      toggleLock: () => {},   // 드래그로 움직이지 않으므로 잠금도 의미 없다
      // 구조와 마찬가지로 toggleAlert = **CHoCH 발생 알림**(근접 알림이 아니다)
      toggleAlert: () => setIndicatorParam("zz", "alert_choch", !indicatorParams.zz?.alert_choch),
      toggleChoch: () => setIndicatorParam("zz", "show_choch",  indicatorParams.zz?.show_choch  === false),
      toggleLegVol: () => setIndicatorParam("zz", "show_legvol", !indicatorParams.zz?.show_legvol),
      setOpacity:  (_id, opacity) => setIndicatorParam("zz", "opacity", opacity),
      setMaxChoch: (_id, n) => setIndicatorParam("zz", "max_choch", n),
    },
    structure: {
      id: structs.selectedStructId, items: structs.structures,
      setSelectedId: structs.setSelectedStructId,
      // Delete 키 → 꼭짓점이 선택돼 있으면 그것만, 아니면 구조 전체 삭제
      delete:        structs.deleteStructSelection,
      // 구조는 근접 알림 대상이 아니다 — 🔔 자리를 **CHoCH 발생 알림**이 쓴다.
      // 단축키 `a`도 같은 동작이 되도록 toggleAlert에 직접 연결한다
      toggleAlert:   structs.toggleStructChochAlert,
      toggleLock:    structs.toggleStructLock,
      setOpacity:    structs.setStructOpacity,
      toggleChoch:   structs.toggleStructChoch,   // CHoCH 마크 표시
      setMaxChoch:   structs.setStructMaxChoch,   // CHoCH 표시 개수 (구조별)
      toggleLegVol:  structs.toggleStructLegVol,  // 레그 hover 거래량 비교 3줄 (구조별)
      // 자동 이어그리기 — **구조마다** on/off와 설정을 갖는다 (2026-08-26).
      // 자동 구조 지표(zz)에는 대응하는 항목이 없다 — 그쪽은 그 자체가 자동이다
      toggleAuto:    structs.toggleStructAuto,
      setAutoParam:  structs.setStructAutoParam,
    },
  }), [
    trendLines.selectedLineId, trendLines.lines, trendLines.setSelectedLineId,
    trendLines.deleteLine, trendLines.toggleLineAlert, trendLines.toggleLineLock, trendLines.setLineOpacity,
    trendLines.selectedChannelId, trendLines.channels, trendLines.setSelectedChannelId,
    trendLines.deleteChannel, trendLines.toggleChannelAlert, trendLines.toggleChannelLock, trendLines.setChannelOpacity,
    trendLines.selectedCircleId, trendLines.circles, trendLines.setSelectedCircleId,
    trendLines.deleteCircle, trendLines.toggleCircleAlert, trendLines.toggleCircleLock, trendLines.setCircleOpacity,
    fibTool.selectedFibId, fibTool.fibs, fibTool.setSelectedFibId,
    fibTool.deleteFib, fibTool.toggleFibAlert, fibTool.toggleFibLock, fibTool.setFibOpacity,
    fibTool.toggleFibLevel, fibTool.resetFibLevels,
    measureTool.selectedMeasureId, measureTool.measures, measureTool.setSelectedMeasureId,
    measureTool.deleteMeasure, measureTool.toggleMeasureLock, measureTool.setMeasureOpacity,
    structs.selectedStructId, structs.structures, structs.setSelectedStructId,
    structs.deleteStructSelection, structs.toggleStructLock, structs.setStructOpacity,
    structs.toggleStructChoch, structs.toggleStructChochAlert, structs.toggleStructLegVol,
    structs.setStructMaxChoch, structs.toggleStructAuto, structs.setStructAutoParam,
    zzSelected, indicatorParams.zz, setIndicatorParam,
  ]);

  // ── 키보드 단축키 ─────────────────────────────────────────────────────────
  useKeyboardShortcuts({
    shortcuts,
    setDrawMode,
    setOrderPick,
    setCurrent,
    cancelDraw:        trendLines.cancelDraw,
    cancelChannelDraw: trendLines.cancelChannelDraw,
    cancelCircleDraw:  trendLines.cancelCircleDraw,
    cancelFibDraw:     fibTool.cancelFibDraw,
    cancelMeasureDraw: measureTool.cancelMeasureDraw,
    cancelStructDraw:  structs.cancelStructDraw,
    setStructMode:     structs.setStructMode,
    structEnabled:     structOn,
    structMode:        structs.structMode,
    ensureStructTf,
    setFibMode:        fibTool.setFibMode,
    drawables,
    setSelectedBox,
    drawings, hasPending, locked: drawLocked, selectedBox,
    deleteBox,
    interval_,
    onIntervalChange:  val => { if (val === interval_) return; setInterval_(val); chartActionsRef.current?.resetDomain({ defer: true }); },
  });

  // 리플레이 진입 — 시작 시점을 한 번도 고른 적 없으면 90일 전으로 채운다.
  // (빈 채로 들어가면 아무것도 안 뜨고 왜 안 되는지 알 수 없다)
  const onReplayToggle = () => {
    if (!replayOn) {
      // 시작일을 넘기면 setReplayRange가 끝 시각까지 함께 잡는다 (세션 길이 상한)
      const start = replayStartMs ?? (Date.now() - SESSION_MAX_MS);
      setReplayRange({ startMs: start });
    }
    setReplayOn(v => !v);
  };

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
          interval_={interval_} onIntervalChange={val => { if (val === interval_) return; setInterval_(val); chartActionsRef.current?.resetDomain({ defer: true }); }}
          lineMode={trendLines.lineMode} onLineModeToggle={() => {
            setOrderPick(null); setDrawMode(false); trendLines.cancelChannelDraw(); trendLines.cancelCircleDraw(); fibTool.cancelFibDraw(); measureTool.cancelMeasureDraw(); structs.cancelStructDraw();
            trendLines.setLineMode(m => { if (m) trendLines.cancelDraw(); return !m; });
          }}
          channelMode={trendLines.channelMode} onChannelModeToggle={() => {
            setOrderPick(null); setDrawMode(false); trendLines.cancelDraw(); trendLines.cancelCircleDraw(); fibTool.cancelFibDraw(); measureTool.cancelMeasureDraw(); structs.cancelStructDraw();
            trendLines.setChannelMode(m => { if (m) trendLines.cancelChannelDraw(); return !m; });
          }}
          circleMode={trendLines.circleMode} onCircleModeToggle={() => {
            setOrderPick(null); setDrawMode(false); trendLines.cancelDraw(); trendLines.cancelChannelDraw(); fibTool.cancelFibDraw(); measureTool.cancelMeasureDraw(); structs.cancelStructDraw();
            trendLines.setCircleMode(m => { if (m) trendLines.cancelCircleDraw(); return !m; });
          }}
          fibMode={fibTool.fibMode} onFibModeToggle={() => {
            setOrderPick(null);
            setDrawMode(false);
            trendLines.cancelDraw(); trendLines.cancelChannelDraw(); trendLines.cancelCircleDraw(); measureTool.cancelMeasureDraw(); structs.cancelStructDraw();
            fibTool.setFibMode(m => { if (m) fibTool.cancelFibDraw(); return !m; });
          }}
          measureMode={measureTool.measureMode} onMeasureModeToggle={() => {
            setOrderPick(null);
            setDrawMode(false);
            trendLines.cancelDraw(); trendLines.cancelChannelDraw(); trendLines.cancelCircleDraw();
            fibTool.cancelFibDraw(); structs.cancelStructDraw();
            measureTool.setMeasureMode(m => { if (m) measureTool.cancelMeasureDraw(); return !m; });
          }}
          structMode={structs.structMode} structEnabled={structOn} onStructModeToggle={() => {
            if (!structOn) return;   // 지표 OFF면 그려도 안 보이므로 진입 차단
            if (!structs.structMode) ensureStructTf();   // 진입할 때만 — 나갈 때 추가하면 엉뚱하다
            setOrderPick(null);
            setDrawMode(false);
            trendLines.cancelDraw(); trendLines.cancelChannelDraw(); trendLines.cancelCircleDraw(); fibTool.cancelFibDraw(); measureTool.cancelMeasureDraw();
            structs.setStructMode(m => { if (m) structs.cancelStructDraw(); return !m; });
          }}
          isDark={isDark} onThemeToggle={toggleTheme}
          last={last} candleLoading={candleLoading}
          indicators={indicators} onIndicatorToggle={toggleIndicator}
          indicatorParams={indicatorParams} setIndicatorParam={setIndicatorParam}
          setEmaList={setEmaList} resetIndicator={resetIndicator}
          notifSettings={notifSettings} onNotifToggle={notifToggle}
          isLog={isLog} onLogToggle={() => setIsLog(v => {
            const next = !v; lsSet("chart_isLog", next); return next;
          })}
          shortcuts={shortcuts} onShortcutUpdate={updateShortcut} onShortcutReset={resetShortcuts}
          replayOn={replayOn} onReplayToggle={onReplayToggle}
        />

        {/* 리플레이 컨트롤 — 모드일 때만. TopBar 바로 아래라 항상 눈에 들어온다 */}
        {replayOn && (
          <ReplayBar
            replay={replay}
            startMs={replayStartMs}
            onRangeChange={setReplayRange}
            onExit={() => setReplayOn(false)}
            // 🎲(무작위 시점)가 부른다 — localStorage의 도형 5종을 지우는 건 ReplayBar가 하고,
            // 여기선 ① gen을 올려 **React 상태까지** 새로 읽게 하고 (둘 다 해야 한다.
            // 상태에 남아 있으면 다음 저장에 그대로 되살아난다)
            // ② 연습 플랜 박스도 비운다 — 저건 스토어에 있어서 clearReplayDrawings가 못 건드린다
            onDrawingsCleared={() => { setDrawingGen(g => g + 1); clearDrawings(); }}
            // ⚠ 시크 뒤에는 **y 도메인도 되돌려야 한다.** 크게 건너뛰면 가격대가
            //   통째로 바뀌는데(실측: $78k 구간에서 $64k 구간으로) y축이 그대로라
            //   캔들이 화면 밖으로 나가 차트가 텅 빈 것처럼 보인다
            onSeek={(p) => { replay.seekProgress(p); chartActionsRef.current?.resetDomain(); }}
          />
        )}

        {/* ⚠ **여러 건을 동시에 띄운다** (2026-08-15). 한 reconcile에서 LONG·SHORT 경보가
            61ms 간격으로 오는데, 예전처럼 슬롯 하나면 뒤엣것이 앞엣것을 덮어써서
            LONG 경보가 통째로 사라졌다 (uiSlice.criticalAlerts 주석 참고).
            각 줄을 따로 닫는다 — 하나로 묶어 닫으면 아직 못 읽은 경보까지 같이 사라진다 */}
        {criticalAlerts.map(msg => (
          <div key={msg} onClick={() => dismissCriticalAlert(msg)} style={{
            padding: "8px 16px", background: "#7f0000", borderBottom: "2px solid #ff0000",
            fontSize: "13px", color: "#fff", fontWeight: "700", cursor: "pointer",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>{msg}</span>
            <span style={{ opacity: 0.7, fontSize: "11px" }}>클릭하여 닫기</span>
          </div>
        ))}

        <ChartArea
          candles={candles} candlesRef={candlesRef} candleLoading={candleLoading}
          onTickRef={onTickRef} interval_={interval_} isDark={isDark} isLog={isLog}
          rsiData={rsiData} emaData={emaData} fvgData={fvgData} obData={obData}
          pivotLevels={pivotLevels}
          showRsi={showRsi} showRsiZones={showRsiZones} showPivot={showPivot} showOB={showOB} showFVG={showFVG}
          showVol={showVol} showEMA={showEMA}
          showZZ={showZZ} showStruct={showStruct} zzSelected={zzSelected}
          indicatorParams={indicatorParams}
          current={current} setCurrent={setCurrent}
          actionsRef={chartActionsRef}
          drawables={drawables}
          {...trendLines}
          {...fibTool}
          {...measureTool}
          {...structs}
        />
      </div>

      {/* ── 사이드바 토글 ── */}
      <div
        onClick={() => setSidebarOpen(v => { const next = !v; lsSet("sidebar_open", next); return next; })}
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
          onCancelSplitTp={cancelSplitTp}
          onCancelPartialSl={cancelPartialSl}
          onDrawModeToggle={() => {
            setOrderPick(null);
            trendLines.cancelDraw(); trendLines.cancelChannelDraw(); trendLines.cancelCircleDraw();
            fibTool.cancelFibDraw(); measureTool.cancelMeasureDraw(); structs.cancelStructDraw();
            setDrawMode(m => !m);
          }}
        />
      </div>

      <Toast toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
