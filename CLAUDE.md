# CLAUDE.md

## 읽지 않아도 되는 폴더
- `backend/node_modules/`
- `frontend/node_modules/`
- `frontend/public/`
- `frontend/dist/`

## 사용자 작성 파일 구조

### 백엔드 (`backend/`)
```
backend/
├── server.js                  ← Express 앱 설정 + 시작 + 그레이스풀 셧다운
├── routes/
│   ├── balance.js             ← GET /api/balance
│   ├── position.js            ← GET /api/position → { long, short, pending, scaleInOrders, funding }
│   ├── order.js               ← POST /api/order (진입주문 + TP/SL 자동등록, 일일 손실 가드) / PATCH /api/order (미체결 TP/SL 수정)
│   ├── orders.js              ← DELETE /api/orders (전체 미체결 취소)
│   ├── close.js               ← POST /api/close (전량: TP/SL+SCALE_IN 취소 후 시장가 / 부분: 분할TP 비율 재등록)
│   ├── tpsl.js                ← GET /api/tpsl → { long: { tp, sl, splitTps }, short: { tp, sl, splitTps } }
│   │                             PUT /api/tpsl + POST/DELETE /api/tpsl/split (분할 TP)
│   ├── scalein.js             ← POST/DELETE /api/scale-in (추가 진입 — scaleInOrders는 position에서 반환)
│   ├── leverage.js            ← POST /api/leverage (레버리지 즉시 변경, 1~125)
│   ├── stats.js               ← GET /api/stats?startTime= (거래 통계: 승률, PnL, 수수료, 펀딩비) + statsCache 사용
│   ├── dailyloss.js           ← GET /api/daily-loss (총자본 4% 한도, UTC 0시 리셋) + checkDailyLoss() export
│   ├── indicatorparams.js     ← GET/POST /api/indicator-params (보조지표 파라미터 영속화)
│   ├── health.js              ← GET /api/health (서버 상태 + API 키 등록 여부)
│   └── sr.js                  ← GET /api/sr-levels (KDE 캐시 반환)
├── services/
│   ├── binanceClient.js       ← sign(), binance(), roundPrice(), placeTPSL(), checkExistingTPSL(), syncServerTime()
│   ├── orderWatcher.js        ← Binance User Data Stream (WebSocket 체결 감지) + reconcileWithBinance(60초)
│   ├── recoveryService.js     ← 서버 재시작 시 미체결/체결 주문 복구
│   ├── pushService.js         ← 프론트엔드 WebSocket 실시간 푸시 (update/alert)
│   ├── statsCache.js          ← /api/stats 캐시 상태 공유 (orderWatcher가 체결 시 invalidate)
│   └── srService.js           ← KDE.py 실행(15분 주기) + 캐시
├── store/
│   ├── pendingOrders.js       ← PendingOrderStore 클래스 (Map + 비동기 debounce 저장, 7일 자동 정리)
│   ├── indicatorParamsStore.js ← 보조지표 파라미터 파일 영속화 (indicator_params.json)
│   └── tradeLog.js            ← 체결/TP/SL 이벤트 로그 trade_log.json (최대 1000건)
├── middleware/
│   └── validate.js            ← POST /api/order 입력 검증
├── utils/
│   └── side.js                ← 헷지모드 side 매핑 헬퍼 (sideToPosition/positionToSide/closeToPosition/positionToClose)
├── .env                       ← API 키
└── package.json
```

