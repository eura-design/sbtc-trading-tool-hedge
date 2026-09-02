# CLAUDE.md

## ⚠️ 최우선 규칙 — 바꾸기 전에 먼저 물어본다

**기능을 추가하거나 동작·화면을 바꾸기 전에 반드시 사용자에게 확인받는다.**
지금 코드가 기준이다. 코드가 그렇게 되어 있으면 그럴 만한 이유가 있는 것이므로,
"이게 더 낫다 / 더 맞다"는 판단만으로 손대지 말 것.

- **대상**
  - 새 기능·새 화면·새 문구 추가
  - 기존 동작 변경 (계산 규칙, 주문 흐름, 기본값, 단축키, 저장 방식 등)
  - 레이아웃·위치·크기·색·간격 변경, 요소 제거·숨김
  - 파일·모듈 구조 변경, 리팩터링
- **묻는 방법**: 무엇을 어디서 어떻게 바꿀지 한두 줄로 말하고 답을 기다린다.
  고칠 게 여러 개면 **묶어서 한 번에** 묻는다.
- **예외** (물어보지 않아도 되는 것)
  - 사용자가 **직접 지시한 경우** — 지시한 범위 안에서는 그대로 진행
  - 코드 주석 · `CLAUDE.md` · 커밋 메시지
  - 값만 바뀌는 것 (잔고·수량 등 데이터 갱신)
- ⚠ **버그 수정도 예외가 아니다.** 고칠 이유가 보이면 **고치지 말고 먼저 말한다.**
- ⚠ 확인 없이 이미 바꿨다면 되돌리지 말고 **무엇을 바꿨는지 즉시 알린다.**
- ⚠ 요청받은 것만 바꾼다. 지나가다 눈에 띈 것을 덤으로 고치지 말 것.

## 읽지 않아도 되는 폴더
`backend/node_modules/` · `frontend/node_modules/` · `frontend/public/` · `frontend/dist/`

---

## 파일 구조

### 백엔드 (`backend/`)
```
server.js                  Express 앱 설정 + 시작 + 그레이스풀 셧다운 + 이벤트 루프 멈춤 감지
routes/
  balance.js               GET  /api/balance → { walletBalance, availableBalance, crossUnPnl }
  position.js              GET  /api/position → { long, short, pending, scaleInOrders, funding }
  order.js                 POST /api/order (진입 + TP/SL 등록, 일일 손실 가드)
                           PATCH /api/order (미체결 주문의 TP/SL 수정)
  orders.js                DELETE /api/orders (미체결 취소)
  close.js                 POST /api/close (전량/부분 청산, 부분 시 분할 TP 재등록)
  tpsl.js                  GET/PUT/DELETE /api/tpsl + POST/DELETE /api/tpsl/split
  scalein.js               POST/DELETE /api/scale-in (추가 진입)
  leverage.js              POST /api/leverage (1~125)
  stats.js                 GET  /api/stats?startTime=&endTime= (수수료·펀딩비·순손익)
  dailyloss.js             GET  /api/daily-loss + checkDailyLoss() export
  health.js                GET  /api/health (서버 상태 + UDS·계정감시 상태)
  symbols.js               GET  /api/symbols (거래 가능 USDT 무기한 + 호가·수량 단위)
  tracker.js               GET/POST /api/tracker (월별 결산 페이지용)
  backup.js                POST /api/backup (브라우저 저장소 백업 수신)
  log.js                   POST /api/log (프론트 이벤트 수집, kind:"client")
services/
  binanceClient.js         sign/binance/roundPrice/roundQty/placeTPSL/preplaceTPSL/checkExistingTPSL/syncServerTime
  symbolInfo.js            심볼별 호가·수량 단위 (exchangeInfo 캐시, 12시간) — **원본은 바이낸스**
  orderWatcher.js          User Data Stream(체결 감지) + watchAccount(3초) + reconcile(60초)
  recoveryService.js       서버 재시작 시 미체결/체결 주문 복구
  entryTime.js             현재 포지션의 평단 변화 이력(entrySteps)을 userTrades에서 역산
  pushService.js           프론트 WebSocket 푸시 (update / alert / alert-clear)
  dailySummary.js          하루치 한 줄 요약 (DAILY_SUMMARY)
  incomeLogger.js          손익·수수료·펀딩비 기록 (10분 주기 + 포지션 종료 직후)
  statsCache.js            /api/stats 캐시 상태 공유
store/
  logStore.js              로그 한 벌 — logs/<날짜>.jsonl (구조화 이벤트 + 콘솔 캡처)
  backupStore.js           백업 — backups/<날짜>.json (60일)
  pendingOrders.js         PendingOrderStore (Map + debounce 저장, 7일 정리)
                           `symbol` 필드 — set()이 채운다. 낡은 기록은 `symbolOf()`가 기본 심볼로 읽는다
  trackerStore.js          기타/tracker_data.json 읽기·쓰기
middleware/validate.js     POST /api/order 입력 검증
utils/
  side.js                  헷지모드 side 매핑 (sideToPosition/positionToSide/closeToPosition/positionToClose)
  orderKind.js             미체결 LIMIT 정체 판정(limitKind) + 트리거 전량/부분 판정
  round.js                 호가·수량 단위 맞추기 (순수 함수) — **가격은 반올림, 수량은 내림**
  splitTp.js               rescaleSplitTps() — 부분 청산 후 분할 TP 재계산 (순수 함수, import 없음)
tools/
  logq.js                  로그 조회 (--since/--count/--sum/--event/--level/--day/--grep/--summary)
  backup.js                백업 조회·되돌리기 (--list/--show/--restore-files)
tests/                     `npm test` (node 내장 러너 — **의존성 0**)
  splitTp / orderKind / side / round.test.js   돈이 걸린 순수 함수부터
logs/  backups/  daily_summary.jsonl  income_cursor.json  pending_orders.json  .env
```

