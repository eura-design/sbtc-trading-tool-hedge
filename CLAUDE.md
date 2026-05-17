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
│   ├── useMarketStructure.js  ← ICT 시장 구조 (BOS/CHoCH) — protected swing 로직, 봉마감 기준 돌파
│   ├── useEMA.js              ← 다중 EMA 계산 (id/period/color/enabled 속성, useMemo 캐시)
│   ├── useAlertMonitor.js     ← 타임프레임별 RSI 알람 (5m/15m/1h/4h/1d WebSocket 감시)
│   │                             + 다이버전스 봉 마감 시 감지 + 히스테리시스 쿨다운 적용
│   ├── useToast.js            ← 토스트 알림 — addToast(30초 자동닫힘) / addLineAlert(sticky, 3초 소리 반복)
│   ├── useTrendLineAlert.js   ← 추세선/채널/원 근접 알림 (0.2% 이내, 히스테리시스 0.3%)
│   ├── usePositionCloseAlert.js ← 포지션 종료 감지 → sticky 알림 (롱/숏 각각 독립 추적)
│   ├── useNotificationSettings.js ← 타임프레임별 알림 설정 (RSI OB/OS, 다이버전스, 봉마감) localStorage 동기화
│   ├── useTrendLines.js       ← 트렌드 라인 + 채널 + 원 상태 (내부적으로 useDrawableStore 3개 사용)
│   ├── useDrawableStore.js    ← 제네릭 도형 스토어 (localStorage 영속화, 공통 필드 id/opacity/locked/alert)
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
│   ├── overlayRenderers.js    ← renderFVG, renderOrderBlock, renderSRLines, renderEMA (전부 캔버스 렌더)
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
│   ├── IndicatorMenu.jsx      ← 보조지표 온/오프 + 파라미터 설정 (Volume/RSI/RSI Divergence/S·R/OB/FVG/EMA/MS)
│   │                             EmaSettingsPanel: EMA 다중 항목 (기간/색상/표시 토글/추가/초기화)
│   ├── NotificationMenu.jsx   ← 타임프레임별 알림 설정 체크박스 (5TF × RSI OB/OS/다이버전스/히든다이버전스/봉마감)
│   ├── ShortcutMenu.jsx       ← 단축키 커스텀 설정 UI (녹음 모드로 각 action 키 재바인딩 + 초기화)
│   ├── Toast.jsx              ← 토스트 알림 컴포넌트 (일반: 금색, sticky: 빨강 + 확인 버튼)
│   ├── Slider.jsx             ← 리스크/레버리지 슬라이더
│   ├── Divider.jsx            ← 구분선
│   ├── StatusAlert.jsx        ← 주문/TP·SL 결과 알림 배너 (성공/에러)
│   ├── Chart/
│   │   ├── ChartSvg.jsx           ← SVG 전체 레이어 조합 (채널/원/다이버전스 오버레이 포함)
│   │   ├── BoxOverlay.jsx         ← BoxOverlay, DrawingCurrent, BoxLabels SVG 컴포넌트
│   │   ├── PositionLines.jsx      ← 헷지모드: 롱/숏 포지션 각각 진입/TP/SL/분할TP/추가진입 수평선 (드래그 핸들)
│   │   ├── TrendLines.jsx         ← 트렌드 라인 SVG (선택 시 끝점 핸들)
│   │   ├── Channels.jsx           ← 채널 SVG (메인선+미러선+채우기, 알림 글로우, 선택 핸들)
│   │   ├── Circles.jsx            ← 원 SVG (채우기+테두리, 알림 아이콘, 선택 핸들)
│   │   ├── VolumePanel.jsx        ← 거래량 패널 (별도 캔버스, 가시 범위 기반 maxVol 정규화)
│   │   ├── RSIPanel.jsx           ← RSI(14) 서브패널 (캔버스 렌더, 메인 차트 하단, xScale 공유)
│   │   ├── DivergenceLines.jsx    ← RSI 다이버전스 라인 (RSI 패널 내)
│   │   ├── Confluence.jsx         ← 지지/저항 컨플루언스 표시
│   │   └── LineOpacityPopup.jsx   ← 트렌드라인/채널/원 투명도(0.25~1.0)·잠금·알림 설정 팝업
│   │                                  ※ FVG/OB/SR/EMA는 SVG가 아닌 `overlayRenderers.js`로 캔버스 렌더
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
└── index.css                  ← 전역 리셋 (overflow:hidden)
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
- 포지션 오버레이 타입: `scale_in`, `split_tp`
- `useChartInteraction.js`의 `buildHitChain`이 onMouseDown 히트 우선순위를 순서대로 처리