### 프론트엔드 (`frontend/src/`)
```
frontend/src/
├── constants.js               ← DARK/LIGHT 테마, SIDEBAR_W, M, HIT, MIN_QTY, QTY_STEP, VOL_H, VOL_GAP,
│                                 API_BASE(localhost:3002), BN_PUBLIC, BN_WS(demo-fstream), INTERVALS, RSI_H, RSI_GAP,
│                                 POLLING(폴링 주기 상수), CANVAS_C(캔버스 색상 토큰: BULL/BEAR/AXIS/XTICK/YTICK)
├── ThemeContext.jsx           ← ThemeProvider + useTheme() — 다크/라이트 전환 (localStorage 동기화)
├── store/
│   ├── index.js               ← Zustand 스토어 조립(4개 slice 통합) — `useStore` export
│   ├── serverSlice.js         ← 서버 상태: balance/position/tpsl/liveClose + refetch 콜백
│   │                             tpsl 초기값: { long: { tp, sl, splitTps:[] }, short: { tp, sl, splitTps:[] } }
│   ├── settingsSlice.js       ← 설정(localStorage 동기화): riskPct/leverage/interval_/indicators
│   │                             riskPct/leverage 변경 시 800ms debounce 후 pending 주문 자동 재등록
│   ├── uiSlice.js             ← UI/드로잉/드래그 상태: drawing/drawMode/orderStatus/criticalAlert/selectedBox/opacityPopup/dragTpsl/dragScaleIn/dragSplitTp
│   └── orderSlice.js          ← 주문 액션: executeOrder/saveTpsl/scaleIn/cancelScaleIn/moveScaleIn/
│                                 addSplitTp/cancelSplitTp/moveSplitTp/closePosition/
│                                 updatePendingTpsl/replacePendingOrder/deleteBox 등
├── utils/
│   ├── calc.js                ← calcPosition() — 리스크 기반 수량 계산
│   ├── format.js              ← calcRR() 등 포맷 유틸
│   ├── hitTest.js             ← distToSeg(), findHitLine() — 선분 히트 테스트
│   ├── coordUtils.js          ← idxToTimestamp(미래 영역 외삽), getCandleMs()
│   └── side.js                ← 헷지모드 side 매핑 헬퍼 (sideToPosition/positionToSide/closeToPosition/positionToClose/isLongToPosition/isLongToSide)
├── api/
│   └── client.js              ← api(method, path, body) — fetch 래퍼
├── hooks/
│   ├── useCandles.js          ← REST 1500봉 로드 + WebSocket 실시간 업데이트
│   ├── useRealtimeData.js     ← 백엔드 WebSocket 연결 (체결/TP·SL/포지션 즉시 반영), 5초 재연결
│   ├── useBalance.js          ← USDT 잔고 조회 (폴링)
│   ├── usePosition.js         ← 포지션(long/short) + pending 주문 + scaleInOrders (30초 폴링, WS 보완)
│   ├── usePositionFlags.js    ← derivePositionFlags(position) — hasLong/hasShort/hasPos/hasBoth/hasPending/drawLocked 파생
│   ├── useTpsl.js             ← TP/SL + splitTps 조회 (60초 폴링, hasPos일 때만) — long/short 각각
│   ├── useDailyLoss.js        ← 일일 손실 조회 (1분 폴링) — walletBalance/todayPnl/limit/remaining
│   ├── useOrderFlow.js        ← 스토어 주문 액션 재-export 래퍼 (모든 로직은 orderSlice에 정의)
│   ├── useStats.js            ← 거래 통계 조회 (/api/stats, 날짜 필터)
│   ├── useMarketInfo.js       ← 펀딩비(1분 폴링) + 펀딩 카운트다운 + 공포·탐욕 지수
│   ├── useChartSize.js        ← ResizeObserver로 차트 컨테이너 크기 추적
│   ├── useSRLevels.js         ← S/R 레벨 조회 (4시간 폴링)
│   ├── useRSI.js              ← RSI(14) 계산 (Wilder's smoothing, candles 기반)
│   ├── useFVG.js              ← FVG(Fair Value Gap) 검출 (최근 400캔들, 50% 이상 채워지면 소멸)
│   ├── useOrderBlock.js       ← 오더블록 검출 (BOS 기반 스윙 탐지, 최근 500캔들)
│   ├── useEMA.js              ← 다중 EMA 계산 (id/period/color/enabled 속성, useMemo 캐시)
│   ├── useAlertMonitor.js     ← 타임프레임별 RSI 알람 (5m/15m/1h/4h/1d WebSocket 감시)
│   │                             + 봉 마감 알림 + 히스테리시스 쿨다운 적용
│   ├── useToast.js            ← 토스트 알림 — addToast(30초 자동닫힘) / addLineAlert(sticky, 3초 소리 반복)
│   ├── useTrendLineAlert.js   ← 추세선/채널/원 근접 알림 (0.2% 이내, 히스테리시스 0.3%)
│   ├── usePositionCloseAlert.js ← 포지션 종료 감지 → sticky 알림 (롱/숏 각각 독립 추적)
│   ├── useNotificationSettings.js ← 타임프레임별 알림 설정 (RSI OB/OS, 봉마감) localStorage 동기화
│   ├── useTrendLines.js       ← 트렌드 라인 + 채널 + 원 상태 (내부적으로 useDrawableStore 3개 사용)
│   ├── useDrawableStore.js    ← 제네릭 도형 스토어 (localStorage 영속화, 공통 필드 id/opacity/locked/alert)
│   ├── useStructures.js       ← 수동 구조 도형 스토어 (useDrawableStore("structures")) + 그리기/편집 액션
│   │                             points 배열 변형은 전부 normalizeStructurePoints를 거쳐 고/저 교대 유지
│   ├── useIndicatorParams.js  ← 지표 파라미터 로드/저장 (서버 /api/indicator-params, INDICATOR_DEFAULTS 기본값 병합)
│   ├── useShortcutSettings.js ← 단축키 커스텀 설정 (DEFAULT_SHORTCUTS + localStorage "keyboard_shortcuts")
│   ├── useKeyboardShortcuts.js ← 단축키 글로벌 핸들러 (ESC/Delete/박스·선택·알람·잠금·투명도·TF 전환)
│   ├── useChartRenderer.js    ← D3 캔들 렌더링 + 뷰포트 도메인 관리
│   │                             redrawCanvas(메인), redrawVolume(볼륨 캔버스), redrawRSI(RSI 캔버스) 분리
│   ├── useChartInteraction.js ← 마우스/휠 이벤트 핸들러 (cursorRules + hitDetection 활용)
│   │                             채널/원 그리기 및 드래그 포함, d3 의존성 없음
│   ├── useCrosshair.js        ← 크로스헤어 (SVG DOM 직접 조작, 메인+RSI 패널 연동)
│   ├── useRsiResize.js        ← RSI 패널 높이 드래그 조절 (localStorage 저장, 50~300px)
│   ├── useVolResize.js        ← 거래량 패널 높이 드래그 조절 (localStorage 저장, 40~200px)
│   └── useHealth.js           ← 서버 헬스 체크
├── chart/
│   ├── candleRenderer.js      ← renderCandles() (캔들+축+오버레이 호출)
│   │                             renderVolumeCanvas/renderRSICanvas는 각 파일에서 re-export
│   ├── canvasUtils.js         ← initCanvas(DPR 대응), withClip(클리핑 헬퍼), getVisibleRange(가시 인덱스)
│   ├── overlayRenderers.js    ← renderFVG, renderOrderBlock, renderSRLines, renderEMA,
│   │                             renderStructureZigzag (전부 캔버스 렌더)
│   ├── structureZigzag.js     ← computeStructureZigzag() — ZZ 지표 계산 (훅 아님, 순수 함수)
│   │                             유일하게 렌더 경로에서 계산되는 지표 — 틱마다 라이브 봉 반영
│   │                             forward-only 누적 상태(모듈 레벨 _st) — 기록은 추가만, 제거 없음
│   ├── deriveStructure.js     ← deriveStructure() / normalizeStructurePoints() — 수동 구조용 순수 함수
│   │                             꼭짓점 배열 → 세그먼트 + CHoCH. 누적 상태 없이 매번 전체 재계산
│   ├── volumeRenderer.js      ← renderVolumeCanvas (모듈 레벨 _volMap 재사용)
│   ├── rsiRenderer.js         ← renderRSICanvas
│   ├── cursorRules.js         ← CURSOR_RULES 배열, getCursor(ctx) — 커서 결정 로직
│   ├── hitDetection.js        ← buildHitChain, findHitChannel, findHitCircle, snapToOHLC, lineXY, channelXYs
│   ├── scales.js              ← getScales(), tsToIdx() — xScale/yScale 생성 + 타임스탬프→인덱스 변환
│   └── dragStateMachine.js    ← DRAG_HANDLERS 테이블
│                                 박스: draw/pan/entry/tp/sl/pos_tp/pos_sl/scale_in/split_tp
│                                 트렌드라인: line_ep/line_move
│                                 채널: channel_ep/channel_move/channel_mid_offset/channel_mirror_ep
│                                 원: circle_move/circle_radius
├── components/
│   ├── ChartArea.jsx          ← 차트 전체 영역 조합 (hooks + ChartSvg + RSI/Volume 패널 + LineOpacityPopup)
│   ├── TopBar.jsx             ← 봉 선택, 캔들 마감 카운트다운 + 현재가, 드로잉/라인/채널/원 모드 버튼,
│   │                             로그 스케일 토글, 지표 메뉴, 알림 메뉴, 단축키 메뉴, 테마 토글
│   ├── IndicatorMenu.jsx      ← 보조지표 온/오프 + 파라미터 설정 (Volume/RSI/S·R/OB/FVG/EMA/ZZ/Custom ZZ)
│   │                             EmaSettingsPanel: EMA 다중 항목 (기간/색상/표시 토글/추가/초기화)
│   │                             StructTfPanel: Custom ZZ 표시 타임프레임 다중 선택 (struct.tfs, 기본 1h)
│   ├── NotificationMenu.jsx   ← 타임프레임별 알림 설정 체크박스 (7TF × RSI OB/OS/봉마감)
│   ├── ShortcutMenu.jsx       ← 단축키 커스텀 설정 UI (녹음 모드로 각 action 키 재바인딩 + 초기화)
│   ├── Toast.jsx              ← 토스트 알림 컴포넌트 (일반: 금색, sticky: 빨강 + 확인 버튼)
│   ├── Slider.jsx             ← 리스크/레버리지 슬라이더
│   ├── Divider.jsx            ← 구분선
│   ├── StatusAlert.jsx        ← 주문/TP·SL 결과 알림 배너 (성공/에러)
│   ├── Chart/
│   │   ├── ChartSvg.jsx           ← SVG 전체 레이어 조합 (채널/원 오버레이 포함)
│   │   ├── BoxOverlay.jsx         ← BoxOverlay, DrawingCurrent, BoxLabels SVG 컴포넌트
│   │   ├── PositionLines.jsx      ← 헷지모드: 롱/숏 포지션 각각 진입/TP/SL/분할TP/추가진입 수평선 (드래그 핸들)
│   │   ├── TrendLines.jsx         ← 트렌드 라인 SVG (선택 시 끝점 핸들)
│   │   ├── Channels.jsx           ← 채널 SVG (메인선+미러선+채우기, 알림 글로우, 선택 핸들)
│   │   ├── Circles.jsx            ← 원 SVG (채우기+테두리, 알림 아이콘, 선택 핸들)
│   │   ├── Structures.jsx         ← 수동 구조 SVG (지그재그 폴리라인 + CHoCH 마크 + 꼭짓점 핸들)
│   │   │                             liveClose를 자체 구독 — ChartArea가 구독하면 틱마다 전체 리렌더
│   │   └── LineOpacityPopup.jsx   ← 트렌드라인/채널/원 투명도(0.25~1.0)·잠금·알림 설정 팝업
│   │                                  ※ FVG/OB/SR/EMA는 SVG가 아닌 `overlayRenderers.js`로 캔버스 렌더
│   │                                  ※ Volume/RSI 패널은 `volumeRenderer.js`/`rsiRenderer.js` (캔버스) 사용
│   └── Sidebar/
│       ├── SidebarPanel.jsx   ← 사이드바 전체 패널 조합 + 레버리지 즉시 변경 UI + 일일 손실 한도 표시
│       │                         (포지션 보유 중 레버리지 감소 차단, 확인 패널 표시)
│       │                         useShallow 셀렉터로 liveClose 틱 등 무관 리렌더 차단
│       │                         derivePositionFlags 호출로 hasLong/hasBoth/hasPending 계산
│       │                         헷지모드: 양쪽 포지션 모두 있거나 drawing.orderId 있을 때 플랜 버튼 잠금
│       │                         아코디언 상태(stats/dailyLoss/settings) localStorage 영속화
│       ├── BalanceCard.jsx    ← 잔고 표시 카드
│       ├── MarketInfoCard.jsx ← 펀딩비(카운트다운 포함) + 공포·탐욕 지수
│       ├── PositionCard.jsx   ← 헷지모드: LONG/SHORT 각각 PositionCard 렌더 (시장가청산·추가진입·분할TP 아코디언 내장)
│       │                         시장가 청산: 슬라이더(0~100%) → 확인 버튼 → ✓ 확인 / ✕ 취소 인라인 단계
│       │                         아코디언 펼침 상태 localStorage `accordion_pos_{LONG|SHORT}` 영속화
│       │                         PendingCard: 포지션 없을 때만 표시 (현재 SidebarPanel에서 미사용)
│       ├── PlanCard.jsx       ← 드로잉 플랜 카드 + OrphanPendingCard
│       ├── ScaleInCard.jsx    ← 추가 진입 카드 (LIMIT/MARKET, 가격 방향 검증) — PositionCard 아코디언 내 embedded
│       ├── SplitTPCard.jsx    ← 분할 TP 카드 (지정가, 잔여 수량 표시) — PositionCard 아코디언 내 embedded
│       └── StatsCard.jsx      ← 거래 통계 카드 (날짜 필터, 승률/PnL/수수료/펀딩비)
├── App.jsx                    ← 메인 컴포넌트 — hooks 조합 + TopBar/SidebarPanel/ChartArea 조립
│                                 derivePositionFlags로 hasLong/hasShort/hasPos/hasBoth/hasPending/drawLocked 파생
│                                 sidebarOpen/isLog는 App 로컬 상태 (localStorage 동기화)
├── main.jsx                   ← React 진입점
└── index.css                  ← 전역 리셋 (overflow:hidden) + @keyframes toastIn
```