### 프론트엔드 (`frontend/src/`)
```
constants.js               테마(DARK/LIGHT), 레이아웃 상수, API_BASE, BN_WS, INTERVALS, CANVAS_C, POLLING
                           ⚠ MIN_QTY·QTY_STEP은 **BTCUSDT 값이자 대비책일 뿐** — useSymbolFilters를 쓸 것
ThemeContext.jsx           ThemeProvider + useTheme()
App.jsx                    hooks 조합 + TopBar/SidebarPanel/ChartArea 조립
main.jsx   index.css

store/
  index.js                 Zustand 스토어 조립 (4 slice) — useStore
  serverSlice.js           balance/position/tpsl/liveClose + refetch 콜백
  settingsSlice.js         riskPctLong·riskPctShort/leverage/interval_/indicators/symbol/symbolFilters (localStorage)
  uiSlice.js               drawings/drawMode/orderStatus/criticalAlerts/selectedBox/드래그 상태
  replaySlice.js           리플레이 모드 상태 (replayOn/구간/시계/페이퍼 브로커)
  orderSlice.js            주문 액션 전부 (아래 "주문 액션" 참고)

api/
  client.js                api(method, path, body) + setReplayGuard(리플레이 중 GET 외 차단)
  clientLog.js             화면 이벤트를 백엔드 로그로 (요청·예외·모드 전환만)
  backup.js                브라우저 저장소 백업 전송 + window.__restoreBackup()

utils/
  storage.js               lsGet/lsSet/lsRemove/lsGetJSON/lsSetJSON — localStorage 직접 호출 금지
  calc.js                  calcPosition() — 리스크 기반 수량 계산
  splitLevels.js           분할 주문 가격·수량 배분 (splitPlan/splitOrders/maxSplitCount)
  qty.js                   수량 표시·내림 (fmtQty/floorQty/qtyLabel) — 심볼 단위를 따른다
  equity.js                unrealizedFor/totalUnrealized/totalEquity
  side.js                  헷지모드 side 매핑 (+ isLongToPosition/isLongToSide)
  coordUtils.js            idxToTimestamp/getCandleMs/addMonthsUTC
  hitTest.js  format.js  rsi.js

hooks/
  useCandles.js            REST 1500봉 + WebSocket 실시간
  useRealtimeData.js       백엔드 WebSocket 연결
  usePoll.js               폴링 공통 훅 (enabled=false면 리플레이용 no-op)
  useBalance / usePosition / useTpsl / useDailyLoss / useStats / useMarketInfo / useHealth
  useSymbolFilters.js      심볼별 호가·수량 단위 (GET /api/symbols) — **수량 계산의 유일한 출처**
  usePositionFlags.js      derivePositionFlags(position) → hasLong/hasShort/hasPos/hasBoth/hasPending/drawLocked
  useOrderFlow.js          orderSlice 액션 재-export 래퍼
  useChartSize / useChartRenderer / useChartInteraction / useCrosshair
  useRsiResize / useVolResize / useAccordion
  useRSI / useEMA / useFVG / useOrderBlock / usePivotLevels / useIndicatorParams
  useTrendLines / useFibs / useMeasures / useStructures / useDrawableStore
  useAlertMonitor / useTrendLineAlert / usePositionCloseAlert / useToast
  useChochAlert.js         CHoCH 알림 — TF마다 kline WebSocket을 따로 열어 감시
  useNotificationSettings / useShortcutSettings / useKeyboardShortcuts
  useReplay.js             리플레이 캔들 피드 (useCandles와 같은 계약)

chart/
  candleRenderer.js        renderCandles (캔들 + 축 + 오버레이 호출)
  canvasUtils.js  scales.js  svgGeom.js  cursorRules.js  hitDetection.js  dragStateMachine.js
  overlayRenderers.js      FVG/OB/Pivot/EMA/ZigZag/RSI구간 캔버스 렌더
  volumeRenderer.js  rsiRenderer.js
  pivotLevels.js           스윙 피벗 기반 지지/저항 계산 (순수 함수)
  structureZigzag.js       자동 ZZ 계산 (forward-only 누적) — 슬롯별(화면 `chart` / 감시 `tf:5m`…)
  zigzagPivots.js          꼭짓점 판정 규칙 (자동 ZZ · 자동 이어그리기 공용)
  structAutoPivots.js      커스텀 구조 자동 이어그리기
  deriveStructure.js       수동 구조 → 세그먼트 + CHoCH (순수 함수)
  structRenderState.js     수동 구조 렌더가 남기는 모듈 상태
  fib.js  measure.js  entryPath.js  legVolume.js  drawables.js
  structDebug.js  legDebug.js       콘솔 진단 (__structDebug / __legDebug)

components/
  TopBar.jsx               TF 선택, 현재가, 드로잉 모드 버튼, 지표·알림·단축키 메뉴, 테마
  ChartArea.jsx            차트 영역 조합
  SymbolPicker.jsx         심볼 검색·선택 (목록은 백엔드가 exchangeInfo에서 준다)
  IndicatorMenu / NotificationMenu / ShortcutMenu / ReplayBar
  Toast / StatusAlert / Slider / Divider / sidebarBtn.js(버튼 규격)
  Chart/
    ChartSvg.jsx           SVG 레이어 조합
    BoxOverlay.jsx         플랜 박스
    PositionLines.jsx      진입선(계단)/TP/SL/분할/추가진입/청산선/대기선 + 마커
    OrderPickPreview.jsx   차트 분할 주문 미리보기
    TrendLines / Channels / Circles / Fibs / Measures / Structures / LockMark
    LineOpacityPopup.jsx   더블클릭 팝업 (투명도·알림·잠금·도형별 옵션)
  Sidebar/
    SidebarPanel.jsx       패널 조합 + 리스크·레버리지 슬라이더 + 일일 손실
    BalanceCard / MarketInfoCard / PositionCard / PlanCard / StatsCard / ReplayStatsCard
    ScaleInCard / SplitTPCard / SplitSLCard / cardControls.jsx

tests/                     `npm test` (node 내장 러너 — **의존성 0**)
  splitLevels / calc / equity.test.js   돈이 걸린 순수 함수
  ⚠ node가 직접 import한다 — 테스트할 모듈의 상대 import에는 `.js`를 붙일 것
    (`replay/`가 같은 이유로 그렇게 돼 있다)

replay/                    리플레이 트레이딩
  soa.js  timeframes.js  klines.js  history.js  engine.js
  paperBroker.js           페이퍼 체결 엔진 (스냅샷이 백엔드와 같은 모양)
  paperActions.js          orderSlice 액션의 페이퍼 버전 (이름을 똑같이 유지)
  tradeStats.js  dailyLoss.js  drawingKeys.js  session.js
```