### 드로잉 도구 (TopBar 버튼 + 단축키)
- **박스 모드**: 진입/TP/SL 박스 그리기 (기본 `q`)
- **라인 모드**: 트렌드 라인 (2점 클릭)
- **채널 모드**: 평행 채널 (3클릭: 시작→끝→폭 확정)
- **원 모드**: 원 (2클릭: 중심→반지름)
- `Escape`: 그리기 취소 / 선택 해제
- `Delete`: 선택된 도형 삭제
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

### 보조지표 파라미터 영속화
- 프론트: `useIndicatorParams`가 서버에서 로드 → `INDICATOR_DEFAULTS`와 병합 → 변경 시 debounce 저장
- 백엔드: `indicatorParamsStore`가 `indicator_params.json`에 JSON 영속화
- 대상: RSI(period/OB/OS), FVG(lookback/mitigation), OB(swing/bos), Divergence(peak_lb/scan), SR(KDE 파라미터), EMA(배열), MS(swing_lb/scan_from/max_display/close_only/show_bos)

### 알림 시스템
- **토스트 종류**: 일반(금색 테두리, 30초 자동닫힘) / sticky(빨강 테두리, 확인 버튼 필수)
- **포지션 종료 알림**: 롱/숏 포지션 각각 독립 감지 → 해당 사이드 종료 시 sticky 알림
- **추세선/채널/원 근접 알림**: 0.2% 이내 진입 → sticky, 0.3% 이상 이탈 시 해제 (히스테리시스)
- **RSI 알람** (`useAlertMonitor`): 6개 타임프레임(5m/15m/1h/4h/1d/1w) 독립 WebSocket 감시
  - RSI 과매수(≥70) / 과매도(≤30) — 쿨다운(봉 길이 기준) + 히스테리시스(65/35 복귀 시 해제)
  - 다이버전스: 봉 마감 시 새로 발생한 것만 알림
  - 봉 마감: 타임프레임별 개별 설정
- **알림 설정** (`NotificationMenu`): 6TF × (RSI OB/OS, 다이버전스, 히든다이버전스, 봉마감) 체크박스

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
- **Market Structure (MS)**: ICT BOS(추세 지속)/CHoCH(추세 전환) — protected swing 로직으로 internal structure 필터링, 봉마감 기준 돌파 감지 (close_only=true)
- **RSI 다이버전스**: RSI 고점/저점과 가격 고점/저점 비교, 일반/히든 불·베어 4종 (App.jsx에서 useMemo로 계산, DivergenceLines로 렌더)
- **RSI 패널**: Wilder's smoothing, 별도 캔버스, 드래그로 높이 조절 (useRsiResize)

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
- 오버레이 (박스/포지션 라인/트렌드라인/채널/원/다이버전스): React SVG (`ChartSvg` 내)
- `useChartRenderer.js`의 `forceUpdate`(renderTick)로 캔버스 렌더 후 React 오버레이 동기화
- pan 중: `redrawChart()`가 redrawCanvas+redrawVolume+redrawRSI+forceUpdate 동시 호출

## 실행
- 백엔드: 포트 3002 (`node server.js`)
- 프론트엔드: 포트 5174 (`npm run dev`)
- 한번에 실행: `start.bat`