### 기타 파일
- `기타/KDE.py` — S/R 레벨 계산용 Python 스크립트 (srService가 15분 주기로 실행)
- `start.bat` — 백엔드·프론트엔드 동시 실행

## 핵심 설계

### 헷지모드 (Hedge Mode)
- Binance Futures 헷지 모드 전제: LONG/SHORT 포지션이 동시에 존재 가능
- **position API 응답**: `{ long, short, pending, scaleInOrders, funding }`
  - `long`/`short`: 각각 독립 포지션 객체 (size/entryPrice/unrealizedPnl/leverage/liquidationPrice) 또는 null
  - `pending`: `{ long, short }` 각각 독립 — 진입 LIMIT 주문이 사이드별로 1건씩 존재 가능
  - `scaleInOrders`: BUY side = LONG 추가진입, SELL side = SHORT 추가진입
- **tpsl API 응답**: `{ long: { tp, sl, splitTps }, short: { tp, sl, splitTps } }`
  - `splitTps` 사이드 분류: SELL = 롱 청산, BUY = 숏 청산
- **side 매핑 헬퍼** (`utils/side.js` / `backend/utils/side.js`):
  - `sideToPosition("BUY"→"LONG")`, `positionToSide("LONG"→"BUY")`
  - `closeToPosition("SELL"→"LONG")`, `positionToClose("LONG"→"SELL")`
  - 프론트엔드 추가: `isLongToPosition(bool)`, `isLongToSide(bool)`