### 기타
- `start.bat` — 백엔드·프론트엔드 동시 실행
- `기타/monthly_tracker.html` — 월별 수익 결산 (독립 페이지, 데이터는 `기타/tracker_data.json`)
  - 권장 경로: `http://localhost:3002/tools/monthly_tracker.html` (동일 출처라 CORS가 안 낀다)
- `기타/compound_calculator.html` — 복리 계산기 (독립 페이지)

---

## 핵심 설계

### 헷지모드
Binance Futures 헷지 모드 전제 — LONG/SHORT 동시 보유 가능.

- **position API**: `{ long, short, pending, scaleInOrders, funding }`
  - `long`/`short`: `size / entryPrice / unrealizedPnl / leverage / liquidationPrice / entryTime / entrySteps` 또는 null
    - `entrySteps` = `[{ t, avg }]` — 평단이 바뀐 이력. 차트 진입선을 계단으로 그리는 데 쓴다
    - `services/entryTime.js`가 userTrades에서 역산 (7일 창을 뒤로 밀며 필요한 만큼 조회)
  - `pending`: `{ long, short }` — 사이드별 진입 LIMIT 1건
  - `scaleInOrders`: BUY = LONG 추가진입, SELL = SHORT 추가진입
- **tpsl API**: `{ long: { tp, sl, splitTps, partialSls }, short: { … } }`
  - splitTps 분류: SELL = 롱 청산, BUY = 숏 청산