- **포지션 플래그 파생**: `derivePositionFlags(position)` (`hooks/usePositionFlags.js`)
  - `hasLong`/`hasShort`/`hasPos`/`hasBoth`/`longPendingExists`/`shortPendingExists`/`hasPending`/`drawLocked`
  - `drawLocked`: 양쪽 모두 포지션 or pending → 새 박스 그리기 차단
- **PositionCard**: 롱·숏 각각 별개 카드로 렌더, ScaleInCard·SplitTPCard는 아코디언으로 내장
- **saveTpsl**: `dragSide` 또는 현재 활성 포지션 사이드로 어느 쪽 TP/SL을 수정할지 결정
- **레버리지 변경 가드** (`backend/routes/order.js`): 반대쪽 포지션 존재 시 레버리지 변경 생략 → 기존 포지션 레버리지 보호
- **부분 청산 분할 TP 재등록** (`backend/routes/close.js`): partial 청산 시 해당 사이드 SPLIT_TP만 취소 → 시장가 청산 → 잔여 비율로 LIMIT 재등록 (롤백 안전망 포함)

### 글로벌 상태 관리 (Zustand Store)
- `store/index.js`가 4개 slice를 조립 (`createServerSlice`/`createSettingsSlice`/`createUiSlice`/`createOrderSlice`)
- **serverSlice**: balance, position, tpsl, liveClose, tpslSaving + 폴링 훅용 refetch 콜백(`_refetchBal`/`_refetchPos`/`_refetchTpsl`)
- **settingsSlice**: riskPct, leverage, interval_, indicators (localStorage 동기화) — riskPct/leverage 변경 시 800ms debounce 후 `replacePendingOrder` 자동 호출
- **uiSlice**: drawing, drawMode, orderStatus, criticalAlert, selectedBox, opacityPopup, 드래그 상태(dragTpsl/dragScaleIn/dragSplitTp) — drawing은 200ms debounce localStorage 영속화
- **orderSlice**: 모든 주문 액션 (executeOrder/saveTpsl/scaleIn/cancelScaleIn/moveScaleIn/addSplitTp/cancelSplitTp/moveSplitTp/closePosition/updatePendingTpsl/replacePendingOrder/deleteBox) + 일일 손실 한도 가드 + side 매핑 헬퍼 사용
- `useOrderFlow.js`는 orderSlice 액션을 컴포넌트에서 편리하게 사용하기 위한 재-export 래퍼
- `SidebarPanel`·`ChartArea`는 `useShallow` 셀렉터로 구독 — 무관 상태 변경 시 리렌더 차단

### 주문 상태 흐름 (pendingOrders store)
```
WATCHING → FILLED → TPSL_PLACED | TPSL_PARTIAL | TPSL_MISSING
SCALE_IN  (추가 진입 지정가 — 체결/취소 시 store에서 제거)
SPLIT_TP  (분할 TP 지정가 reduceOnly — 체결/취소 시 store에서 제거)
```
- 포지션 종료 시: SCALE_IN은 수동 청산 시 즉시 취소, TP/SL 자연 체결 시 reconcile(60초) 내 취소
- 포지션 종료 시: SPLIT_TP는 Binance가 reduceOnly 주문 자동 취소 → UDS CANCELED 수신 시 제거
- store 파일은 load() 시 7일 초과 항목 자동 정리

### 일일 손실 한도
- **한도**: 당일 시작 시점 총자본(walletBalance − todayPnl)의 4%
- **리셋**: UTC 0시 기준 (Binance income API의 REALIZED_PNL 합산)
- **주문 차단**: `routes/dailyloss.js::checkDailyLoss()`를 `POST /api/order` 앞단에서 호출
- **UI 가드**: `orderSlice.executeOrder`가 `/api/daily-loss` 조회 후 remaining ≤ 0이면 주문 진행 차단 후 에러 상태 알림
- **표시**: SidebarPanel 상단 아코디언(`dailyLossOpen`)에 오늘 손익 / 잔여 한도 표시 (useDailyLoss 1분 폴링)

### 드래그 시스템
- `dragRef.current.type`으로 현재 드래그 타입 관리
- `DRAG_HANDLERS[type].onMove()` / `.onUp()` 호출로 분기 (if 체인 없음)
- 박스 타입: `draw`, `pan`, `entry`, `tp`, `sl`, `pos_tp`, `pos_sl`, `scale_in`, `split_tp`
- **박스 그리기 방향**: 클릭점=진입가, 드래그 끝=손절가 기준 / 롱=아래로 드래그, 숏=위로 드래그 / TP는 SL 거리의 2배 자동 계산
- 트렌드 라인 타입: `line_ep` (끝점 드래그), `line_move` (몸통 드래그)
- 채널 타입: `channel_ep` (끝점), `channel_move` (몸통), `channel_mid_offset` (중간 핸들로 양쪽 offset 동시 조절), `channel_mirror_ep` (미러선 끝점)
- 원 타입: `circle_move` (이동), `circle_radius` (반지름 조절)
- 수동 구조 타입: `struct_point` (꼭짓점 이동 — 봉 꼬리에 스냅, onUp에서만 정규화.
  실제로 움직였을 때만 `drag.moved`로 부분 선택 해제 → 제자리 클릭은 "선택"으로 남는다)
- 포지션 오버레이 타입: `scale_in`, `split_tp`
- `useChartInteraction.js`의 `buildHitChain`이 onMouseDown 히트 우선순위를 순서대로 처리

### 드로잉 도구 (TopBar 버튼 + 단축키)
- **박스 모드**: 진입/TP/SL 박스 그리기 (기본 `q`)
- **라인 모드**: 트렌드 라인 (2점 클릭)
- **채널 모드**: 평행 채널 (3클릭: 시작→끝→폭 확정)
- **원 모드**: 원 (2클릭: 중심→반지름)
- **구조 모드**: 수동 시장 구조 (기본 `s`) — 클릭 반복으로 고/저점 찍기, 우클릭·더블클릭 확정
- `Escape`: 그리기 취소 / 선택 해제
- `Delete`: 선택된 도형 삭제 (수동 구조는 꼭짓점/선분을 클릭해 뒀으면 **그 부분만** 삭제)
- `a`: 선택된 도형 알람 토글
- `l`: 선택된 도형 잠금 토글
- `[` / `]`: 선택된 도형 투명도 ±0.25 조절 (0.25~1.0)
- 숫자키 `1`~`6`: 타임프레임 전환 (5m/15m/1h/4h/1d/1w)
- ※ 모든 단축키는 **ShortcutMenu에서 커스텀 가능** (localStorage `keyboard_shortcuts`)