- **side 매핑**은 `utils/side.js` 헬퍼로 (직접 문자열 비교 금지)

### 심볼
- 심볼별 규칙(호가·수량 단위)은 **바이낸스 `exchangeInfo`가 원본** — `services/symbolInfo.js`
- **프론트**: 상태는 `settingsSlice.symbol` 하나(localStorage). 규칙은 `useSymbolFilters`가
  받아 `symbolFilters`로 스토어에 밀어 넣는다 (수량 계산이 스토어 안에서도 돌기 때문)
- `api/client.js`가 **모든 요청에 심볼을 자동으로 싣는다** — 호출부마다 넣지 않는다
  (주문 액션이 16개라 하나만 빠뜨려도 그 경로가 다른 코인 화면에서 BTC 주문을 낸다).
  호출부가 직접 넣은 `symbol`이 이긴다
- ⚠ 수량 자릿수를 `toFixed(3)`으로 쓰지 말 것 — `utils/qty.js`가 심볼 단위를 따른다
- 라우트는 body/query의 `symbol`을 받는다 (`symbolInfo.fromRequest`, 없으면 기본 심볼).
  **모르는 심볼은 400**이다 — 통과시키면 가격이 이미 기본 심볼 단위로 만들어진 뒤 거절된다
- **이미 걸린 주문을 건드릴 때는 `store.symbolOf(orderId)`를 쓴다** (요청이 아니라).
  화면이 다른 심볼로 옮겨간 뒤에도 원래 심볼로 취소·수정해야 한다
- **손익 조회에는 심볼 필터를 걸지 않는다** (`/api/stats`·일일 손실·`INCOME`) —
  한도의 기준인 지갑 잔고가 계정 전체 값이라, 손익만 좁히면 한도가 헐거워진다
- ⚠ `"BTCUSDT"` 문자열은 `symbolInfo.DEFAULT_SYMBOL`과 `SEED` 두 곳에만 있다. 늘리지 말 것
- **포지션 플래그**: `derivePositionFlags(position)` → hasLong/hasShort/hasPos/hasBoth/hasPending/drawLocked

### 주문의 정체는 바이낸스가 정한다
미체결 LIMIT이 무엇인지는 `utils/orderKind.js`의 `limitKind()`가 **주문 방향 + 포지션 유무**로 판정한다.

| 주문 방향 | 그 사이드 포지션 | 정체 |
|---|---|---|
| 청산 방향 (SELL/LONG · BUY/SHORT) | — | `SPLIT_TP` |
| 진입 방향 (BUY/LONG · SELL/SHORT) | 있음 | `SCALE_IN` |
| 진입 방향 | 없음 | `ENTRY` |

- store(`pending_orders.json`)에는 **거래소가 알 수 없는 것만** 담는다 —
  체결 시 걸 tp/sl, 플랜 박스, 등록 당시 비율, 주문 단계(WATCHING→…)
- 포지션이 닫힌 뒤에는 store를 힌트로 쓴다 (`limitKind`의 3번째 인자)
- 밖에서 낸 주문도 화면에 뜨고 취소·이동이 된다.
  단 트레일링 스톱과 BTCUSDT 외 심볼은 보이지 않는다

### 주문 상태 흐름
```
WATCHING → FILLED → TPSL_PLACED | TPSL_PARTIAL | TPSL_MISSING
SCALE_IN / SPLIT_TP   (체결·취소 시 store에서 제거)
```

### 주문 종류

| | 주문 타입 | 체결 |
|---|---|---|
| 단일 TP | `TAKE_PROFIT_MARKET` (`closePosition:true`) | 닿으면 시장가, 잔여 전부 |
| SL | `STOP_MARKET` (`closePosition:true`) | 닿으면 시장가, 잔여 전부 |
| 분할 TP | `LIMIT` GTC + reduceOnly | 호가창에 줄을 선다 (메이커) |
| 분할 SL | 조건부 시장가 (수량 지정) | 닿으면 그 수량만 |

- 트리거 기준은 전부 `CONTRACT_PRICE`(실제 체결가)
- **단일 TP와 분할 TP는 공존한다** — 서로 취소하지 않는다
- 수량을 지정한 트리거 주문은 포지션이 0이 돼도 거래소에 남는다 → `orderWatcher`가 정리
- `closePosition:true` 주문과 reduceOnly 지정가는 거래소가 자동으로 치운다

### 지정가 진입의 TP/SL 사전 등록
`POST /api/order`의 LIMIT 분기가 `preplaceTPSL`로 TP/SL을 미리 건다 —
백엔드가 꺼진 사이 체결돼도 손절이 있게 하기 위해서다.

- 포지션이 없으므로 `closePosition` 대신 **수량을 직접 적는다**
- 체결 후에는 `placeTPSL`이 `closePosition` 방식으로 덮어쓴다 (이중 안전망)
- 화면에는 체결 전까지 보이지 않는다 (플랜 박스가 그 가격을 이미 보여준다)
- 진입 주문이 사라지면 사전 등록분도 같이 내린다

### 체결 감지 · 계정 감시
- LIMIT: User Data Stream WebSocket → FILLED 시 `placeTPSL()`
- MARKET: 즉시 체결 → 바로 `placeTPSL()`
- `watchAccount()`가 **3초마다** 포지션·미체결·알고 주문 지문을 떠서 변화가 있을 때만 푸시
  (UDS가 조용한 환경이 있어 UDS와 무관하게 항상 돈다)
  - **계정 전체를 본다** (2026-09-02) — 밖에서 낸 다른 코인 포지션도 SL 없으면 경보가 뜬다
  - 포지션은 `/fapi/v3/positionRisk`(심볼 없이) — **열린 것만** 준다.
    ⚠ v2는 심볼을 안 주면 1784행 682KB다 (3초 주기면 하루 19GB). v3에는 `leverage`가 없다
  - 미체결·알고는 **심볼을 지정해서** 부른다. ⚠ 심볼 없이 부르면 가중치가 1 → **40**이다
    (실측). 폴당 5+2N — 심볼 1개면 7로, 계정 전체를 보기 전과 같다
  - 무방비 경보의 키·문구에 **심볼이 들어간다** (`BTCUSDT|LONG`) — 없으면 한 심볼의
    경보를 거둘 때 다른 심볼 것까지 사라진다
- `reconcileWithBinance()` 60초 — 미체결·체결 정합, SL 없는 포지션 감시 → critical 알림
- 포지션이 사라지면 watchAccount가 reconcile을 즉시 부른다

### 일일 손실 한도
- 한도: 당일 시작 총자본(walletBalance − todayPnl)의 4%, UTC 0시 리셋
- 백엔드 `checkDailyLoss()`가 `POST /api/order` 앞단에서 차단
- 프론트 `orderSlice.executeOrder`도 조회 후 remaining ≤ 0이면 차단

### 글로벌 상태 (Zustand)
- 4개 slice 조립 (`store/index.js`)
- `SidebarPanel`·`ChartArea`는 `useShallow` 셀렉터로 구독
- **리스크 %는 롱·숏 따로 / 레버리지는 하나** (바이낸스가 레버리지를 심볼 단위로만 받는다)
- 실거래·연습 값도 따로 (`swapTradeSettings`) → 리스크 4벌, 레버리지 2벌
- 리스크·레버리지 변경 시 800ms debounce 후 **같은 사이드** 미체결 주문 자동 재등록

### 주문 액션 (`store/orderSlice.js`)
`executeOrder` / `saveTpsl` / `scaleIn` / `cancelScaleIn` / `moveScaleIn` /
`addSplitTp` / `cancelSplitTp` / `moveSplitTp` / `addPartialSl` / `movePartialSl` /
`placeSplitOrders` / `cancelSplitOrders` / `closePosition` /
`updatePendingTpsl` / `replacePendingOrder` / `deleteBox`