### 도형 공통 속성 (트렌드라인/채널/원)
- `opacity`: 0.25~1.0 (0.25 단위)
- `locked`: true 시 드래그 이동 불가
- `alert`: true 시 근접(0.2%) 감지 → sticky 토스트 알림 + 3초마다 소리 반복
- 공통 저장 로직은 `useDrawableStore(storageKey)` 제네릭 훅으로 일원화 (add/update/remove/replaceAll)

### ⚠️ 수동 구조 — 사용자 확정 사양 (임의 변경 금지)

**2026-08-12 확정, 실사용 테스트 통과.** 아래는 전부 사용자가 직접 요구했거나 실제 버그를
겪고 함께 고쳐서 확정한 동작이다. "이상해 보인다 / 더 정확할 것 같다"는 판단으로 되돌리지 말 것.
바꿔야 할 이유가 생기면 **먼저 사용자에게 확인**할 것. 코드 각 파일 상단에 같은 내용이
`[1]`~`[6]` / `[R1]`~`[R5]` / `[S1]`~`[S5]` 번호로 달려 있다.

| 결정 | 되돌리면 재발하는 문제 |
|---|---|
| CHoCH는 실제 돌파로 bias가 선 상태에서만 (ZZ·Pine도 동일 규칙) | 상승 지속(BOS)에도 CHoCH 오탐. 셋 중 하나만 되돌리면 지표끼리 결과가 어긋남 |
| 마크가 적게 뜬다고 규칙 완화 금지 | 사용자 기준은 "알고리즘대로면 OK", 빈도가 아님 |
| BOS 표시 안 함 (제안 거절됨) | 화면이 복잡해짐 |
| CHoCH 선 끝 = 선분 교차점(`crossT`), 캔들 조회 금지 | 가로선이 지그재그를 지나 오른쪽으로 삐져나옴 |
| 라이브 판정 = 꼬리 기준 + 구간 극값(래치) | 종가 기준이면 꼬리 돌파를 놓치고, 되돌아올 때 마크가 사라짐 |
| `deriveStructure`에 `candlesRef.current` 전달 | React candles는 봉마감 때만 갱신 → 라이브가 조용히 죽음 |
| 라이브 레그는 가장 최근 구조 1개만 | 과거 구조가 화면 끝까지 점선을 뻗음 |
| CHoCH 마크 항상 100% 불투명 | 구조를 흐리게 하면 마크까지 흐려짐 |
| 신규 구조 기본 투명도 0.5 | — |
| `STRUCT_SNAP_BARS = 1` | 마그넷이 과하게 강해짐 (3에서 낮춘 값) |
| 전 TF 공유 (storageKey에 TF 없음) — **저장은 TF별로 쪼개지 않는다** | TF별 분리는 기능 후퇴 |
| 표시 TF 필터(`struct.tfs`)는 **표시 전용**, 기본 1h (2026-08-12 사용자 요청) | 저장까지 TF로 나누면 위 항목과 충돌 |
| 선분 중간 꼭짓점 삽입 없음 | 교대 구조상 동작 불가 — "빠진 기능"이 아님 |
| 끝점 클릭 = 연장/흡수로 항상 하나의 구조 | 쪼개지면 경계 CHoCH 유실 |
| 부분 삭제는 클릭 → `Delete` (Shift+클릭 즉시 삭제 아님) | 사용자가 명시적으로 바꾼 조작 |
| 선분 삭제 = 이어붙이기(끝점 하나 제거), 쪼개기 아님 | 쪼개면 경계 CHoCH 유실 (위와 같은 이유) |

### 수동 구조 (Structure) — 손으로 그리고 CHoCH는 자동
- **목적**: 자동 ZZ가 못 잡는 구조를 직접 지정. 자동 ZZ와 **공존**하며 `structureZigzag.js`는 건드리지 않는다.
- **데이터**: `{ id, points: [{ t, p, type:"H"|"L" }], opacity, locked }` — localStorage `"structures"`
- **전 TF 공유**: storageKey에 타임프레임이 없고 좌표가 timestamp라 1h에서 그린 구조가 5m/1d에도 뜬다
  (트렌드라인/채널/원과 동일 — `tsToIdx`가 TF별 bar index를 다시 계산)
- **표시 TF 필터**: `indicatorParams.struct.tfs` (중복 선택, 기본 `["1h"]`) — IndicatorMenu ⚙ → StructTfPanel
  - 저장 데이터는 그대로 전 TF 공유다. **어느 TF에서 보여줄지만 거른다**
  - `App.jsx`가 두 값을 구분한다:
    - `structOn`(지표 토글) → **그리기 가능 여부는 이것만 본다.** TF 필터까지 묶으면 지표를 켜 뒀는데도
      구조 버튼이 죽어 있어 고장으로 보인다 (실제로 그렇게 보고됨)
    - `showStruct = structOn && tfs.includes(현재 TF)` → 렌더 + 히트 판정
  - 표시 대상이 아닌 TF에서 구조 모드로 **진입하면 그 TF가 목록에 자동 추가**된다
    (`ensureStructTf`, TopBar 버튼·`s` 단축키 공통). 안 그러면 방금 그린 게 화면에 안 나온다
  - 목록을 비우면 아무 데도 안 보인다 (패널에서 경고 문구 표시)
  - ⚠ 백엔드 `indicatorParamsStore.DEFAULTS`에 `struct` 키가 없으면 `load()`가 통째로 버려서
    선택이 새로고침마다 `["1h"]`로 돌아간다 — 키 추가 후 **백엔드 재시작 필수**
- **그리기**: TopBar "구조" 버튼(또는 `s`) → 클릭할 때마다 꼭짓점 추가 → 우클릭/더블클릭 확정, ESC 취소
  - 꼭짓점 타입은 직전 점의 반대로 강제되고, `snapToStructurePoint`가 근처 봉의 고가/저가에 스냅
  - 스냅 반경은 `STRUCT_SNAP_BARS`(hitDetection.js) 하나로 관리 — 클릭 배치와 미리보기가
    같은 값을 써야 커서에 보이던 위치와 실제 찍히는 위치가 어긋나지 않는다. 드래그만 0(커서 추종)