- 플랜 박스를 쓰는 셋(`executeOrder`/`replacePendingOrder`/`updatePendingTpsl`)은 `isLong`을 인자로 받는다
- `scaleIn`·`addSplitTp`·`addPartialSl`의 `side`는 **포지션 방향(LONG/SHORT)**으로 통일.
  `POST /api/scale-in`만 BUY/SELL을 받으므로 그 변환은 `scaleIn` 안에서 한다
- 이 셋은 실패를 안에서 배너로 처리하고 **true/false를 돌려준다** (try/catch로는 못 잡는다)
- 리플레이 중에는 각 액션 첫 줄에서 `paperActions`로 위임한다.
  **새 주문 액션을 추가하면 페이퍼 버전과 위임 한 줄도 같이 넣을 것**

---

## 차트

### 드래그 시스템
`dragRef.current.type` → `DRAG_HANDLERS[type].onMove()/.onUp()` 분기 (`chart/dragStateMachine.js`).

| 대상 | 타입 |
|---|---|
| 플랜 박스 | draw / pan / entry / tp / sl / box_x |
| 포지션 마커 | pos_tp / pos_sl / scale_in / split_tp / partial_sl |
| 트렌드라인 | line_ep / line_move |
| 채널 | channel_ep / channel_move / channel_mid_main / channel_mid_offset / channel_mirror_ep |
| 원 | circle_move / circle_radius |
| 피보나치 | fib_ep / fib_move |
| 측정 박스 | measure_draw / measure_ep / measure_move |
| 수동 구조 | struct_point |
| 분할 주문 | order_pick |

- 히트 우선순위는 `hitDetection.js`의 `buildHitChain`이 순서대로 정한다
- 렌더와 히트 판정은 **같은 좌표 함수**를 부른다 (posEntryRows / posTpSlButtons / markerCloseButtons 등)
- 플랜 박스는 **롱·숏 각각 하나씩 최대 두 개**. 드래그 방향이 곧 슬롯이다
- 같은 사이드에 포지션이 있으면 그쪽 박스는 그려지지 않는다 (놓는 순간 되돌리고 배너)
- 마커 옆 `×`로 제거. 진입 라벨의 `×`만 두 번 눌러야 한다(시장가 청산)

### 차트에서 분할 주문 걸기
카드의 `차트에서 지정` → 차트 **클릭 1개 / 세로 드래그 N개 균등**.

- 주문 종류는 **열려 있는 아코디언**이 정한다 (추가 진입 / 분할 TP / 분할 SL)
- 가격·수량 계산은 `utils/splitLevels.js`의 `splitPlan` 하나 — 미리보기와 실주문이 공유
- 큰 조각은 **기준가에서 먼 쪽**으로 간다
- 가격 유효성은 `orderSlice.placeSplitOrders`가 살아 있는 현재가·진입가로 판정한다

| 종류 | 기준 | 롱 | 숏 |
|---|---|---|---|
| 추가 진입 | 현재가 | 아래 | 위 |
| 분할 TP | 진입가 | 위 | 아래 |
| 분할 SL | 현재가 | 아래 | 위 |

- 주문은 **순차로** 보내고 몇 개가 나갔는지 알린다
- 한 번 걸면 모드가 꺼진다. 빠져나오는 길: 버튼 다시 누르기 / 우클릭 / ESC / 카드 닫기
- 카드마다 `전체 취소` — `cancelSplitOrders(kind, side)`, 확인 버튼 2개 방식

### 드로잉 도구
박스(`q`) / 라인 / 채널 / 원 / 피보나치(`f`) / 측정 / 구조(`s`)

- `Escape` 취소·선택 해제 / `Delete` 삭제 / `a` 알람 / `l` 잠금 / `[` `]` 투명도 ±0.1
- 숫자키 `1`~`6`: TF 전환. 모든 단축키는 ShortcutMenu에서 커스텀 가능
- 공통 속성: `opacity`(0.1~1.0) / `locked` / `alert`, 저장은 `useDrawableStore(key)`
- 좌표가 timestamp라 **전 TF 공유**
- SVG 도형은 `chart/svgGeom.js`로 **뷰포트 클리핑** (화면 밖 수만 px 경로가 렉을 만든다)

### 지그재그 · 구조
- **자동 구조** (`structureZigzag.js`, 지표) — 렌더 경로에서 계산, forward-only 누적
- **커스텀 구조** (`deriveStructure.js`, 수동) — 꼭짓점 배열 → 매번 전체 재계산
- 꼭짓점 판정 규칙은 `zigzagPivots.js` 하나를 나눠 쓴다
- **자동 이어그리기** (`structAutoPivots.js`) — 커스텀 구조의 마지막 꼭짓점 뒤로 붙는 점선.
  자동 점을 클릭하면 거기까지 확정된다. 구조별 on/off + 설정 4개 (더블클릭 팝업)
- CHoCH: 첫 돌파(bias=0)도 CHoCH, BOS는 표시하지 않는다. 마크는 가로선만(글자 없음)
- 레그 hover: 등락률 + 거래량 3줄(상위3/평균/총량), 직전 동일방향 레그(k-2)와 비교

### 보조지표
Volume / RSI(+구간 배경) / Pivot Levels / FVG / 오더블록 / EMA(다중) /
Auto Structure Zigzag / Custom Structure Zigzag

- 설정은 **브라우저 localStorage `indicatorParams`** 하나에 저장 (`useIndicatorParams`)
- 새 지표 키는 프론트 `INDICATOR_DEFAULTS`에만 넣으면 된다
- **Pivot Levels**는 멀티 TF — 선택한 TF들의 캔들을 REST로 따로 받아 계산
- RSI 구간 배경은 `rsi.tfs`로 표시 TF를 거른다 (RSI 선 자체는 전 TF 공통)
- 커스텀 구조 표시 TF는 `struct.tfs`

### 렌더링
- 메인 캔버스(캔들 + 오버레이) / 거래량 캔버스 / RSI 캔버스 분리
- React SVG로 그리는 것: 플랜 박스 · 포지션 라인 · 선 · 채널 · 원 · 피보나치 · 측정 · 수동 구조
- pan 중에는 무거운 오버레이 렌더를 스킵
- 축 도메인은 `scales.js`의 `initialXDomain` / `fitYDomain` 두 함수만 잡는다

---

## 리플레이 트레이딩
과거 구간을 재생하며 가짜 돈으로 연습한다. 같은 화면 + 모드 전환(`replayOn`).

- 하위 TF로 구동 (1h → 5m 12틱, `replay/timeframes.js`)
- 체결 규칙은 전부 "모르면 불리하게" — 한 봉에 TP·SL 둘 다 닿으면 SL 우선,
  갭이면 갭 시가 체결, 승패는 수수료를 뺀 뒤 판정
- 페이퍼 스냅샷(position/tpsl/balance)은 **백엔드 라우트와 같은 모양**이라
  사이드바·차트가 리플레이인지 모른 채 그대로 돈다
- 실주문 차단 2겹: `setReplayGuard`(GET 외 차단) + 액션별 `paperActions` 위임
- 미래 누출 차단: Pivot Levels·펀딩비·공포탐욕은 재생 시각까지만, 실시간 RSI 감시는 끈다
- 도형·플랜 박스·리스크·레버리지는 `replay_` 접두사로 분리
- 세션은 localStorage에 저장 (진행 위치를 **시각**으로) — 구간이 바뀌면 장부만 복원
- 연습 성적이 사라지는 경로는 `성적 초기화` 버튼 하나뿐
- 재생 가능 시작: 2019-09-08 (BTCUSDT 무기한 선물 상장일), 세션 최대 90일
- ⚠ `replay/`만 상대 import에 `.js` 확장자 — node로 직접 검산하기 위해서다

---

## 로그 · 백업

### 로그 (`backend/logs/<날짜>.jsonl`)
**읽는 쪽이 사람이 아니라 Claude다** — grep으로 한 줄씩 뽑아 세기 좋게 쓴다.

- 한 줄에 JSON 하나. 필드: `ts/iso/boot/kind/level/event/tag/orderSide/posSide/err`
- `kind`: `"event"`(구조화) / `"console"`(캡처) / `"client"`(화면)
- `event`는 문구가 아니라 **안정적인 식별자**다. 같은 사건이면 이름을 늘리지 말고 필드로 가른다
  (`QUERY_FAILED`+`what`, `ORDER_CANCEL_FAILED`+`kindOf`, `STORE_IO_FAILED`+`store`/`op`)
- 뼈대 필드(`ts/iso/boot/kind/event/level`)는 `fields`가 덮을 수 없다 (`RESERVED`)
- 주문 종류는 값으로 남긴다 (`orderType`/`closePosition`/`reduceOnly`/`timeInForce`/`workingType`)
- `ACCOUNT_STATE`가 뼈대 — watchAccount가 바뀔 때만 한 줄 (부팅 첫 관측도 남긴다)
- `INCOME`이 수익 곡선·수수료·펀딩비의 유일한 출처.
  중복 판정은 **`tranId + incomeType`** (tranId 단독은 유일하지 않다)