- **이어 그리기 / 두 구조 잇기**: 구조 모드에서 **기존 구조의 양 끝 꼭짓점 클릭** = 이어붙이기
  - draft 없을 때 클릭 → `startExtendStruct` (그 구조를 연장, `extendId` 부여 → finishStruct가 update)
  - draft 있을 때 다른 구조의 끝점 클릭 → `mergeStructIntoDraft` (그 구조를 흡수, `mergeIds`에 기록
    → finishStruct가 흡수된 구조를 `store.remove`. 안 지우면 꼭짓점이 두 벌 남아 CHoCH가 겹친다)
  - **왜 필수인가**: 확정 후에는 Shift+클릭(선분 사이 삽입)으로 끝점 뒤에 점을 못 붙인다.
    또 구조를 둘로 쪼개면 `deriveStructure`가 각각 `bias=0`으로 새로 시작해 **경계의 CHoCH가 유실**된다
  - 첫 점(과거 방향) 연장은 draft를 역순 seed — 타입 교대·프리뷰 기준점을 맞추기 위함.
    최종 순서는 `normalizeStructurePoints`가 시간순으로 정렬하므로 draft 순서는 무관
  - 이어 그리는 중에는 원본을 렌더에서 숨기고 draft가 대신 그린다 (CHoCH 포함)
- **편집** (선택 상태에서): 꼭짓점 드래그 이동 / **부분 선택 후 `Delete`로 부분 삭제**
  - 구조를 한 번 클릭해 선택 → 그 안의 **꼭짓점 또는 선분을 클릭**하면 `structPart`에 담긴다
    (`{ kind:"point"|"segment", idx }`, `useStructures`)
  - **색으로 구분**: 구조 전체 선택 = 금색(`#f0b90b`) / 부분 선택 = 파랑(`PALETTE.info` `#60a5fa`).
    "지금 Delete를 누르면 무엇이 지워지는가"가 색으로 보여야 한다는 사용자 요구사항
  - **같은 부분을 다시 클릭하면 부분 선택 해제** → 구조 전체 선택으로 복귀.
    이 토글이 없으면 부분을 고른 뒤 구조 전체 삭제로 돌아갈 방법이 없다
  - `Delete`: `structPart`가 있으면 **그 부분만**, 없으면 구조 전체 삭제
    (`deleteStructSelection` — `drawables.structure.delete`에 연결)
  - **선분 삭제는 "이어붙이기"** (2026-08-12 사용자 확정): 구조를 쪼개지 않고 끝점 하나를 지운다.
    첫 선분이면 앞 끝점, 그 외에는 뒤 끝점 → 끝 선분은 잘려나가고 가운데는 양옆 레그가 합쳐진다.
    **쪼개기(구조 2개로 분리)를 택하지 않은 이유는 [S4]와 같다 — 경계에서 bias가 리셋돼 CHoCH 유실**
  - 삭제로 고점–고점이 인접하면 `normalizeStructurePoints`가 더 극단적인 쪽만 남겨 교대 불변식 유지
    → "그 스윙을 없앤다"가 되어 의미가 성립
  - 꼭짓점이 2개 미만이 되면 구조 자체를 삭제
  - ※ 예전 방식(꼭짓점 `Shift+클릭` 즉시 삭제)은 **사용자 요청으로 제거**됨. 되살리지 말 것
  - ※ 부분 선택은 인덱스라 순서가 바뀌면 낡는다 → 구조 선택 변경 시, 삭제 후,
    **꼭짓점을 실제로 드래그해 옮겼을 때**(`drag.moved`) 자동으로 비운다.
    드래그 없이 눌렀다 뗀 경우는 "클릭 = 선택"이므로 유지해야 한다
  - **선분 중간 삽입은 없다(의도적)**: 고/저 교대 구조라 H–L 사이에 넣는 점은 어느 타입이든
    양옆 중 하나와 겹치고, normalize가 병합해버려 아무 일도 안 일어난다.
    점을 늘리는 경로는 아래 이어 그리기 하나로 통일
- **CHoCH 자동 계산**: `deriveStructure(points)`가 매번 전체를 다시 뽑는 순수 함수
  → **꼭짓점을 옮기면 그 이후 CHoCH가 사라지거나 새로 생긴다. 의도된 동작이다.**
  자동 ZZ의 forward-only 누적 상태는 진행 중 봉 ATR 드리프트를 막으려던 것이라 여기선 불필요
- **자동 ZZ와 판정이 다른 부분**: 자동 ZZ는 structHigh/Low가 NaN일 때 bias를 강제 세팅해서
  H→L→H(상승) 같은 단순 BOS에도 첫 CHoCH가 찍힌다. 수동 구조는 **실제 돌파가 있을 때만** bias를 세운다
- **표시 토글**: IndicatorMenu `struct`("Custom Structure Zigzag") — 자동 ZZ와 **독립**.
  - **OFF면 그리기 자체가 막힌다** (TopBar "구조" 버튼 비활성 + `s` 단축키 무시).
    안 보이는 상태로 그려지면 켤 때 갑자기 나타나 혼란스럽기 때문.
    **단 TF 필터는 버튼을 죽이지 않는다** — 위 "표시 TF 필터" 참고
  - 그리는 도중/선택한 채로 OFF하거나 표시 대상이 아닌 TF로 넘어가면 draft와 선택을 정리한다
    (App.jsx의 showStruct useEffect) 자동 연동은 의도적으로
  넣지 않았다(둘을 나란히 비교하는 용도가 막히므로). OFF일 때는 렌더뿐 아니라
  `ChartArea.visibleStructures`가 히트 판정에서도 빼서, 안 보이는 구조가 클릭에 잡히지 않게 한다
- **투명도**: 신규 구조 기본 0.5 (`STRUCT_DEFAULT_OPACITY`) — 지그재그는 배경처럼 깔리게.
  **CHoCH 마크는 투명도 설정과 무관하게 항상 100%** (`ChochMarks`는 opacity를 받지 않음)
- **진행 중 레그는 구조 하나만 갖는다**: 꼭짓점 timestamp가 가장 최근인 구조(또는 draft) 1개.
  모든 구조가 현재가를 쫓으면 과거 구조도 마지막 꼭짓점에서 화면 오른쪽 끝까지 긴 점선을 뻗어
  엉뚱한 데로 이어지려는 것처럼 보인다. 나머지는 `deriveStructure(points, null)`로 라이브를 끈다
  (확정 CHoCH는 캔들 없이 계산되므로 잃는 게 없다)
- **실시간 + 꼬리 기준 + 래치**: 마지막 꼭짓점 → 현재를 진행 중 레그로 보고 매 틱 판정
  - 판정값은 **마지막 꼭짓점 이후 구간의 최고가/최저가**(종가 아님 — 꼭짓점 스냅과 기준 통일)
  - 구간 극값은 구간이 늘어나도 되돌아가지 않으므로 **한번 뚫으면 가격이 되돌아와도 마크 유지**
    (누적 상태 없이 순수 함수인 채로 래치 성립)
  - 확정분과 구분되게 점선 (`liveSegment`도 점선) — 나중에 그 자리에 꼭짓점을 찍으면 실선이 됨
  - ※ `deriveStructure`에는 **`candlesRef.current`를 넘겨야 한다.** React `candles` state는
    봉마감 때만 갱신돼서 진행 중 봉의 고가/저가가 낡아 있다 (`useCandles.js:29-38`)
- **CHoCH 가로선 끝점 = 레그 선분과 레벨의 교차점**(`crossT`, 선형 보간). 확정·라이브 동일
  - **캔들을 보고 끊으면 안 된다.** 화면에 그려진 건 캔들이 아니라 꼭짓점을 이은 직선이고
    둘은 어긋난다. 고점110→저점85 레그에서 레벨 90이면 직선은 80% 지점에서 지나지만
    실제 가격은 90 위에서 뭉개다 레그 끝에서 깨는 일이 흔하다. 봉 기준으로 끊으면 그 차이만큼
    가로선이 지그재그를 지나 오른쪽으로 삐져나온다 (하락 레그에 잦아 bear 쪽에 몰려 보임)
  - 선분 교차점은 정의상 두 꼭짓점 사이에 들어가므로 어떤 데이터·TF에서도 삐져나오지 않는다
- **스타일**: 자동 ZZ와 동일 (지그재그 `#888888` / CHoCH `#0ecb81`·`#f6465d` 1.5px + 라벨), 렌더만 SVG
- **알림 없음**: `useTrendLineAlert`은 선/채널/원만 대상 → `drawables.structure.toggleAlert`는 no-op,
  LineOpacityPopup에서도 알림 버튼을 숨김

### 보조지표 파라미터 영속화
- 프론트: `useIndicatorParams`가 서버에서 로드 → `INDICATOR_DEFAULTS`와 병합 → 변경 시 debounce 저장
- 백엔드: `indicatorParamsStore`가 `indicator_params.json`에 JSON 영속화
- 대상: RSI(period/OB/OS), FVG(lookback/mitigation), OB(swing/bos), SR(KDE 파라미터), EMA(배열), ZZ(left_bars/use_filter/atr_mult/atr_period/max_choch/show_choch), struct(tfs — 수동 구조 표시 TF)
- ※ 새 지표 추가 시 프론트 `INDICATOR_DEFAULTS`와 백엔드 `indicatorParamsStore.DEFAULTS` **양쪽 모두**에 키 추가 필요 (백엔드 load()가 자기 DEFAULTS 키만 통과시킴)

### 알림 시스템
- **토스트 종류**: 일반(금색 테두리, 30초 자동닫힘) / sticky(빨강 테두리, 확인 버튼 필수)
- **포지션 종료 알림**: 롱/숏 포지션 각각 독립 감지 → 해당 사이드 종료 시 sticky 알림
- **추세선/채널/원 근접 알림**: 0.2% 이내 진입 → sticky, 0.3% 이상 이탈 시 해제 (히스테리시스)
- **RSI 알람** (`useAlertMonitor`): 7개 타임프레임(5m/15m/1h/4h/1d/1w/1M) 독립 WebSocket 감시
  - RSI 과매수(≥70) / 과매도(≤30) — 쿨다운(봉 길이 기준) + 히스테리시스(65/35 복귀 시 해제)
  - 봉 마감: 타임프레임별 개별 설정
- **알림 설정** (`NotificationMenu`): 7TF × (RSI OB/OS, 봉마감) 체크박스
  - `useNotificationSettings`의 병합은 **DEFAULT에 있는 키만 통과** — 제거된 알림 종류가
    localStorage에 남아 있어도 되살아나지 않는다

### 레버리지 변경
- 사이드바 레버리지 슬라이더 조작 → pendingLeverage 임시 저장 → 확인 버튼 클릭 시 적용
- 포지션 보유 중: `POST /api/leverage` 호출 후 스토어 업데이트 (양쪽 포지션 레버리지 중 더 큰 값을 최소값으로, 그 미만으로 감소 차단)
- 포지션 없을 때: API 호출 없이 로컬 값만 변경 (다음 주문 시 적용)
- 진입 주문 시 반대쪽 포지션 존재 시 레버리지 변경 자체를 생략 (`backend/routes/order.js`)

### 캔버스 분리 렌더링
- **메인 캔버스** (`canvasRef`): 캔들 + 오버레이 (FVG/OB/SR/EMA) — 틱마다 RAF로 재드로우
- **거래량 캔버스** (`volCanvasRef`): 거래량 바 — 틱 업데이트에서 제외, pan/zoom/마감 시만 갱신
- **RSI 캔버스** (`rsiCanvasRef`): RSI 선 — pan/zoom 시 즉시 갱신, 틱 업데이트에서 제외
- pan 중 `overlaysRef._panning = true` 플래그로 FVG/OB/SR/EMA 렌더 스킵 → 성능 최적화
- `canvasUtils.js`: `initCanvas`(DPR 대응), `withClip`(클리핑), `getVisibleRange`(가시 범위) 공통 헬퍼
- `candleRenderer` 압축 모드: 모듈 레벨 `_upMap`/`_dnMap` 재사용으로 매 프레임 GC 할당 제거
- 휠 줌 yDomain 계산: 직접 `for` 루프 (slice + d3.min/max 제거)