- `boot`은 부팅마다 새 id — `SERVER_STOP` 없이 boot만 바뀌었으면 비정상 종료다
- 터미널에는 `warn`/`error`만. 파일에 남긴 내용을 그대로 렌더링한다(`toTerm`)
- 조회: `node backend/tools/logq.js --since 7d --count` / `--sum income` / `--event X` / `--summary`

### 데이터가 사는 곳

| 어디 | 무엇 | 백업 |
|---|---|---|
| 브라우저 localStorage | 도형·플랜 박스·리스크/레버리지·지표 설정·알림·단축키·테마·연습 세션 | ○ |
| 브라우저 IndexedDB | 리플레이 캔들 캐시 | × (다시 받으면 그만) |
| 백엔드 파일 | `pending_orders.json` / `기타/tracker_data.json` | tracker만 ○ |
| 백엔드 로그 | `logs/` 30일 + `daily_summary.jsonl` 무기한 | × |
| `backend/.env` | API 키 | **× (절대 담지 않는다)** |
| 바이낸스 | 주문·포지션·TP/SL | × (거래소가 원본) |

- 백엔드가 꺼져도 동작해야 하는 것 → 브라우저
- 브라우저를 닫아도 살아 있어야 하는 것 → 백엔드 파일
- 같은 기능의 설정을 두 곳에 나누지 말 것

### 백업 (`backend/backups/<날짜>.json`, 60일)
- 브라우저가 10분마다 + 탭을 숨길 때 전송 → 백엔드가 **오늘 파일을 덮어쓴다**
- 백엔드도 시작할 때·6시간마다 한 번씩 쓴다
- 빈 내용은 거절한다 (`BACKUP_EMPTY_REJECTED`)
- 되돌리기: 브라우저는 콘솔 `__restoreBackup(true)`,
  백엔드 파일은 `node backend/tools/backup.js --restore-files [날짜]`

---

## 알림 시스템

### 토스트 — 한 종류뿐
`addToast(message, onClose)` 하나. 금색 / 20초 자동 닫힘 / `확인`으로 즉시 / 소리 1번 / 최대 3개.
색·크기·닫힘 방식의 갈래를 만들지 말 것. 빨강이 필요하면 그건 상단 배너다.

### 배너 (`pushAlert`)
level은 **`critical`(빨간 배너) / `notice`(금색 토스트)** 둘뿐. level을 빠뜨리면 빨강이다.
`alert-clear`로 회수하며 **문구가 키다** — 띄울 때와 글자가 다르면 배너가 안 닫힌다.

### 종류
- RSI 과매수/과매도 — 7 TF 독립 WebSocket, 쿨다운 + 히스테리시스, 첫 관측은 상태만 잡고 무음
- 봉 마감 (TF별 설정)
- 도형 근접 (0.2% 진입 / 0.3% 이탈) — 한 번 울리면 그 도형의 알림이 스스로 꺼진다
- CHoCH 발생 (자동 ZZ · 커스텀 구조, 기본 OFF) — 첫 관측은 무음.
  **보고 있는 화면과 무관하게 TF마다 따로 감시한다** (RSI 알림과 같은 방식, 2026-09-02).
  감시할 TF는 지표 메뉴의 `CHoCH 알림 타임프레임`(`zz.alert_tfs` / `struct.alert_tfs`, 기본 전 TF).
  커스텀 구조는 그 구조가 🔔 + 자동 이어그리기를 둘 다 켰을 때만 울린다
- 포지션 종료 (롱·숏 독립)
- 설정: NotificationMenu (7TF × RSI OB/OS · 봉마감)

---

## 실시간 연결
- Binance → 백엔드: User Data Stream WebSocket (`orderWatcher.js`)
- 백엔드 → 프론트: pushService WebSocket (`ws://localhost:3002`)
- UDS가 조용하거나 끊기면 폴링(30초) + watchAccount(3초) + reconcile(60초)이 메운다
- 시세 스트림 경로는 `/market/ws/...`

---

## 실행
- 백엔드: 포트 3002 (`cd backend && node server.js`)
- 프론트엔드: 포트 5174 (`cd frontend && npm run dev`)
- 한번에: `start.bat`