### EMA 다중 설정
- `indicatorParams.ema`: `[{ id, period, color, enabled }]` 배열
- `useIndicatorParams.setEmaList(newList)`: 전체 배열 교체 후 서버 저장
- `IndicatorMenu`의 EmaSettingsPanel: 항목별 기간 입력 / 표시 토글 / 추가 / 초기화
- 기본값: EMA10(#888888) / EMA20(#f0b90b) / EMA60(#c084fc)

### 테마 시스템
- `ThemeContext.jsx`의 `ThemeProvider`가 앱 전체를 감쌈
- `useTheme()` 훅으로 `{ theme, isDark, toggle }` 접근
- `constants.js`의 `DARK` / `LIGHT` 객체가 색상 토큰 정의
- localStorage `"theme"` 키로 선택 유지

### 실시간 업데이트 구조
- **Binance → 백엔드**: User Data Stream WebSocket (orderWatcher.js) — demo-fstream.binance.com
- **백엔드 → 프론트엔드**: pushService WebSocket (`ws://localhost:3002`)
- **프론트엔드**: useRealtimeData가 연결 관리, 메시지 타입별 refetch 트리거
- UDS 실패 시: 폴링(30초 간격) + reconcileWithBinance(60초)로 보완

### S/R 레벨 시스템
- `기타/KDE.py`를 백엔드에서 `python KDE.py --json`으로 직접 실행 (15분 주기)
- 캔버스 렌더(`overlayRenderers.js::renderSRLines`): 저항=빨강, 지지=초록, stars 수에 따라 opacity 차등 (4→0.9, 1→0.3)

### 트렌드 라인 / 채널 / 원
- `useTrendLines.js`가 lines/channels/circles를 각각 `useDrawableStore`로 관리 → localStorage 영구 저장
- 트렌드라인: `line_ep`(끝점) / `line_move`(몸통) / Delete로 삭제
- 채널: `channel_ep`(끝점) / `channel_move`(몸통) / `channel_offset`(미러선 폭)
- 원: `circle_move`(이동) / `circle_radius`(반지름)
- 선택된 도형: 금색(#f0b90b) + 핸들 표시

### 보조지표 (프론트엔드 계산, 백엔드 불필요)
- **Volume**: 거래량 캔버스 (가시 범위 maxVol 정규화, useVolResize로 높이 조절)
- **EMA**: 다중 EMA (id/period/color/enabled 속성, useMemo 캐시로 무한루프 방지)
- **FVG**: 3캔들 패턴으로 갭 검출, 중간값 50% 진입 시 소멸
- **오더블록**: 스윙 감지 → BOS 탐지 → 직전 역방향 캔들을 OB로 등록, 미티게이션 시 소멸
- **Structure Zigzag (ZZ)**: `기타/structure_zigzag.pine` 포팅 — 왼쪽 left_bars 봉만 보는 피벗(오른쪽 확인봉 없음),
  ※ **bias 규칙은 Custom Structure Zigzag(deriveStructure.js)와 동일하게 통일됨 (2026-08-12)**
    — 실제 돌파가 있을 때만 bias를 세우고, 돌파하면 CHoCH 여부와 무관하게 bias는 항상 갱신한다.
    `기타/structure_zigzag.pine`도 같이 수정했으므로 **한쪽만 고치면 트레이딩뷰와 결과가 어긋난다.**
  꼬리(고가/저가) 기준 판정, Wilder ATR × atr_mult 미만 스윙은 노이즈로 제거,
  꼭짓점을 회색 지그재그로 연결 + 구조 고/저점 돌파 시 CHoCH 마크
  CHoCH 마크 스타일은 수동 구조(Structures.jsx)와 동일 (BULL_DARK/BEAR_DARK 실선 1.5px + 라벨)
  ※ 구 Market Structure(MS) 지표는 ZZ가 대체하여 제거됨 (2026-08-12)
  ※ **다른 지표와 달리 훅이 아니라 `chart/structureZigzag.js`의 순수 함수** — 원본 Pine처럼 진행 중 봉에서
    실시간 판정하려면 틱 RAF가 도는 캔버스 렌더 경로에서 candlesRef로 계산해야 하기 때문
    (useCandles는 틱을 React 상태에 반영하지 않으므로 훅으로는 봉 마감 시에만 계산됨)
  ※ **실시간 + repaint 없음** — 매 틱 전체 재계산이 아니라 forward-only 누적 상태로 진행,
    한번 찍힌 CHoCH/세그먼트는 제거하지 않음. 진행 중 봉 고가는 단조 증가·저가는 단조 감소이므로
    같은 봉을 매 틱 다시 step() 해도 멱등(값 그대로면 no-op, 갱신됐으면 꼭짓점 연장만)
    → 전체 재계산 시 진행 중 봉의 ATR이 커지며 노이즈 필터 임계값이 올라가 직전 틱의 CHoCH가
      탈락·소멸하는 문제를 이 구조로 차단 (원본 Pine은 이 케이스에서 마크가 사라짐)
  ※ 상태 초기화 조건: 캔들 배열 교체(TF 전환) / 파라미터 변경 / candles[0] 변경(버퍼 shift·재로드)
  ※ **표시 범위 옵션 없음 — 로드된 캔들 전체를 잇는다** (2026-08-12 `scan_from` 제거).
    "성능상 범위를 제한하는 게 낫다"며 되살리지 말 것 — 최초 1회만 전 구간을 훑고 이후는 증분이다
  ※ CHoCH 개수는 `getZzChochTotal()`로 노출 — IndicatorMenu가 "검출된 CHoCH N개" 표시와
    `max_choch` 슬라이더 상한(1~N)에 쓴다. ZZ 계산이 캔버스 렌더 경로에만 있어 React 상태로
    올라오지 않으므로, 메뉴 여는 시점에 모듈 상태를 직접 읽는다(열려 있는 동안은 갱신 안 됨)
- **RSI 패널**: Wilder's smoothing, 별도 캔버스, 드래그로 높이 조절 (useRsiResize)
  ※ RSI 다이버전스 지표는 제거됨 (2026-08-12) — 지표/알림/파라미터(`div`)/`DivergenceLines.jsx`/
    `utils/rsi.js::buildRSIArray` 전부 삭제. RSI 패널에는 더 이상 SVG 오버레이가 없다

### 체결 감지
- **LIMIT 주문**: User Data Stream WebSocket (`orderWatcher.js`)으로 즉시 감지
  → `store`에 WATCHING 상태 → FILLED 이벤트 수신 시 `placeTPSL()` 실행
- **MARKET 주문**: 즉시 체결 → `placeTPSL()` 바로 실행
- **SCALE_IN/SPLIT_TP 체결**: store 제거 후 position/tpsl refetch 트리거
- 체결 발생 시 `statsCache.invalidateCache()` 호출 → 다음 /api/stats 요청 시 재계산

### 차트 렌더링
- 캔들: D3 imperative (`renderCandles`) → `canvasRef`에 직접 드로우
- 거래량: D3 imperative (`renderVolumeCanvas`) → `volCanvasRef`에 별도 드로우
- RSI: D3 imperative (`renderRSICanvas`) → `rsiCanvasRef`에 별도 드로우
- FVG/OB/SR/EMA: 캔버스 렌더 (`overlayRenderers.js`)
- 오버레이 (박스/포지션 라인/트렌드라인/채널/원/수동 구조): React SVG (`ChartSvg` 내)
- `useChartRenderer.js`의 `forceUpdate`(renderTick)로 캔버스 렌더 후 React 오버레이 동기화
- pan 중: `redrawChart()`가 redrawCanvas+redrawVolume+redrawRSI+forceUpdate 동시 호출

## 실행
- 백엔드: 포트 3002 (`node server.js`)
- 프론트엔드: 포트 5174 (`npm run dev`)
- 한번에 실행: `start.bat`
