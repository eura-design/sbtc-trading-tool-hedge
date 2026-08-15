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
│   └── health.js              ← GET /api/health (서버 상태 + API 키 등록 여부)
├── services/
│   ├── binanceClient.js       ← sign(), binance(), roundPrice(), placeTPSL(), checkExistingTPSL(), syncServerTime()
│   ├── orderWatcher.js        ← Binance User Data Stream (WebSocket 체결 감지) + reconcileWithBinance(60초)
│   ├── recoveryService.js     ← 서버 재시작 시 미체결/체결 주문 복구
│   ├── entryTime.js           ← 현재 포지션의 **평단 변화 이력**을 userTrades에서 역산 (사이드별 캐시)
│   │                             차트 진입선 전용. ① 뒤에서부터 순수량을 누적해 시작 체결을 찾고
│   │                             ② 앞으로 재생하며 평단 누적 (청산은 평단을 바꾸지 않는다)
│   │                             updateTime을 쓰면 안 되는 이유는 파일 주석
│   ├── pushService.js         ← 프론트엔드 WebSocket 실시간 푸시 (update/alert)
│   └── statsCache.js          ← /api/stats 캐시 상태 공유 (orderWatcher가 체결 시 invalidate)
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
│                                 POLLING(폴링 주기 상수), CANVAS_C(캔버스 색상 토큰:
│                                 BULL/BEAR/RSI_ZONE_OB·OS/PIVOT_SUP·RES/AXIS/XTICK/YTICK)
├── ThemeContext.jsx           ← ThemeProvider + useTheme() — 다크/라이트 전환 (localStorage 동기화)
├── store/
│   ├── index.js               ← Zustand 스토어 조립(4개 slice 통합) — `useStore` export
│   ├── serverSlice.js         ← 서버 상태: balance/position/tpsl/liveClose + refetch 콜백
│   │                             tpsl 초기값: { long: { tp, sl, splitTps:[] }, short: { tp, sl, splitTps:[] } }
│   ├── settingsSlice.js       ← 설정(localStorage 동기화): riskPct/leverage/interval_/indicators
│   │                             riskPct/leverage 변경 시 800ms debounce 후 pending 주문 자동 재등록
│   ├── uiSlice.js             ← UI/드로잉/드래그 상태: drawing/drawMode/orderStatus/criticalAlerts/selectedBox/opacityPopup/dragTpsl/dragScaleIn/dragSplitTp
│   │                             ⚠ `criticalAlerts`는 **목록**이다 (2026-08-15). 문자열 하나로
│   │                               되돌리지 말 것 — 한 reconcile에서 LONG·SHORT 경보가 61ms
│   │                               간격으로 와서 뒤엣것이 앞엣것을 덮어썼다(실측 trade_log).
│   │                               증상: "SHORT는 SL 없으면 뜨는데 LONG은 안 뜬다"
│   ├── replaySlice.js         ← 리플레이 모드 상태 (replayOn/구간/시계/페이퍼 브로커/도형 토글)
│   │                             replayOn은 **저장 안 함** — 새로고침하면 항상 실거래로 시작
│   │                             SESSION_MAX_MS(90일) = 한 세션 최대 길이
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
│                                 setReplayGuard: 리플레이 중 **GET 외 전부 차단** (실주문 방지)
├── replay/                    ← 리플레이 트레이딩 (아래 "리플레이 트레이딩" 절 참고)
│   │                             ⚠ 이 폴더만 상대 import에 `.js` 확장자 — node 검산용
│   ├── soa.js                 ← 캔들 SoA(Float64Array 6개) — 봉당 48바이트
│   ├── timeframes.js          ← tfMs(1m 포함) + DRIVE_TF 사다리(1h→5m 12틱) + 실측 근거
│   ├── klines.js              ← 과거 캔들 페이지네이션 + weight 버킷 + 펀딩비 이력
│   ├── history.js             ← IndexedDB 청크 캐시(1000봉) — 빠진 구간만 조회
│   ├── engine.js              ← ReplayEngine — 커서 하나로 "지금 몇 시인가"를 정한다
│   │                             재생 중 배열 identity 유지(ZZ 누적 보존) / 시크 시 교체(리셋)
│   ├── paperBroker.js         ← 페이퍼 체결 엔진 — 스냅샷이 **백엔드와 같은 모양**
│   ├── paperActions.js        ← orderSlice 12개 액션의 페이퍼 버전 (이름을 똑같이 유지할 것)
│   ├── tradeStats.js          ← 연습 성적 집계 + equityCurve(UI 미사용)
│   ├── dailyLoss.js           ← 페이퍼 일일 손실 한도 (재생 시각의 UTC 하루 기준)
│   ├── drawingKeys.js         ← 도형 저장 키 분리 (`replay_` 접두사) + 읽기 전용 판정
│   └── session.js             ← 세션 저장/복원 — 진행 위치를 **시각**으로 저장
├── hooks/
│   │   ⚠ **`candlesRef`를 읽는 useCallback/useMemo는 deps에 `candlesRef`를 넣을 것**
│   │     (2026-08-15 실측 버그). `App.jsx`가 `replayOn ? replay : live`로 고르므로
│   │     모드를 바꾸면 **ref 객체 자체가 다른 것으로 바뀐다**(.current만 바뀌는 게 아니다).
│   │     빠뜨리면 전환 이전 ref를 붙들고, 그쪽은 비활성이라 `.current`가 빈 배열이다.
│   │     증상: 리플레이에서 휠 줌을 해도 **거래량 패널만 멈춰 있었다**
│   │     (`useChartRenderer.redrawVolume` deps가 `[IW, isDark]`뿐이었다)
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
│   ├── usePivotLevels.js      ← Pivot Levels — 스윙 피벗 기반 지지/저항 (유일한 S/R 지표)
│   │                             계산은 chart/pivotLevels.js, 여기선 useMemo 래핑만
│   ├── useRSI.js              ← RSI(14) 계산 (Wilder's smoothing, candles 기반)
│   ├── useFVG.js              ← FVG(Fair Value Gap) 검출 (최근 400캔들, 50% 이상 채워지면 소멸)
│   ├── useOrderBlock.js       ← 오더블록 검출 (BOS 기반 스윙 탐지, 최근 500캔들)
│   ├── useEMA.js              ← 다중 EMA 계산 (id/period/color/enabled 속성, useMemo 캐시)
│   ├── useAlertMonitor.js     ← 타임프레임별 RSI 알람 (5m/15m/1h/4h/1d WebSocket 감시)
│   │                             + 봉 마감 알림 + 히스테리시스 쿨다운 적용
│   ├── useToast.js            ← 토스트 알림 — addToast(30초 자동닫힘) / addLineAlert(sticky, 3초 소리 반복)
│   ├── useTrendLineAlert.js   ← 추세선/채널/원 근접 알림 (0.2% 이내, 히스테리시스 0.3%)
│   ├── useChochAlert.js       ← CHoCH 발생 알림 (자동 ZZ + 수동 구조 공용)
│   │                             자동 ZZ 기본 ON / 수동 구조는 **구조별 기본 OFF** [R10]
│   │                             liveClose 구독 → 틱마다 모듈 상태 비교 (첫 관측·재계산은 무음)
│   ├── usePositionCloseAlert.js ← 포지션 종료 감지 → sticky 알림 (롱/숏 각각 독립 추적)
│   ├── useNotificationSettings.js ← 타임프레임별 알림 설정 (RSI OB/OS, 봉마감) localStorage 동기화
│   ├── useTrendLines.js       ← 트렌드 라인 + 채널 + 원 상태 (내부적으로 useDrawableStore 3개 사용)
│   ├── useFibs.js             ← 피보나치 되돌림 도형 스토어 (useDrawableStore("fibs")) + 2클릭 그리기 상태
│   │                             표시할 레벨(`levels`)도 **도형별**이다 — toggleFibLevel/resetFibLevels
│   │                             (2026-08-15. 전역 indicatorParams.fib는 키째 제거됐다)
│   ├── useDrawableStore.js    ← 제네릭 도형 스토어 (localStorage 영속화, 공통 필드 id/opacity/locked/alert)
│   ├── useStructures.js       ← 수동 구조 도형 스토어 (useDrawableStore("structures")) + 그리기/편집 액션
│   │                             points 배열 변형은 전부 normalizeStructurePoints를 거쳐 고/저 교대 유지
│   ├── useIndicatorParams.js  ← 지표 파라미터 로드/저장 (서버 /api/indicator-params, INDICATOR_DEFAULTS 기본값 병합)
│   ├── useShortcutSettings.js ← 단축키 커스텀 설정 (DEFAULT_SHORTCUTS + localStorage "keyboard_shortcuts")
│   ├── useKeyboardShortcuts.js ← 단축키 글로벌 핸들러 (ESC/Delete/박스·구조·피보·선택·알람·잠금·투명도·TF 전환)
│   ├── useChartRenderer.js    ← D3 캔들 렌더링 + 뷰포트 도메인 관리
│   │                             redrawCanvas(메인), redrawVolume(볼륨 캔버스), redrawRSI(RSI 캔버스) 분리
│   ├── useChartInteraction.js ← 마우스/휠 이벤트 핸들러 (cursorRules + hitDetection 활용)
│   │                             채널/원 그리기 및 드래그 포함, d3 의존성 없음
│   ├── useCrosshair.js        ← 크로스헤어 (SVG DOM 직접 조작, 메인+RSI 패널 연동)
│   │                             showLegPct(legRefs: pct + {key}Text/{key}{Up,UpD,Dn,DnD} tspan)
│   │                               지그재그 레그 hover 라벨 — 등락률 + 거래량 **3줄**
│   │                               (상위3/평균/총량 × 양봉·음봉 중 레그 방향 쪽)
│   │                               + 직전 동일방향 레그의 같은 지표 대비 [LV8]
│   ├── useRsiResize.js        ← RSI 패널 높이 드래그 조절 (localStorage 저장, 50~300px)
│   ├── useVolResize.js        ← 거래량 패널 높이 드래그 조절 (localStorage 저장, 40~200px)
│   ├── useReplay.js           ← 리플레이 캔들 피드 — **useCandles와 같은 계약**을 돌려준다
│   │                             재생 루프 + 페이퍼 브로커 동기화 + 세션 저장/복원
│   └── useHealth.js           ← 서버 헬스 체크
├── chart/
│   ├── candleRenderer.js      ← renderCandles() (캔들+축+오버레이 호출)
│   │                             renderVolumeCanvas/renderRSICanvas는 각 파일에서 re-export
│   ├── canvasUtils.js         ← initCanvas(DPR 대응), withClip(클리핑 헬퍼), getVisibleRange(가시 인덱스)
│   ├── overlayRenderers.js    ← renderFVG, renderOrderBlock, renderPivotLevels,
│   │                             renderEMA, renderStructureZigzag, renderRsiZones (전부 캔버스 렌더)
│   │                             renderRsiZones만 캔들 **뒤**(배경)에 그린다 — 나머지는 캔들 위
│   │                             computeRsiZones/getRsiZoneCount/clearRsiZones — 구간 목록
│   │                               모듈 캐시 (지표 메뉴의 "검출된 과매수/과매도 N개"가 읽음)
│   ├── fib.js                 ← 피보나치 되돌림 계산 (순수 함수, **import 없음**)
│   │                             fibPrice(선형/로그) / FIB_ALL_LEVELS·FIB_DEFAULT_LEVELS
│   │                             normFibLevels = **쓰기 경로**(저장 시 정렬·중복 제거)
│   │                             fibLevelsOf(fb) = **읽기 경로** — 렌더·히트·알림 셋이 이것만 본다
│   │                               (배열을 새로 만들지 않는다 — 같은 도형이면 같은 참조)
│   │                             pivotLevels.js와 같은 이유로 의존성 0 — node에서 바로 검산한다
│   │                             (픽셀 변환 fibXs는 tsToIdx가 필요해 hitDetection.js에 있다)
│   ├── entryPath.js           ← 진입선(평단선) 계단 좌표 (순수 함수, **import 없음**)
│   │                             entryPathPoints/entryPathString — PositionLines가 쓴다
│   │                             pivotLevels.js와 같은 이유로 의존성 0 — "추가 매수로 평단이
│   │                             오르내릴 때 제대로 꺾이는가"를 node에서 실제 값으로 검산한다
│   ├── pivotLevels.js         ← computePivotLevels() — Pivot Levels 계산 (순수 함수)
│   │                             usePivotLevels가 감싸 쓴다. 순수 함수로 뺀 이유는
│   │                             실제 캔들로 기본값을 실측 검증하기 위함 (node에서 바로 import)
│   ├── structureZigzag.js     ← computeStructureZigzag() — ZZ 지표 계산 (훅 아님, 순수 함수)
│   │                             유일하게 렌더 경로에서 계산되는 지표 — 틱마다 라이브 봉 반영
│   │                             forward-only 누적 상태(모듈 레벨 _st) — 기록은 추가만, 제거 없음
│   ├── deriveStructure.js     ← deriveStructure() / normalizeStructurePoints() — 수동 구조용 순수 함수
│   │                             꼭짓점 배열 → 세그먼트 + CHoCH. 누적 상태 없이 매번 전체 재계산
│   │                             3번째 인자 trace에 배열을 넘기면 꼭짓점별 판정 근거를 담는다
│   ├── structDebug.js         ← 콘솔 진단 `__structDebug()` — "왜 CHoCH가 안 뜨나"를 표로 출력
│   │                             판정 근거는 deriveStructure의 trace를 그대로 쓴다 (로직 복제 금지)
│   ├── legDebug.js            ← 콘솔 진단 `__legDebug()` — "레그 hover 비교(↑↓%)가 왜 안 뜨나"
│   │                             레그별로 봉범위/지표 3종/직전레그/판정을 표로. 진행 중 레그도 포함
│   │                             화면이 쓰는 함수(legPeakVolume)와 같은 prev 규칙(k-2)을 그대로 사용
│   ├── structRenderState.js   ← 수동 구조 렌더가 남기는 모듈 상태 — Structures.jsx가 기록, 외부가 읽음
│   │                             set/getStructChochCounts·Count (구조별 검출 CHoCH 개수
│   │                               → 팝업의 CHoCH 개수 슬라이더 상한. 합계(Total)는 2026-08-12 제거)
│   │                             set/getStructLiveSegment (진행 중 레그 → 레그 등락률 hover)
│   │                             set/getStructLiveChochs (진행 중 레그의 CHoCH → useChochAlert)
│   │                             ZZ의 getZzChochTotal/getZzSegments와 같은 이유(candlesRef 필요)로 모듈 상태
│   ├── volumeRenderer.js      ← renderVolumeCanvas (모듈 레벨 _volMap 재사용)
│   ├── rsiRenderer.js         ← renderRSICanvas
│   ├── cursorRules.js         ← CURSOR_RULES 배열, getCursor(ctx) — 커서 결정 로직
│   ├── hitDetection.js        ← buildHitChain, findHitChannel, findHitCircle, snapToOHLC, lineXY, channelXYs
│   │                             findHoveredLeg — 지그재그 레그 hover (수동 구조 + 자동 ZZ 공용)
│   │                               { pct, i1, i2, prev } — prev = **같은 구조** 안의 직전 동일방향 레그(k-2)
│   │                               없으면 null — 구조의 첫 상승/첫 하락은 비교 없음 [LV7]
│   ├── legVolume.js           ← legPeakVolume()/fmtVol()/volChangePct()/LEG_VOL_METRICS — 순수 함수
│   │                             { bars, up, dn } — 양봉/음봉 분리, 각 { peak, idx, top3, mean, n } | null
│   │                             LEG_VOL_METRICS = hover 세 줄의 순서·이름 (peak/top3/mean) [LV8]
│   │                             테이커(체결 주체) 기준은 2026-08-13 제거 — [LV5]
│   │                             합계 아님 (길이 편향) / 봉 범위 (i1, i2] — 인접 레그 겹침 방지
│   ├── scales.js              ← getScales(), tsToIdx() — xScale/yScale 생성 + 타임스탬프→인덱스 변환
│   ├── svgGeom.js             ← clipPolylineX/clipSegmentX/inViewX — SVG 도형 뷰포트 클리핑
│   │                             timestamp 좌표 도형이 화면 밖 수만 px로 뻗는 걸 자른다
│   │                             (5m 렉의 원인 — 점선이 선 길이만큼 조각으로 펼쳐진다)
│   └── dragStateMachine.js    ← DRAG_HANDLERS 테이블
│                                 박스: draw/pan/entry/tp/sl/pos_tp/pos_sl/scale_in/split_tp
│                                 트렌드라인: line_ep/line_move
│                                 채널: channel_ep/channel_move/channel_mid_offset/channel_mirror_ep
│                                 원: circle_move/circle_radius
│                                 피보나치: fib_ep/fib_move (레벨선 개별 이동은 없다 — 위치가 곧 비율이다)
├── components/
│   ├── ChartArea.jsx          ← 차트 전체 영역 조합 (hooks + ChartSvg + RSI/Volume 패널 + LineOpacityPopup)
│   ├── TopBar.jsx             ← 봉 선택, 캔들 마감 카운트다운 + 현재가, 드로잉/라인/채널/원/피보나치 모드 버튼,
│   │                             로그 스케일 토글, 지표 메뉴, 알림 메뉴, 단축키 메뉴, 테마 토글
│   ├── IndicatorMenu.jsx      ← 보조지표 온/오프 + 파라미터 설정 (Volume/RSI/**Pivot**/OB/FVG/EMA/ZZ/Custom ZZ)
│   │                             ⚠ **Fibonacci 행은 없다** (2026-08-15 사용자 요청으로 제거).
│   │                               피보나치는 선·채널·원과 같은 도형인데 저것들만 지표 체크박스라는
│   │                               관문을 갖고 있었다 — "지표를 켜야만 TopBar 버튼이 활성화되는 게
│   │                               이상하다"가 이유다. 여기 있던 유일한 근거(전역 레벨 목록)도
│   │                               도형별로 옮겨 사라졌다 → 더블클릭 팝업의 `표시할 레벨`
│   │                             EmaSettingsPanel: EMA 다중 항목 (기간/색상/표시 토글/추가/초기화)
│   │                             StructTfPanel: Custom ZZ 표시 타임프레임 다중 선택 (struct.tfs, 기본 1h) **전용**
│   │                               ※ 수동 구조엔 CHoCH 관련이 없다 — 표시 on/off·개수·거래량 비교
│   │                                 전부 **구조별**이라 각 구조의 더블클릭 팝업에 있다
│   │                             ZZ 패널: "검출된 CHoCH N개" + **CHoCH 표시 / CHoCH 개수**
│   │                               (2026-08-14 추가 — 팝업과 같은 값의 거울)
│   │                               ※ 거래량 비교는 없다 — 자동 ZZ는 거래량 비교 자체가 제거됨
│   │                             RSI 패널: "검출된 과매수/과매도 N개" + **구간 배경 표시 TF(rsi.tfs)**
│   │                               + 구간 배경/구간 개수 + period/OB/OS
│   │                               ※ rsi.tfs는 **구간 배경만** 거른다 — RSI 선은 전 TF에 나온다
│   │                             TfGrid: TF 다중 선택 — **RSI(구간 배경)/Custom ZZ(표시)/Pivot(계산)** 공유
│   │                               ⚠ **체크박스다** (2026-08-14 사용자 요청 — 3개 전부).
│   │                                 ON/OFF 버튼으로 되돌리지 말 것: 다중 선택이 모양에서 안 읽힌다
│   ├── NotificationMenu.jsx   ← 타임프레임별 알림 설정 체크박스 (7TF × RSI OB/OS/봉마감)
│   ├── ShortcutMenu.jsx       ← 단축키 커스텀 설정 UI (녹음 모드로 각 action 키 재바인딩 + 초기화)
│   ├── ReplayBar.jsx          ← 리플레이 컨트롤 (시작일/RANDOM/재생/한 틱/배속/시크/종료)
│   │                             ⚠ 2026-08-15 정리: **한 봉 전진(⏭⏭)·%·시각·가격·기존 도형** 제거.
│   │                               가격은 최상단 바에 이미 있고, 나머지는 바를 복잡하게만 했다
│   │                             ⚠ 진행 슬라이더는 **폭 고정**(PROGRESS_W) — `flex:1`이면 옆 문구가
│   │                               나타났다 사라질 때마다 바 길이가 출렁인다
│   │                             ⚠ 글리프는 `▶` / `▶|` — `⏭`(U+23ED)는 이모지 표현이라 `▶`보다 크게 그려진다
│   │                             색은 보라(#a78bfa) — 실거래에서 뜻이 있는 색을 피한다
│   ├── Toast.jsx              ← 토스트 알림 컴포넌트 (일반: 금색, sticky: 빨강 + 확인 버튼)
│   ├── Slider.jsx             ← 리스크/레버리지 슬라이더 (index.css `.slim-range` — 손잡이 9px)
│   │                             ⚠ 손잡이 크기를 줄이려면 `appearance:none`이 필요하고, 그러면
│   │                               `accent-color`가 하던 **트랙·채움까지 직접 그려야 한다**
│   │                               (채움은 값 비율 linear-gradient). 한 줄만 지우면 트랙이 사라진다
│   │                             ※ 지표 메뉴·투명도 팝업 슬라이더는 대상이 아니다 (기본 크기 유지)
│   ├── Divider.jsx            ← 구분선
│   ├── StatusAlert.jsx        ← 주문/TP·SL 결과 알림 배너 (성공/에러)
│   ├── Chart/
│   │   ├── ChartSvg.jsx           ← SVG 전체 레이어 조합 (채널/원 오버레이 포함)
│   │   ├── BoxOverlay.jsx         ← BoxOverlay, DrawingCurrent SVG 컴포넌트
│   │   │                             ⚠ 2026-08-14 사용자 요청으로 **장식을 전부 걷어냈다**:
│   │   │                               가격 텍스트(BoxLabels 컴포넌트째) / TP 삼각형 / SL 다이아 /
│   │   │                               손익비 배지 / 진입선 노란 원(↕) / 좌우 폭 조절 그립
│   │   │                             남은 것은 면 · 가로선 3개 · `▲ LONG`/`▼ SHORT` 뿐이다
│   │   │                             ※ 지운 마커는 전부 **드래그 판정과 무관한 장식**이었다
│   │   │                               (판정은 hitDetection이 따로 갖는다) — 조작성은 그대로다
│   │   │                             ※ TP·SL 둘 다 **실선**이다 (SL만 점선이던 것을 맞췄다)
│   │   ├── PositionLines.jsx      ← 헷지모드: 롱/숏 포지션 각각 진입/TP/SL/분할TP/추가진입 수평선 (드래그 핸들)
│   │                             ⚠ **진입선은 진입봉부터 오른쪽 끝까지, 평단이 바뀐 지점에서
│   │                               꺾이는 계단**이다 (2026-08-15 사용자 요청 → 같은 날 계단으로 보강).
│   │                               전 폭 직선이면 "언제 들어갔나"가 안 보이고, 직선 한 줄이면
│   │                               추가 매수 뒤 왼쪽 끝이 허공을 가리킨다 (position API 절 참고).
│   │                               좌표는 `chart/entryPath.js` 하나가 만든다 — `position.*.entrySteps`를
│   │                               **봉 한가운데가 아니라 그 봉 왼쪽 가장자리**(`floor(idx) - 0.5`)에 맞춘다
│   │                               ⚠ **세로 단차는 점선(2,2) + 흐리게(0.35)** — 가로선과 똑같이
│   │                                 그리면 **캔들 심지로 읽힌다**(진입선 색이 캔들 색과 같은 계열).
│   │                                 심지는 실선이라 점선이면 갈린다. 가로선까지 점선으로 만들지 말 것
│   │                                 (이 앱에서 점선은 "아직 확정 아님"이나 "알림 ON"의 뜻이다)
│   │                               ⚠ **마지막 계단 높이는 `entryPrice`를 쓴다** (steps의 avg가 아니라).
│   │                                 두 값은 일치하지만 라벨·×·사이드바가 전부 entryPrice를 본다
│   │                               ⚠ `entrySteps`가 없으면(외부 진입·이력 부족·조회 실패)
│   │                                 예전처럼 **전 폭 직선**이다 — 계단이 1개면 진입봉부터 직선
│   │                             ※ TP/SL·추가대기·분할TP 가로선은 **전 폭 그대로다** — 저건 미래에
│   │                               걸어둔 주문이라 시작점이라 할 게 없다
│   │                             + 진입선 옆 `+TP`/`+SL` 버튼 — **없을 때만** 뜨는 신규 등록 입구
│   │   │                             좌표는 `hitDetection.posTpSlButtons` 하나가 정한다 (렌더·히트 공용)
│   │   │                             ⚠ TP/SL/추가대기/분할TP의 **우측 라벨은 없다** (2026-08-15) —
│   │   │                               왼쪽 버튼이 같은 말을 하고 있어 지웠다. 되살리려면 넷을 같이.
│   │   │                               진입선 라벨만 남는다(왼쪽에 버튼이 없어 유일한 표시) — 모양은 버튼과 통일
│   │   │                             좌측 핸들은 **전부 버튼 모양**(`MarkerButton`, 2026-08-15) —
│   │   │                               삼각형 ▶ + 옆 글자를 사용자 요청으로 바꿨다.
│   │   │                               크기·가로 위치를 `TPSL_BTN`에서 가져와 `+TP`와 같은 레인에 정렬한다
│   │   │                               글자: `TP`/`SL` / `추가`(추가대기) / `분할`(분할TP)
│   │   │                               — `+`·`TP`를 그대로 두면 신규 등록 버튼과 뜻이 겹친다
│   │   │                             각 버튼 옆 `×`(`CloseButton`) — 눌러서 제거. 진입 라벨의 ×만 2회 확인
│   │   │                               (드래그 시스템 절의 "마커 옆 × 버튼" 참고)
│   │   ├── TrendLines.jsx         ← 트렌드 라인 SVG (선택 시 끝점 핸들)
│   │   ├── Channels.jsx           ← 채널 SVG (메인선+미러선+채우기, 알림 글로우, 선택 핸들)
│   │   ├── Circles.jsx            ← 원 SVG (채우기+테두리, 선택 핸들)
│   │   ├── Fibs.jsx               ← 피보나치 되돌림 SVG (레벨 가로선 + 비율 라벨 + 앵커 대각선)
│   │   │                             채우기 없음 / 라벨은 비율만 / 두 앵커 사이만 — 전부 사용자 확정
│   │   ├── Structures.jsx         ← 수동 구조 SVG (지그재그 폴리라인 + CHoCH 마크 + 꼭짓점 핸들)
│   │   │                             liveClose를 자체 구독 — ChartArea가 구독하면 틱마다 전체 리렌더
│   │   └── LineOpacityPopup.jsx   ← 더블클릭 팝업 — 헤더(이름+%+🔔🔒) / 투명도 슬라이더 / 옵션 영역
│   │                                 🔔 의미만 다름: 선·채널·원·**피보나치** = 근접 알림 / 구조·ZZ = CHoCH 발생 알림
│   │                                 피보나치는 슬라이더 아래에 `표시할 레벨` 체크박스 10개 (FibLevelRow,
│   │                                   2026-08-15). **그 도형에만** 적용 — 전역 값은 없다 (fib.js [F1])
│   │                                 구조·ZZ는 슬라이더 아래에 `CHoCH 표시 [ON/OFF]` + `CHoCH 개수` 슬라이더
│   │                                 `거래량 비교 [ON/OFF]`는 **수동 구조에만** (LEGVOL_KINDS, 2026-08-14)
│   │                                 개수는 **그 구조(또는 ZZ)에만** 적용 — 전역 설정이 아니다
│   │                                 ※ ZZ의 두 줄은 지표 메뉴 ZZ ⚙에도 있다 (같은 값의 거울, 2026-08-14)
│   │                                 **자동 ZZ와 수동 구조는 이름("구조")·구성 거의 동일**
│   │                                   (자동 ZZ에 없는 것: 잠금 🔒, 거래량 비교)
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
│       ├── StatsCard.jsx      ← 거래 통계 카드 (날짜 필터, 승률/PnL/수수료/펀딩비)
│       └── ReplayStatsCard.jsx ← 연습 성적 카드 — 리플레이면 "거래 통계" 자리를 대신 채운다
│                                 거래수/승패/승률/PF/평균/최대낙폭/수수료/펀딩비/순손익
├── App.jsx                    ← 메인 컴포넌트 — hooks 조합 + TopBar/SidebarPanel/ChartArea 조립
│                                 derivePositionFlags로 hasLong/hasShort/hasPos/hasBoth/hasPending/drawLocked 파생
│                                 sidebarOpen/isLog는 App 로컬 상태 (localStorage 동기화)
├── main.jsx                   ← React 진입점
└── index.css                  ← 전역 리셋 (overflow:hidden) + @keyframes toastIn
```

### 기타 파일
- `start.bat` — 백엔드·프론트엔드 동시 실행
- ※ `기타/KDE.py`(구 S/R 레벨 계산 파이썬)는 2026-08-13 제거 — 백엔드에 **파이썬 의존성이 없다**

## 핵심 설계

### 헷지모드 (Hedge Mode)
- Binance Futures 헷지 모드 전제: LONG/SHORT 포지션이 동시에 존재 가능
- **position API 응답**: `{ long, short, pending, scaleInOrders, funding }`
  - `long`/`short`: 각각 독립 포지션 객체 (size/entryPrice/unrealizedPnl/leverage/liquidationPrice/**entryTime**) 또는 null
    - `entryTime` = **이 포지션이 처음 열린 시각** / `entrySteps` = `[{ t, avg }]` =
      **그 시각부터 유효했던 평단**. 차트 진입선을 진입봉부터 계단식으로 긋는 데 쓴다
      (아래 PositionLines 항목). `services/entryTime.js`가 체결 이력에서 역산한다
      - ⚠ **positionRisk의 `updateTime`을 쓰지 말 것** (2026-08-15 실계좌에서 확인).
        그건 "마지막으로 바뀐 시각"이라 부분 청산 때마다 앞으로 밀린다 —
        LONG 실제 진입 08-14 21:37 vs updateTime 08-15 05:28로 **8시간** 어긋났고,
        진입선이 엉뚱한 봉에서 시작했다 ("실선이 빈 공간에서 시작한다"는 신고)
      - ⚠ **왜 시각 하나가 아니라 목록인가**: 추가 매수를 하면 `entryPrice`가 평단으로
        바뀌는데, 평단은 정의상 체결가들 **사이** 값이라 최초 진입봉의 고가~저가 밖일 수
        있다 → 선의 왼쪽 끝이 캔들이 아니라 **허공**을 가리킨다. 시작점을 "평단이 바뀐
        봉"으로 옮겨도 같다(그 봉 기준으론 반대쪽 허공) — 어느 한 봉을 골라도 안 된다
      - 실측 검산 (2026-08-15 실계좌): 마지막 계단의 avg가 바이낸스 `entryPrice`와
        **오차 0**으로 일치 (LONG 1계단 / SHORT 4계단)
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
- 박스 타입: `draw`, `pan`, `entry`, `tp`, `sl`, `box_x`, `pos_tp`, `pos_sl`, `scale_in`, `split_tp`
- **박스 그리기 방향**: 클릭점=진입가, 드래그 끝=손절가 기준 / 롱=아래로 드래그, 숏=위로 드래그 / TP는 SL 거리의 2배 자동 계산
- **박스 좌우 폭 조절**(`box_x`, 2026-08-14 사용자 요청): 세로 모서리를 잡아 끈다.
  - 폭은 **주문에 들어가지 않는 순수 표시값**이라 onUp에서 재등록을 부르지 않는다
    (entry/sl은 `replacePendingOrder`, tp는 `updatePendingTpsl`을 부르는 것과 대비)
  - 그래서 같은 사이드 포지션이 있어도 막지 않는다 (가격 3선을 막는 3번 스텝과 다른 점)
  - 최소 1봉은 남긴다 — 폭 0이면 `BoxOverlay`가 `x2 <= x1`로 렌더를 접어 박스가 사라진 것처럼
    보이고 다시 잡을 수도 없다
  - 히트는 가격 가로선(3번) **뒤**(3.2번)다 — 모서리와 가로선이 만나는 꼭짓점에서는 가격이 이긴다
  - clamp 전 좌표로 판정한다 (화면 밖 모서리는 잡히지 않음). `BoxOverlay`도 같은 기준
- 트렌드 라인 타입: `line_ep` (끝점 드래그), `line_move` (몸통 드래그)
- 채널 타입: `channel_ep` (끝점), `channel_move` (몸통), `channel_mid_offset` (중간 핸들로 양쪽 offset 동시 조절), `channel_mirror_ep` (미러선 끝점)
- 원 타입: `circle_move` (이동), `circle_radius` (반지름 조절)
- 수동 구조 타입: `struct_point` (꼭짓점 이동 — 봉 꼬리에 스냅, onUp에서만 정규화.
  실제로 움직였을 때만 `drag.moved`로 부분 선택 해제 → 제자리 클릭은 "선택"으로 남는다)
- 포지션 오버레이 타입: `scale_in`, `split_tp`
- **마커 옆 `×` 버튼 (2026-08-15)** — TP/SL/추가/분할/진입 라벨 옆에서 눌러 제거한다
  - 사각형은 `hitDetection`의 `closeBtnRect`/`entryCloseRect`/`markerCloseButtons`가 정한다
    (렌더·클릭 공용 — 각자 만들면 보이는 자리와 눌리는 자리가 어긋난다)
  - ⚠ **드래그가 아니라 클릭**이고, 히트 체인에서 **드래그 단계보다 먼저(3.85)** 와야 한다.
    왼쪽 ×는 x 41~56이라 TP/SL 드래그 영역(0~60) 안에 있다 — 순서를 뒤집으면
    누를 때마다 드래그가 먼저 잡혀 영영 눌리지 않는다
  - ⚠ **진입 라벨(LONG/SHORT)의 ×만 두 번 눌러야 한다.** 1회차엔 `✓`(호박색)로 바뀌고
    4초 뒤 스스로 풀린다(`uiSlice.closeConfirm`). 되돌릴 수 없는 시장가 청산이라
    차트의 작은 버튼 한 번으로 나가면 안 된다 — 사이드바 PositionCard도
    슬라이더 → 확인 → ✓ 로 여러 단계를 거친다. 한 번 클릭으로 바꾸지 말 것
  - 나머지(TP/SL/추가/분할)는 주문 취소일 뿐이라 한 번에 지운다 — 다시 걸면 그만이다
  - 끄는 중(`isDragging`)에는 ×를 감춘다. 클릭 판정은 **저장된 가격** 기준이라
    끌려가는 선을 따라가지 않는다 (보이는 자리와 눌리는 자리가 어긋난다)
  - TP/SL 취소는 `DELETE /api/tpsl` (2026-08-15 신설). 분할 TP는 `/split`, 진입 미체결은 `/api/orders`
  - ⚠ SL을 지우면 그 포지션은 무방비다 → reconcile이 60초 안에 critical 알림을 띄운다. **정상 동작**이다
- **TP/SL 신규 등록 (`+TP`/`+SL` 버튼, 2026-08-15)** — 포지션은 있는데 TP(또는 SL)가 **없을 때**
  진입선 옆에 뜨는 작은 버튼. 잡고 위아래로 끌면 놓은 가격에 새로 등록된다
  - 드래그 타입은 기존 `pos_tp`/`pos_sl` **그대로**다 — 옮기기와 새로 걸기가 같은 경로다.
    백엔드도 그대로 동작한다: `saveTpsl`이 `tpOrderId`를 안 실으면 `routes/tpsl.js` PUT이
    취소 단계를 건너뛰고 새로 등록한다(`if (tpOrderId)`). 페이퍼도 동일(`paperBroker.setTpsl`)
  - ⚠ 좌표는 **`hitDetection.posTpSlButtons` 하나가 정한다.** 렌더(`PositionLines.jsx`)와
    히트 판정(`buildHitChain` 3.9)이 같은 함수를 부른다 — 각자 계산하면 보이는 자리와
    잡히는 자리가 어긋난다 (피보나치 레벨 배열을 셋이 나눠 쓰는 것과 같은 이유)
  - ⚠ **클릭만으로는 아무 일도 안 한다(의도).** "기본 거리에 자동 생성"은 넣지 않았다 —
    실주문이 나가는 동작이라 오클릭 한 번이 곧 주문이 된다. 반드시 끌어야 등록된다
  - **진입선 한가운데에 걸친다** (기존 TP/SL 핸들과 같은 규칙 `y = 선 - h/2`).
    위/아래로 비켜 두면 같은 종류의 컨트롤인데 이것만 규칙이 달라 보인다.
    롱·숏 진입가가 가까워 두 줄이 겹치면 아래쪽을 밀어낸다 — 겹치면 `hitTpSlButton`이
    먼저 찾은 롱을 돌려줘 숏을 누를 수 없다 (밀린 쪽은 자기 선에서 살짝 벗어난다)
  - ⚠ **가격 유효성은 검사하지 않는다** — 기존 "옮기기"와 같다. 롱 TP를 현재가 아래에 놓는
    식이면 바이낸스가 -2021로 거절하고 `saveTpsl`이 에러 배너를 띄운다. 한쪽만 검사를
    넣지 말 것 (같은 드래그 경로인데 새로 걸 때만 막히면 규칙이 둘이 된다)
- `useChartInteraction.js`의 `buildHitChain`이 onMouseDown 히트 우선순위를 순서대로 처리

### 드로잉 도구 (TopBar 버튼 + 단축키)
- **박스 모드**: 진입/TP/SL 박스 그리기 (기본 `q`)
- **라인 모드**: 트렌드 라인 (2점 클릭)
- **채널 모드**: 평행 채널 (3클릭: 시작→끝→폭 확정)
- **원 모드**: 원 (2클릭: 중심→반지름)
- **피보나치 모드**: 되돌림 (기본 `f`, TopBar `피보나치` 버튼) — 2클릭: 추세 시작 → 추세 끝
- **구조 모드**: 수동 시장 구조 (기본 `s`) — 클릭 반복으로 고/저점 찍기, 우클릭·더블클릭 확정
- `Escape`: 그리기 취소 / 선택 해제
- `Delete`: 선택된 도형 삭제 (수동 구조는 꼭짓점을 클릭해 뒀으면 **그 꼭짓점만** 삭제)
- `a`: 선택된 도형 알람 토글
- `l`: 선택된 도형 잠금 토글
- `[` / `]`: 선택된 도형 투명도 ±0.25 조절 (0.25~1.0)
- 숫자키 `1`~`6`: 타임프레임 전환 (5m/15m/1h/4h/1d/1w)
- ※ 모든 단축키는 **ShortcutMenu에서 커스텀 가능** (localStorage `keyboard_shortcuts`)

### 자동 ZZ를 도형처럼 다루기 (2026-08-12 추가)
- 자동 Structure Zigzag는 **지표**지만, 사용자가 "커스텀과 똑같이" 조작하길 원해
  `drawables`에 가짜 drawable `"zz"`로 감쌌다 (`chart/drawables.js`의 `DRAWABLE_KINDS`·`ZZ_ID`)
  - 항목이 하나뿐이라 id는 상수 `ZZ_ID`, `items`는 원소 1개 배열
  - `delete`/`toggleLock`은 **no-op** — 지표는 지우거나 잠글 대상이 아니다
  - `toggleAlert` = **CHoCH 발생 알림**(근접 알림이 아님). 수동 구조도 동일하게 맞춰서
    단축키 `a`가 두 지표 모두 CHoCH 알림을 토글한다
  - 필드명을 수동 구조와 통일(`alertChoch`/`showChoch`/`opacity`) → 팝업·단축키가 분기 없이 읽는다
- **클릭 = 선택(금색 `#f0b90b`, 1.5px)**, 수동 구조와 같은 색·굵기.
  선택 상태는 저장하지 않는 App 로컬 state(`zzSelected`) — 렌더는 `overlaysRef`로 전달
- **투명도**: `indicatorParams.zz.opacity` (서버 영속화, 기본 1.0).
  최종 알파는 수동 구조와 같은 `0.8 × opacity`. `[` `]` 단축키도 그대로 동작
  - ※ CHoCH 마크는 투명도를 따르지 않는다 — 항상 100% (수동 구조 `[R1]`과 동일)
- ⚠ **선택하면서 팬 드래그도 함께 건다** (`hitDetection.js` 체인 5). 다른 도형은 선택이
  팬을 막지만, 자동 지그재그는 차트 전 구간을 가로질러서 그러면 차트를 못 끄는 지점이
  화면 곳곳에 생긴다. **클릭만 하면 선택, 끌면 팬** — 이 예외를 없애지 말 것
- 히트 판정 우선순위는 맨 뒤 (채널 > 원 > 선 > 수동 구조 > 자동 ZZ) —
  넓게 깔린 지그재그가 다른 도형 클릭을 삼키면 안 된다

### 도형 공통 속성 (트렌드라인/채널/원/피보나치)
- **선택 핸들 크기는 `SEL_HANDLE_R`(constants.js) 하나가 정한다** — 2026-08-14 사용자 지정.
  기준은 **수동 구조 꼭짓점**이고(그날 5 → 2.5로 줄인 값), 나머지 도형이 r=5라 두 배로 커
  보인다는 이유로 트렌드라인/채널/원/피보나치를 전부 여기 맞췄다.
  `Structures.jsx`도 이 상수를 쓴다(부분선택 +0.5 / 선택 = 기준 / 미선택 −0.5)
  - ⚠ 한 곳만 리터럴로 되돌리지 말 것 — 같은 금색 핸들인데 도형마다 크기가 다르면
    "선택됨"이 도형별로 다르게 보인다
  - ※ **잡는 반경과는 무관하다.** 드래그 히트 판정은 hitDetection의 10px 고정이라
    점을 작게 그려도 집기 어려워지지 않는다 (보이는 크기만 줄인 것)
  - ※ 그리는 중 프리뷰 점(r=3)은 대상이 아니다 — "선택"이 아니라 "방금 찍은 첫 점" 표시고
    구조 draft 점과 이미 같은 크기다
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
| **첫 돌파(bias=0)도 CHoCH** (2026-08-13 변경) — BOS는 "같은 방향 추세인데 또 돌파"할 때만 | 구조마다 첫 돌파에 마크가 통째로 없음. 돌파 1번짜리 짧은 구조는 CHoCH 0개 |
| 위 규칙은 수동 구조·자동 ZZ·Pine **셋 다 동일** (bull `bias !== 1` / bear `bias !== -1`) | 하나만 되돌리면 같은 차트에서 지표끼리, 또 트레이딩뷰와 마크 개수가 어긋남 |
| BOS 표시 안 함 (제안 거절됨) | 화면이 복잡해짐 |
| CHoCH 선 끝 = 선분 교차점(`crossT`), 캔들 조회 금지 | 가로선이 지그재그를 지나 오른쪽으로 삐져나옴 (자동 ZZ도 `crossIdx`로 동일하게 통일 — 2026-08-12) |
| 라이브 판정 = 꼬리 기준 + 구간 극값(래치) | 종가 기준이면 꼬리 돌파를 놓치고, 되돌아올 때 마크가 사라짐 |
| `deriveStructure`에 `candlesRef.current` 전달 | React candles는 봉마감 때만 갱신 → 라이브가 조용히 죽음 |
| 라이브 레그는 가장 최근 구조 1개만 | 과거 구조가 화면 끝까지 점선을 뻗음 |
| CHoCH 마크 항상 100% 불투명 | 구조를 흐리게 하면 마크까지 흐려짐 |
| **마크에 글자 없음 — 가로선만** (2026-08-14) — ZZ·수동 구조·Pine 셋 다 | 마크가 붙어 있으면 글자끼리 겹쳐 복잡해 보임 (`"CHoCH"` → `"C"` → 제거 순으로 줄인 결과) |
| 신규 구조 기본 투명도 0.5 | — |
| `STRUCT_SNAP_BARS = 1` | 마그넷이 과하게 강해짐 (3에서 낮춘 값) |
| 전 TF 공유 (storageKey에 TF 없음) — **저장은 TF별로 쪼개지 않는다** | TF별 분리는 기능 후퇴 |
| 표시 TF 필터(`struct.tfs`)는 **표시 전용**, 기본 1h (2026-08-12 사용자 요청) | 저장까지 TF로 나누면 위 항목과 충돌 |
| 선분 중간 꼭짓점 삽입 없음 | 교대 구조상 동작 불가 — "빠진 기능"이 아님 |
| 끝점 클릭 = 연장/흡수로 항상 하나의 구조 | 쪼개지면 경계 CHoCH 유실 |
| 부분 삭제는 꼭짓점 클릭 → `Delete` (Shift+클릭 즉시 삭제 아님) | 사용자가 명시적으로 바꾼 조작 |
| **선분(몸통) 부분 선택·삭제 없음** (2026-08-12 제거) | 몸통 클릭 시 선이 파랗게 물드는 게 거슬린다고 명시적으로 제거 요청 |
| 구조별 CHoCH 토글은 더블클릭 팝업에 (2026-08-12 요청) | 구조를 여러 개 그리면 마크가 뒤엉킴 — "보고 싶은 것만" |

### 수동 구조 (Structure) — 손으로 그리고 CHoCH는 자동
- **목적**: 자동 ZZ가 못 잡는 구조를 직접 지정. 자동 ZZ와 **공존**하며 `structureZigzag.js`는 건드리지 않는다.
- **데이터**: `{ id, points: [{ t, p, type:"H"|"L" }], opacity, locked, showChoch, alertChoch,
  maxChoch, showLegVol }` — localStorage `"structures"`
  (`showChoch`/`showLegVol`은 undefined = ON, `alertChoch`만 **기본 OFF**(true일 때만 ON),
   `maxChoch`는 undefined = 제한 없음 —
   기존 저장 구조가 새 필드 때문에 꺼지거나 잘린 채로 뜨지 않게)
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
- **진행 중 레그 끝점 클릭 = 그 자리를 꼭짓점으로 확정** (2026-08-15 사용자 요청)
  - 점선은 이미 "다음 꼭짓점이 여기쯤 잡힌다"를 보여주므로, 그게 마음에 들면
    **구조 모드에 들어가지 않고** 점선 끝을 눌러 이어붙인다
    (`useStructures.commitLiveStructPoint` ← `buildHitChain` 3.95번)
  - ⚠ **끝에 마커가 없다** — 예전엔 하늘색 속 빈 원이 있었는데 2026-08-15 사용자 요청으로
    지웠다. 되살리지 말 것. **동작은 그대로다**: 판정은 원이 아니라 `STRUCT_LIVE_HIT`(10px)이
    갖고 있었고, 누를 수 있다는 신호는 커서(`+`)가 낸다 (Structures 전체가
    `pointerEvents:none`이라 애초에 그 원이 클릭을 받은 적도 없다)
  - 좌표는 화면에 그려진 점 그대로다 — 구간 극값이라 스냅이 따로 필요 없다
    (`deriveStructure`가 꼬리 기준으로 뽑은 값이고 꼭짓점 스냅도 같은 기준)
  - 타입은 교대 규칙에서 나온다: 마지막이 `L`이면 진행 중 레그는 상승이므로 찍힐 점은 `H`
  - ⚠ **구조 모드에서는 동작하지 않는다** — 거기선 클릭이 이미 꼭짓점 추가라 뜻이 겹친다.
    draft(그리는 중)도 `ownerId`를 주지 않아 제외된다
  - ⚠ `ownerId`/`type`은 `Structures.jsx`가 `setStructLiveSegment`에 실어 보낸다 —
    진행 중 레그는 구조 목록에 없어서 hitDetection이 직접 알아낼 수 없다
    (`prev`/`showVol`을 같이 보내는 것과 같은 이유)
  - [SL1] 잠긴 구조는 여기서도 막힌다 (꼭짓점을 바꾸는 모든 경로)
  - 커서는 구조 모드 끝점 잇기와 **같은 `+`**(`STRUCT_LINK_CURSOR`) — 하는 일이 같다
- **이어 그리기 / 두 구조 잇기**: 구조 모드에서 **기존 구조의 양 끝 꼭짓점 클릭** = 이어붙이기
  - draft 없을 때 클릭 → `startExtendStruct` (그 구조를 연장, `extendId` 부여 → finishStruct가 update)
  - draft 있을 때 다른 구조의 끝점 클릭 → `mergeStructIntoDraft` (그 구조를 흡수, `mergeIds`에 기록
    → finishStruct가 흡수된 구조를 `store.remove`. 안 지우면 꼭짓점이 두 벌 남아 CHoCH가 겹친다)
  - **왜 필수인가**: 확정 후에는 Shift+클릭(선분 사이 삽입)으로 끝점 뒤에 점을 못 붙인다.
    또 구조를 둘로 쪼개면 `deriveStructure`가 각각 `bias=0`으로 새로 시작해 **경계의 CHoCH가 유실**된다
  - 첫 점(과거 방향) 연장은 draft를 역순 seed — 타입 교대·프리뷰 기준점을 맞추기 위함.
    최종 순서는 `normalizeStructurePoints`가 시간순으로 정렬하므로 draft 순서는 무관
  - 이어 그리는 중에는 원본을 렌더에서 숨기고 draft가 대신 그린다 (CHoCH 포함)
  - ⚠ **이어 붙여도 기존 구조의 설정을 물려받는다** (`[S8]`, 2026-08-13 버그 수정).
    흡수 경로는 `store.add`로 **새 구조를 만들고 원본을 지우는** 구조라, 승계를 안 하면
    CHoCH 표시·거래량 비교를 꺼 둔 구조에 이어 붙였을 때 전부 기본값(ON)으로 되돌아간다
    (사용자 보고 증상). 승계 대상: `opacity`/`showChoch`/`alertChoch`/`showLegVol`/`maxChoch`
    - 규칙은 **"먼저 잡은 기존 구조가 기준"** 하나 — 연장이면 그 구조(update라 자동),
      새로 그려 붙였으면 **처음 흡수한 구조**(`absorbIds[0]`). 설정이 서로 다른 두 구조를
      이으면 하나는 버려질 수밖에 없으므로 규칙을 하나로 고정한다
    - ⚠ `locked`는 승계하지 않는다 — 잠긴 구조는 애초에 연장·흡수 대상이 아니고,
      넣으면 새로 그린 선이 잠긴 채로 태어난다
- **편집** (선택 상태에서): 꼭짓점 드래그 이동 / **꼭짓점 선택 후 `Delete`로 그 점만 삭제**
  - 구조를 한 번 클릭해 선택 → 그 안의 **꼭짓점을 클릭**하면 `structPart`에 담긴다
    (`{ kind:"point", idx }`, `useStructures`)
  - **색으로 구분**: 구조 전체 선택 = 금색(`#f0b90b`) / 꼭짓점 선택 = 파랑(`PALETTE.info` `#60a5fa`).
    "지금 Delete를 누르면 무엇이 지워지는가"가 색으로 보여야 한다는 사용자 요구사항
  - **같은 꼭짓점을 다시 클릭하면 선택 해제** → 구조 전체 선택으로 복귀.
    이 토글이 없으면 꼭짓점을 고른 뒤 구조 전체 삭제로 돌아갈 방법이 없다
  - `Delete`: `structPart`가 있으면 **그 꼭짓점만**, 없으면 구조 전체 삭제
    (`deleteStructSelection` — `drawables.structure.delete`에 연결)
  - **선분(몸통) 부분 선택·삭제는 없다** (2026-08-12 사용자 요청으로 제거 — `[S7]`/`[R7]`).
    몸통 클릭 시 선이 파랗게 물드는 게 거슬린다는 이유. 지금 **몸통 클릭 = 구조 전체 선택,
    몸통 더블클릭 = 팝업**이다. `removeStructSegment` / `structPart.kind==="segment"` 경로를
    되살리지 말 것
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
- **잠금(`locked`)** — 꼭짓점을 바꾸는 **모든 경로**를 막는다 (2026-08-13 사용자 요청, `[SL1]`)
  - ① 꼭짓점 드래그 이동 ② 다른 구조와 붙이기(흡수) ③ 자기 구조에 이어 그리기
  - 가드는 **`useStructures`(소유자)에 있다.** `hitDetection.findStructEndpointHit`도 잠긴
    구조를 끝점 후보에서 빼지만 그건 커서 편의고, 보장은 훅 쪽 가드가 선다 — 히트 판정만
    믿고 훅 가드를 빼지 말 것 (경로가 하나 늘 때마다 잠금이 조용히 뚫린다)
  - 흡수는 원본을 **삭제**하므로 잠금과 정면 충돌 → 잠긴 구조는 흡수 대상에서 제외
  - 그리는 도중에 대상이 잠기면(`l` 단축키는 draft와 무관하게 동작) 연장 대신 **새 구조로 저장**
  - ※ 삭제(`Delete`)는 막지 않는다 — 트렌드라인/채널/원과 같다. 잠금은 "모양이 변하지
    않는다"는 보장이지 "지울 수 없다"가 아니다
- **CHoCH 표시 제어** (2026-08-12)
  - **구조별 on/off**: `structures[].showChoch` — 더블클릭 팝업의 `CHoCH 표시` (undefined = ON)
  - **구조별 개수**: `structures[].maxChoch` — 더블클릭 팝업의 `CHoCH 개수` 슬라이더.
    **undefined = 제한 없음(전체)**, 슬라이더를 끝까지 올리면 다시 전체로 저장된다
    (숫자로 고정하면 구조를 편집해 CHoCH가 늘었을 때 새 마크가 조용히 잘린다)
  - ⚠ **지표 전체 스위치 `struct.show_choch`는 제거됨** (2026-08-12 사용자 요청).
    켜고 끄는 곳은 **구조별 팝업 하나뿐**이다. 되살리지 말 것 — 구조별 토글과 AND로 걸리는
    별개 값이라 OFF로 저장해 두면 구조별 ON이 먹지 않는데, 그 사실이 구조 팝업 어디에도
    드러나지 않는다. (프론트·백엔드 DEFAULTS에서도 키를 뺐다)
  - ⚠ **개수를 전역 값 하나로 두지 말 것** (`struct.max_choch`는 제거됨). 두 번 문제가 됐다:
    ① 전 구조를 합쳐 최신 N개로 자르던 시절 — 과거 구간에 그린 구조의 마크가 최신 구조에
       밀려 통째로 사라짐 ② 전역 숫자만 있던 시절 — 낮춰둔 걸 잊고 "CHoCH가 안 뜬다"고 오해
    → 그래서 **값도 구조가 들고, 기본은 제한 없음**이다 (Structures.jsx `[R6]`)
  - 슬라이더 상한은 그 구조의 실제 검출 개수 — `getStructChochCount(id)` (구조별 Map)
  - draft(이어 그리는 중)의 CHoCH는 제한 없이 전부 보인다
  - `showChoch` OFF는 **CHoCH 마크만** 끈다 — 지그재그 선·꼭짓점은 그대로 보인다
  - 검출 개수는 `chart/structRenderState.js`의 모듈 상태에 Structures 렌더가 기록 →
    팝업의 슬라이더 상한(1~N)에 사용 (`getStructChochCount(id)`).
    ZZ와 같은 이유로 모듈 상태다 — 라이브 레그 CHoCH까지 세려면 `candlesRef`가 필요해
    React 상태(useMemo)로는 값이 어긋난다. 팝업 여는 시점 스냅샷이며 열려 있는 동안은 갱신 안 됨
- **CHoCH 자동 계산**: `deriveStructure(points)`가 매번 전체를 다시 뽑는 순수 함수
  → **꼭짓점을 옮기면 그 이후 CHoCH가 사라지거나 새로 생긴다. 의도된 동작이다.**
  자동 ZZ의 forward-only 누적 상태는 진행 중 봉 ATR 드리프트를 막으려던 것이라 여기선 불필요
- **CHoCH 마크 조건** (2026-08-13, 자동 ZZ·Pine과 동일): **첫 돌파(bias=0)도 CHoCH**로 찍는다.
  BOS로 넘기는 건 같은 방향 추세가 이미 선 상태에서 또 돌파한 경우뿐이다
  (bull은 `bias !== 1`, bear는 `bias !== -1`일 때 발생)
- **자동 ZZ와 판정이 다른 부분**: 수동 구조엔 ATR 노이즈 필터·피벗 탐지가 없고, 꼭짓점을
  사용자가 소유하므로 매번 전체 재계산이다 (자동 ZZ는 forward-only 누적)
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
  - ⚠ **진행 중 레그는 하늘색(`#38bdf8`) + 굵기 1.5 + 글로우(0.15)**로 그린다
    (`[R11]`, 2026-08-15 사용자 요청). 선택 중이면 금색이 이긴다 (폴리라인과 같은 규칙)
    - 처음엔 알림과 같은 호박색이었다가 같은 날 파랑으로 바꿨다 — 알림 ON인 구조에서
      확정 레그와 색이 겹쳐 진행 중 레그가 묻혔다
    - ⚠ 꼭짓점 부분 선택 파랑(`PALETTE.info` `#60a5fa`)과 **일부러 다른 색조**다.
      저건 "Delete 대상"이라는 전혀 다른 뜻이다
    - **구조 투명도를 따르지 않는다** — CHoCH 마크(`[R1]`)와 같은 이유.
      예전엔 회색 + 굵기 1 + `0.45 × 구조 투명도`(기본 0.5) = 실효 0.22라
      지그재그 끝에서 흐려지며 사라졌다. "일관되게" opacity를 다시 곱하지 말 것
    - ⚠ **끝점에 원(마커)은 없다** — 같은 날 사용자 요청으로 지웠다. 선만 그린다.
      끝점 클릭으로 꼭짓점을 확정하는 기능은 그대로다 (위 "진행 중 레그 끝점 클릭" 절)
  - ※ `deriveStructure`에는 **`candlesRef.current`를 넘겨야 한다.** React `candles` state는
    봉마감 때만 갱신돼서 진행 중 봉의 고가/저가가 낡아 있다 (`useCandles.js:29-38`)
- **CHoCH 가로선 끝점 = 레그 선분과 레벨의 교차점**(`crossT`, 선형 보간). 확정·라이브 동일
  - **캔들을 보고 끊으면 안 된다.** 화면에 그려진 건 캔들이 아니라 꼭짓점을 이은 직선이고
    둘은 어긋난다. 고점110→저점85 레그에서 레벨 90이면 직선은 80% 지점에서 지나지만
    실제 가격은 90 위에서 뭉개다 레그 끝에서 깨는 일이 흔하다. 봉 기준으로 끊으면 그 차이만큼
    가로선이 지그재그를 지나 오른쪽으로 삐져나온다 (하락 레그에 잦아 bear 쪽에 몰려 보임)
  - 선분 교차점은 정의상 두 꼭짓점 사이에 들어가므로 어떤 데이터·TF에서도 삐져나오지 않는다
- **스타일**: 자동 ZZ와 동일 (지그재그 `#888888` / CHoCH `#0ecb81`·`#f6465d` 1.5px 가로선, 글자 없음), 렌더만 SVG
- **알림 ON 스타일은 트렌드라인과 동일** (2026-08-13 사용자 요청): 호박색 `#fbbf24` +
  점선 `6,3` + 굵기 1.5 + 글로우(굵기 6, 투명도 0.18).
  선택(금색)이 알림보다 우선한다. 꼭짓점 점 색도 선을 따라간다.
  한쪽만 바꾸지 말 것 — 같은 알림인데 선 종류마다 다르게 보인다
  - ⚠ **차트 위 🔔 아이콘은 없다** (2026-08-14 사용자 요청으로 제거 — 선·채널·원·수동 구조
    **네 종류 모두**). 알림 여부는 **색과 점선만으로** 나타낸다. 되살리려면 넷을 같이.
    켜고 끄는 🔔 토글(더블클릭 팝업 헤더)과 단축키 `a`는 그대로다 — 지운 건 마커뿐이다
  - ※ **자동 ZZ는 아직 이 스타일이 아니다** (캔버스 렌더라 `overlayRenderers.js` 쪽 작업이 따로 필요).
    맞출 거면 `renderStructureZigzag`에서 같은 값으로
  - ⚠ 그래서 `alertChoch`는 **기본 OFF**다 (2026-08-13 사용자 결정, `[R10]`).
    기본이 ON이면 손대지 않은 구조가 전부 알림 스타일이 되어 색이 아무것도 구분해주지 못한다.
- **근접 알림 없음**: `useTrendLineAlert`은 선/채널/원만 대상. 대신 `drawables.structure.toggleAlert`가
  **CHoCH 발생 알림**(`useChochAlert`)에 연결돼 있어 팝업의 🔔 토글과 단축키 `a`가 그대로 동작한다.
  CHoCH 마크 표시(`showChoch`)는 슬라이더 아래 `CHoCH 표시 [ON/OFF]` 행 — 자동 ZZ와 같은 UI다
  (👁 아이콘으로 바꿨다가 "무슨 표시인지 모르겠다"는 이유로 사용자가 되돌렸다 — 되살리지 말 것)

### 지그재그 레그 hover — 등락률 + 양봉/음봉 거래량 3종 (2026-08-12 / 3줄 2026-08-13)
지그재그 선 위에 마우스를 올리면 커서 아래 작게 뜬다
(**거래량 3줄은 수동 구조에서만** — 자동 ZZ는 등락률만, 2026-08-14):
```
+1.38%   상위3 ▲4.2K ↓7%      ← 상위 3봉 평균 (n<3이면 있는 만큼)
         평균  ▲2.1K ↓4%      ← 그 방향 봉 전체 평균 (봉당)
         총량  ▲9.8K ↑37%     ← 그 방향 봉 거래량을 전부 더한 값
└등락률        └직전 동일방향 레그의 **같은 쪽·같은 지표** 대비
```
- ⚠ **`피크`(봉 하나) 줄은 2026-08-13 제거됐다** (사용자 요청). 되살리지 말 것 —
  `[LV8]` 실측이 "봉 하나가 레그 거래량의 중앙값 37%를 대표한다"를 보여준 뒤 내린 결정이다.
  계산(`legPeakVolume`의 `peak`)은 top3를 구하며 어차피 나오는 값이라 남아 있을 뿐이다
- ⚠ **`총량`은 맨 아래 고정.** 셋 중 **유일하게 레그 길이에 휘둘린다**
  (봉 수와의 상관계수 총량 0.29 / 상위3 0.10 / 평균 0.00). 총량이 늘었을 때
  "거래가 많았다"인지 "레그가 길었다"인지는 위 두 줄과 같이 봐야 갈린다 — 순서를 뒤집지 말 것
- 라벨이 패널 아래로 넘치면 커서 **위**로 뒤집는다 (`showLegPct`에 `IH` 전달)
- ⚠ **거래량 3줄은 수동 구조 전용이다 — 자동 ZZ에는 없다** (2026-08-14 사용자 요청으로 제거).
  자동 ZZ 레그에 hover하면 **등락률(%)만** 뜬다. 되살리지 말 것 —
  되살리려면 `hitDetection.js`의 ZZ 분기(`showVol: false`), `zz.show_legvol` 파라미터
  (프론트·백엔드 DEFAULTS), 팝업의 `LEGVOL_KINDS`, `useChartInteraction`의 `zzShowVol`까지
  전부 다시 필요하다 (같이 삭제됨)
- **끄는 곳은 더블클릭 팝업의 `거래량 비교 [ON/OFF]`** (2026-08-13) — **구조마다**
  (`structures[].showLegVol`), 기본 ON. 자동 ZZ 팝업에는 이 행이 없다(`LEGVOL_KINDS`)
  - **OFF여도 등락률(%)은 그대로 뜬다.** 거래량 3줄만 사라진다 — 전부 없어지면
    "hover가 통째로 죽었다"로 보인다
  - 진행 중(점선) 레그는 구조 목록에 없어서 `hitDetection`이 플래그를 직접 못 읽는다 →
    `Structures.jsx`가 `liveSegment.showVol`에 실어 보낸다 (`prev`를 넘기는 것과 같은 이유)
- 줄 순서·개수·이름은 `legVolume.js`의 **`LEG_VOL_METRICS` 하나가 정한다** —
  크로스헤어(ref 키 `{key}Text`/`{key}Up`…)·ChartSvg(`<text>` map)·`__legDebug` 표가 전부 이 배열을 읽는다
- **등락률**은 상승 초록 / 하락 빨강.
- **값의 초록/빨강은 그 봉의 방향**을 뜻한다 (가격 방향 색과 의미가 일치).
  증감은 ↑↓ 화살표로만 보이고 **해석은 글자로 단정하지 않는다**
  (상승 레그인데 양봉 거래량 ↓ = 동력 약화. 그 판단은 사용자 몫)
- 라벨에 지표 이름(상위3/평균/총량)을 써 붙인다 — 숫자만 있으면 무엇의 값인지 모른다.
  머리말 폭은 반각 환산으로 맞춘다 (한글은 폴백 폰트라 2칸 — 글자 수로 맞추면 값 열이 어긋난다)
- **`[LV6]` 레그 방향에 해당하는 쪽만 표시** — 상승 레그는 ▲(양봉), 하락 레그는 ▼(음봉).
  계산(`legPeakVolume`)은 양쪽 다 하고 고르는 건 `useChartInteraction` — 표시 정책이라 순수 함수에서 거르지 않는다
- **`[LV5]` 테이커(체결 주체) 기준 줄은 없다 — 2026-08-13 사용자 요청으로 제거.**
  한때 캔들 색 기준 줄 아래에 `테이커`(매수/매도 체결량 기준) 줄을 나란히 두고
  어느 쪽이 쓸모 있는지 비교했고, 캔들 기준만 남기기로 결론이 났다. 되살리지 말 것 —
  되살리려면 `useCandles`의 `bv`(klines `k[9]` / WS `k.V`) 파싱부터 다시 필요하다(같이 삭제됨)

#### ⚠ 양봉/음봉 피크를 **따로** 낸다 (`[LV4]`, 사용자 지적)
피크 하나만 내면 그게 양봉인지 음봉인지 알 수 없어 해석이 안 된다. 실제로 오해를 만들었다:
위 예의 `+1.38%` 상승 레그는 예전 표기로 `피크 18.2K ↑197%`였는데 매수세가 강해 보였다.
쪼개 보니 그 18.2K는 **음봉**이고 양봉 최대는 6.8K였다 — 올랐지만 가장 큰 한 방은 매도였다.
- 비교는 **같은 쪽끼리**(양봉↔양봉, 음봉↔음봉). 섞으면 "이번 상승의 양봉 피크가 직전
  상승의 음봉 피크보다 크다" 같은 의미 없는 값이 나온다
- 한쪽 방향 봉이 아예 없는 레그가 있다(짧은 레그, 실측 77개 중 13개). 그때 그쪽은 `null`이고
  라벨에서도 **빠진다** — 0으로 채우면 "피크가 0"으로 읽혀 틀린 말이 된다
- 색이 달라 `<tspan>` 둘로 나눠 담는다. tspan은 **가로 위치가 자동으로 이어져서**,
  별도 `<text>`로 나눌 때처럼 문자폭을 추정해 x를 계산할 필요가 없다
  (값 길이가 바뀔 때마다 어긋나던 문제). 구분 공백은 **U+00A0** —
  SVG 기본 공백 처리가 tspan 경계의 일반 공백을 없애 숫자가 붙어 버린다

#### ⚠ 합계의 성질 — 길이 편향 (`chart/legVolume.js` `[LV2]`)
※ 아래는 "피크만 쓰던 시절"의 기록이다. 지금은 총량도 함께 뜬다(`[LV9]`) — 그래도
**합계가 레그 길이에 휘둘린다는 사실은 그대로**라, 총량을 단독으로 쓰지 말 것.
"피크치만 비교하고 싶어" — 합계로 되돌리지 말 것. 합계는 **레그 길이에 휘둘린다**:
2봉짜리 레그와 12봉짜리 레그를 총합으로 비교하면 사실상 "어느 쪽이 오래 걸렸나"를 재게 된다.
피크는 봉 하나의 값이라 길이와 무관하고 "가장 센 한 방이 얼마였나"를 바로 답한다.
- **실측(1h 600봉, ZZ 레그 77개): 봉 수와의 상관계수가 합계 0.76 → 피크 0.26.**
  길이 편향이 실제로 사라진다
- 그래서 라벨에 봉 수를 병기하던 안전장치도 필요 없어져 뺐다

#### 지금 뜨는 줄은 **상위3 / 평균 / 총량** (`[LV9]`, 2026-08-13 사용자 지정)
같은 날 두 번 바뀌었으니 순서대로 읽을 것:
**① 피크 하나 → ② 피크·상위3·평균 세 줄(`[LV8]`) → ③ 피크 제거 + 총량 추가(지금)**
- **피크 줄은 뺐다** — 아래 `[LV8]` 실측을 보고 내린 결정이다. `LEG_VOL_METRICS`에 다시 넣지 말 것
- **총량 = 그 방향 봉 거래량의 합.** 위 `[LV2]`가 "합계 금지"라 적어둔 그 값이 맞고,
  사용자가 그 성질을 알고 요청했다. 다만 길이 편향은 실재하므로(0.29) **맨 아래**에 두고
  길이와 무관한 두 줄(평균 0.00 / 상위3 0.10)을 위에 남겨 대조군으로 쓴다

#### ⚠ 왜 여러 줄인가 — 피크 하나로는 안 되는 이유 (`[LV8]`, 2026-08-13)
"피크값이 봉 1개만을 비교하는 게 찝찝하다" — 맞는 지적이고 실측이 뒷받침했다.
**BTC 15m/1h/4h/1d 각 1500봉, ZZ 레그 685개 / 비교쌍 659개:**

| | 값 |
|---|---|
| 피크 1봉이 그 레그 같은방향 총거래량에서 차지하는 비중 | **중앙값 37%** (중앙 봉의 1.6배, 상위 10%는 3.8배) |
| 같은방향 봉이 1개뿐인 레그 | 9% (2개 이하 21%) |
| 직전 레그 대비 **↑↓ 부호가 피크와 갈리는 비율** | 상위2 9% / **상위3 11%** / 평균 23% / 중앙값 31% |

예: `1h 하락 레그 peak +74% 인데 top3 −20%, mean −16%` — 한 방만 커졌고 나머지는 줄었다.
**갈리는 것 자체가 정보**라 하나로 줄이지 않고 여러 줄을 나란히 둔다. 줄을 지우지 말 것.
- 봉 수와의 상관계수: 피크 0.09 / 상위3 0.10 / 평균 0.00 / **총량 0.29** —
  길이에 휘둘리는 건 총량뿐이라 `[LV9]`가 그것만 맨 아래로 뺐다
- 지표 간 비교는 하지 않는다 — **같은 지표끼리만** 직전 레그와 비교한다.
  총량과 평균을 맞대면 "여러 봉 합이 봉당 평균보다 크다"는 당연한 말밖에 안 나온다
- 봉이 3개 미만인 레그(21%)는 상위3 = 있는 만큼의 평균이라 평균과 같아지고,
  1봉짜리(9%)는 세 값이 전부 같아진다. 그때도 **세 줄 다 띄운다** — 줄이 사라지면
  "왜 안 뜨지"가 되고, 값이 같다는 것 자체가 "1봉짜리 레그"라는 정보다
- 상위 3개는 정렬 없이 슬롯 3개로 받는다 (마우스가 움직일 때마다 도는 경로라 배열 복사·정렬 금지)

#### ⚠ 이 비교를 왜 hover에 붙였나 (`[LV1]`)
"이전 상승과 이번 상승의 거래량 비교"가 목적이다. 처음엔 **x축을 손으로 드래그해
구간을 잡는 도구**로 만들었다가 **폐기했다** — "생각보다 별로 쓸모가 없다"는 피드백.
비교할 때마다 레그를 두 개씩 직접 그려야 하고, 새 레그가 나올 때마다 또 그려야 해서
실제로는 안 쓰게 된다. **지그재그가 이미 레그를 계산하고 있으므로 hover에 얹는 게 맞다.**
손으로 그릴 게 없고, 이미 보고 있는 구조 위에서 결심 없이 눈에 들어온다. 되돌리지 말 것.
- `[LV3]` 레그의 봉 범위는 **(i1, i2]** — 시작 꼭짓점 봉 제외, 끝 봉 포함.
  시작 봉은 직전 레그의 끝 봉이라, 포함하면 이웃 레그가 같은 봉을 공유해
  **같은 피크가 양쪽에 잡힐 수 있다** (실측: 전 레그 봉수 합 585 = 전체 구간 585봉)
- **"직전 동일방향 레그" = 두 칸 앞(k-2)**. 지그재그는 상승·하락이 **반드시 교대**하므로
  방향 판정 없이 정확하다 (실측 확인). 이 전제가 깨지면 비교 대상이 틀어진다
- ⚠ **`[LV7]` 비교는 그 구조 안에서만 한다 — 다른 구조를 끌어오지 말 것** (2026-08-13 사용자 확정)
  - **구조의 첫 상승 레그와 첫 하락 레그는 비교 대상이 없다 → 증감률을 띄우지 않는다.**
    비어 있는 게 정상이다. 값이 뜨면 그게 버그다
  - 한때 `findPrevSameDirLeg`(k-2가 없으면 모든 구조를 뒤져 같은 방향 레그를 찾는 폴백)이
    있었다. **제거했다.** 며칠 전에 그린, 선으로 이어져 있지도 않은 남의 구조 레그와
    비교한 숫자가 떠서 그 값이 어디서 왔는지 알 수 없었다
  - ※ 그 폴백은 "사용자가 임펄스 레그를 2점짜리 구조로 따로 그려서 필요하다"는 이유로
    문서에 적혀 있었는데, **사용자가 그런 말을 한 적 없다고 확인해 줬다(AI 오기재)**.
    이런 근거로 되살리지 말 것 — 구조 하나가 곧 하나의 비교 단위다
- 진행 중 레그(`liveSegment`)도 같은 규칙 — `Structures.jsx`가 소유 구조의
  `pts[n-3]→pts[n-2]`를 `prev`로 실어 보낸다 (`[R8]`). 꼭짓점이 3개 미만이면 `null`(비교 없음).
  **`[R8]` 자체는 유지** — 예전엔 `prev`를 아예 안 넘겨 진행 중 레그만 비교가 안 됐다
- 거래량은 **`candlesRef.current`**로 계산 — React `candles`는 봉마감 때만 갱신돼
  진행 중 레그의 마지막 봉이 낡는다 (구조 지표와 같은 함정)

#### 공통
- **수동 구조와 자동 ZZ 공용** — `hitDetection.js::findHoveredLeg`가 둘을 같은 규칙으로 훑는다
  - 좌표계만 다름: 수동 구조는 timestamp(`tsToIdx` 변환), 자동 ZZ는 이미 bar index
  - 겹치면 수동 구조가 이긴다 (사용자가 직접 그린 쪽이 의도가 분명)
  - **진행 중 레그도 포함** — 수동 구조는 `getStructLiveSegment()`(점선), ZZ는 마지막 세그먼트(curSeg)
- **React 상태를 쓰지 않는다** — 크로스헤어와 같은 imperative SVG 레이어
  (`legPctRef` = 등락률 / `legVolRef` = 거래량, 색이 달라 요소를 나눴다).
  마우스 이동마다 상태를 갱신하면 SVG 오버레이 전체가 리렌더된다
- 표시 조건: 드래그·그리기 모드가 아니고 커서가 메인 패널(0 ≤ y ≤ IH) 안일 때.
  히트 반경은 클릭(8)보다 좁은 **6** — hover는 잘못 걸리면 라벨이 깜빡여 거슬린다
- 자동 ZZ 세그먼트는 수천 개까지 누적되므로 `distToSeg` 전에 x 범위로 먼저 거른다
- 지표가 꺼져 있으면 대상에서 빠진다 (`showZZ` / `visibleStructures`)

### 보조지표 파라미터 영속화
- 프론트: `useIndicatorParams`가 서버에서 로드 → `INDICATOR_DEFAULTS`와 병합 → 변경 시 debounce 저장
- 백엔드: `indicatorParamsStore`가 `indicator_params.json`에 JSON 영속화
- 대상: RSI(period/OB/OS/**zone_bg/zone_all/tfs**), FVG(lookback/mitigation), OB(swing/bos), **pivot(tfs/pivot_bars/merge_atr/min_touch/top_n/lookback)**, EMA(배열), ZZ(left_bars/use_filter/atr_mult/atr_period/**show_choch/max_choch/alert_choch/opacity**), struct(tfs)
- ※ `fib` 키는 **제거됐다** (2026-08-15, 프론트·백엔드 DEFAULTS 양쪽).
  피보나치는 전역 파라미터가 하나도 없다 — 레벨 목록까지 도형별(localStorage `"fibs"`)이다.
  **전역 값을 다시 만들지 말 것** (위 피보나치 절 `[F1]`)
- ※ `pivot`은 **6개를 저장하고 UI에는 5개**(TF 그리드 + 슬라이더 4개) — 숨긴 건 `lookback`(600).
  이유는 "Pivot Levels" 절 참고
- ※ 구 S/R Levels의 `sr` 키는 지표째로 제거됐다 (2026-08-13) — 저장 파일에서도 지웠다
- ※ `zz`의 **show_choch·max_choch는 두 곳에 있다** (2026-08-14 사용자 요청):
  ZZ 선 더블클릭 팝업 + 지표 메뉴 ZZ ⚙. **같은 값을 가리키는 거울**이라 한쪽을 바꾸면 양쪽이 바뀐다
  (2026-08-12에 "중복"이라며 메뉴 쪽을 지웠던 것을 사용자가 다시 요청해 되돌렸다).
  줄 순서는 **표시 → 개수**로 양쪽 같게 유지할 것
  - ⚠ `zz.show_legvol`은 **없다** — 자동 ZZ의 레그 hover 거래량 비교는 2026-08-14 기능째로
    제거됐다 (같은 날, 메뉴에 넣은 직후 사용자 요청). 프론트·백엔드 DEFAULTS 양쪽에서 키를 뺐다
  - `alert_choch`·`opacity`는 **팝업에만** 있다 (🔔 / 슬라이더 — 도형 공통 UI라 메뉴에 자리가 없다)
  - `max_choch` 슬라이더는 상한이 실제 검출 개수(`getZzChochTotal()`)라 PARAMS_META로 못 만든다 →
    `RecentCountSlider`. 끝까지 올리면 `null`(전체)
    (※ RSI `zone_max`와 공유하던 `cap` 분기는 2026-08-15 그 슬라이더가 사라지며 함께 제거)
  - ⚠ **수동 구조(struct)에는 같은 걸 만들지 말 것.** 저쪽 세 값은 전부 구조별(localStorage)이라
    지표 메뉴가 가리킬 값 자체가 없다. 새로 전역 값을 만들면 구조별 값과 AND로 걸려
    전역 OFF일 때 구조별 ON이 먹지 않는데 그 사실이 구조 팝업에 드러나지 않는다 (아래 `struct.show_choch` 항목)
- ※ `struct.max_choch`는 **없다** — 수동 구조의 표시 개수는 구조마다 localStorage에 있다(`st.maxChoch`)
- ※ 새 지표 추가 시 프론트 `INDICATOR_DEFAULTS`와 백엔드 `indicatorParamsStore.DEFAULTS` **양쪽 모두**에 키 추가 필요 (백엔드 load()가 자기 DEFAULTS 키만 통과시킴)

### 알림 시스템
- **토스트 종류**: 일반(금색 테두리, 30초 자동닫힘) / sticky(빨강 테두리, 확인 버튼 필수)
- **포지션 종료 알림**: 롱/숏 포지션 각각 독립 감지 → 해당 사이드 종료 시 sticky 알림
- **추세선/채널/원/피보나치 근접 알림**: 0.2% 이내 진입 → sticky, 0.3% 이상 이탈 시 해제 (히스테리시스)
  - 피보나치는 **레벨 가로선 각각**이 대상이고, 어느 레벨인지 토스트에 비율로 찍는다.
    한 번 울리면 그룹 키(`fb{id}`)로 잠가 도형당 하나만 뜬다 — 레벨이 7~10개라 안 그러면 쌓인다
- **CHoCH 발생 알림** (`useChochAlert`, 2026-08-12 추가) — 자동 ZZ + 수동 구조 공용.
  **자동 ZZ는 기본 ON, 수동 구조는 기본 OFF**(2026-08-13 — 알림 ON이 호박색 점선으로 보이므로)
  - **설정 위치는 지그재그 선 더블클릭 팝업의 🔔 아이콘**(사용자 지정) + 단축키 `a`.
    자동 ZZ는 `indicatorParams.zz.alert_choch`(지표 단위), 수동 구조는 `structures[].alertChoch`(구조별).
    자동 ZZ는 undefined = ON, **수동 구조는 true일 때만 ON**(기본 OFF)
  - 일반 토스트(`addToast`) — sticky가 아니다. CHoCH는 확인이 필요한 경보가 아니라 지나가는
    이벤트고 자주 뜨므로, 확인 버튼을 강제하면 화면을 막는다
  - **대상은 진행 중 레그에서 나온 CHoCH뿐**. 확정분까지 보면 `deriveStructure`가 순수 함수라
    꼭짓점을 옮길 때마다 과거 CHoCH가 재계산돼 편집 중에 알림이 터진다
  - 오알림 방지 2중 장치 — ① 첫 관측은 무조건 무음(기준선만): 페이지 로드 시 과거 전 구간
    CHoCH가 한꺼번에 계산된다 ② 자동 ZZ는 **세대(gen) 비교**: TF 전환·파라미터 변경으로
    누적 상태를 버리고 재계산하면 gen이 증가 → 무음으로 기준선만 갱신
    (개수 비교로는 안 된다 — MAX_CHOCHS 초과 시 shift로 길이가 그대로일 수 있음)
  - 판정 신호: ZZ는 `getZzChochSignal()` `{ gen, last }`(last.seq는 초기화돼도 증가),
    수동 구조는 `getStructLiveChochs()` `[{ structId, dir, price }]`
  - **표시 옵션과 독립** — CHoCH를 화면에서 숨겨도 알림은 살아 있다(의도적)
  - 지표가 꺼져 있거나 구조 표시 TF가 아니면 계산 자체가 안 돌아 알림도 없다
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

### ⚠ SVG 도형은 **뷰포트로 잘라서 그린다** (2026-08-13, 5m 렉의 원인)
`chart/svgGeom.js` — `clipPolylineX` / `clipSegmentX` / `inViewX`.
대상: 수동 구조(`Structures.jsx`), 트렌드라인, 채널. **되돌리지 말 것.**

- **원인**: 이 도형들은 좌표가 timestamp라, 로드 범위보다 과거에 그린 것은 `tsToIdx`가
  **음수 bar index로 외삽**한다(`scales.js`). `useCandles`는 1500×2 = **3000봉**을 싣는데
  5m면 **10.4일치뿐**이라, 한 달 전에 그린 도형이 화면 왼쪽 **8만 px 밖**에 찍힌다
- **왜 클리핑만으론 안 됐나**: 길이는 SVG 클리핑이 처리하지만 **`stroke-dasharray`는
  래스터 클리핑 전에 경로를 조각으로 펼친다** → 비용이 선 길이에 비례한다

| TF | 30일 전 도형의 x | 점선(6,3) 조각 | 자른 뒤 |
|---|---|---|---|
| 5m | −80,640 px | **8,960개** | ~170개 |
| 15m | −26,880 px | 2,987개 | ~170개 |
| 1h | −6,720 px | 747개 | ~170개 |

- 5m:15m:1h = **12:4:1** — "5m만 확실히 느리고 15m은 미묘하다"는 보고와 비율이 맞는다
- 게다가 `Structures`는 `liveClose`를 구독해 **틱마다(최대 60fps) 다시 칠한다**
- 방아쇠는 2026-08-13의 알림 스타일 변경 — CHoCH 알림이 그때 기본 ON이라 모든 구조가
  점선이 됐다. (이후 기본값은 OFF로 바꿨지만 **보기 좋으라고 바꾼 것이지 성능 대책이 아니다** —
  실선도 노드는 여전히 거대하고, 선·채널은 예전부터 알림 ON이면 점선이었다.) 클리핑이 근본 대책이다
- 화면 안 형상은 **완전히 동일**하다 — 선분 교차점을 선형 보간으로 구한다 (실측 오차 1e-14)
- ※ 캔버스 오버레이(Pivot/ZZ/CHoCH/FVG/OB)는 **이미 화면 밖 컬링이 되어 있다**
  (`renderPivotLevels`의 `Math.max(0, …)`, `renderStructureZigzag`의 도메인 컷) — 손대지 말 것
- ※ JS 계산은 원인이 아니었다 (실측, 5m 3000봉): ZZ 증분 0.34ms/틱, `deriveStructure` 0.17ms/틱

### 캔버스 분리 렌더링
- **메인 캔버스** (`canvasRef`): 캔들 + 오버레이 (FVG/OB/SR/EMA) — 틱마다 RAF로 재드로우
- **거래량 캔버스** (`volCanvasRef`): 거래량 바 — 틱마다 `redrawVolumeTick`으로 갱신
  (진행 중 봉의 거래량 높이 + 양봉/음봉 색상이 실시간 반영돼야 함 — 2026-08-12 사용자 요청)
  진행 중 봉이 x 도메인 밖이면 스킵 (과거 구간을 보는 중에는 바뀔 게 없음)
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

### ~~S/R 레벨 시스템 (KDE)~~ — 2026-08-13 **완전 제거**
사용자 요청("마음에 안 든다")으로 지표·백엔드 서비스·파이썬 스크립트까지 전부 지웠다.
지지/저항은 아래 **Pivot Levels** 하나로 일원화됐다. 되살리지 말 것.

지워진 것: `backend/routes/sr.js` · `backend/services/srService.js` · `기타/KDE.py` ·
`frontend/src/hooks/useSRLevels.js` · `renderSRLines` · `CANVAS_C.SR_LINE_*` ·
`POLLING.SR_LEVELS_MS` · `indicator_params`의 `sr` 키(프론트·백엔드 DEFAULTS + 저장 파일) ·
지표 메뉴의 "적용 (KDE 재실행)" 버튼과 `srLoading`/`refreshSR` prop 체인.
→ **백엔드에 파이썬 의존성이 없다.** `/api/sr-levels` 엔드포인트도 없다.

교훈 하나만 남긴다: **노브가 서로 상쇄되면 안 된다.** 구 S/R은 6개 파라미터 중 4개가
서로 다른 지점에서 "레벨이 몇 개 나오나"를 건드렸고(늘리는 쪽 3 + 줄이는 쪽 3),
사용자가 전부 최대로 둔 채 "레벨이 4개밖에 안 나온다"로 쓰고 있었다. 심지어
`persistence_atr`은 **조일수록 레벨이 늘어나는**(단조롭지 않은) 값이었다.
Pivot Levels에 노브를 추가할 때는 방향이 한쪽으로만 움직이는지 먼저 확인할 것.

### ~~Reversal Zones (컨플루언스 반전 예상 구간)~~ — 2026-08-13 만들었다가 **같은 날 제거**
여러 근거(fib·주봉·Pivot·구조 꼭짓점·추세선·청산 클러스터)가 겹치는 가격대를 찾아
"위로 가면 여기, 아래로 가면 여기"를 밴드 두 개로 보여주던 지표. **되살리지 말 것.**

지운 이유는 취향이 아니라 **백테스트에서 가설이 반증됐기 때문**이다. BTC 4h 1000일,
평가 시점 892개, 페이드 매매 1,555건 (손절 = 존 반대편 + 0.5σ, 익절 2R, 최대 30봉):

| 근거 종류 수 | 표본 | 승률 | 기댓값 |
|---|---|---|---|
| 1종 | 1248 | 36.1% | −0.032R |
| 2종 | 290 | 30.3% | −0.158R |
| 3종 | 13 | 30.8% | −0.248R |
| **대조군(같은 거리 무작위 가격)** | 1530 | 33.9% | −0.080R |

**근거가 많이 겹칠수록 오히려 나빠졌다.** 손절·익절·보유기간을 5가지 조합으로 스윕해도
순서가 뒤집히지 않았다. "여러 근거가 겹치면 강하다"는 전제 자체가 이 데이터에서 성립하지 않는다.

교훈 두 가지:
1. **예측을 주장하는 지표는 만들기 전에 백테스트할 것.** 서술형 지표(Pivot Levels =
   "여기서 반응했었다")는 맞고 틀리고가 없지만, 이건 "여기서 반전한다"는 검증 가능한 주장이었다.
   화면에 띄우고 눈으로 보면 그럴듯해 보였을 것이다 — 실제로 첫 구현은 멀쩡해 보였다.
2. **근거를 더 얹는 게 정확도를 올리지 않는다.** 상관된 근거를 겹쳐 세면 확신만 커지고
   정보는 안 는다. fib·Pivot·주봉은 전부 같은 과거 고/저점에서 파생된 값이라 서로 독립이 아니다.

단, **청산 클러스터만은 대조군을 웃돌았다** (127건 44.1% / +0.144R, 5개 설정 전부 양수).
표본이 작아 확정은 아니지만(≈2 SE), 유일하게 **메커니즘이 있는** 근거라 방향은 그럴듯하다 —
아래 설명 참고. 별도 지표로 다시 만든다면 이것 하나만 대상이다.

### Pivot Levels — 스윙 터치 기반 지지/저항 (2026-08-13, 유일한 S/R 지표)
KDE 기반 `S/R Levels`를 제거하고 대신 넣은 지표. 근거가 밀도(체류 시간)가 아니라
**스윙 피벗의 터치 횟수**라, 화면에 보이는 고/저점이 곧 레벨의 근거라서 눈으로 검산된다.

- **계산** (`computePivotLevels`, 순수 함수):
  ① 좌우 `pivot_bars` 봉보다 높은 고가/낮은 저가 = 스윙 피벗
  ② `merge_atr × ATR(100)` 폭 안의 피벗을 한 레벨로 묶음 — **가장 붐비는 가격을 먼저 집는
     greedy**다. 정렬 후 순서대로 자르면 경계가 임의로 정해져 한 덩어리가 둘로 쪼개진다
  ③ 고점 피벗·저점 피벗을 **섞어서 센다** — 저항이었다가 지지로 쓰인 자리(flip)가 가장 강한데,
     나눠 세면 약한 레벨 둘로 보인다
  ④ `min_touch` 미만 탈락 → 현재가 위/아래로 나눠 **가까운 순 `top_n`개**
- **강도 = 터치 횟수**, 표현은 선 진하기뿐 (`PIVOT_OPACITY` 1→0.35 / 2→0.55 / 3→0.75 / 4+→0.9).
  ⚠ 강도를 숫자로 적지 말 것 — 진하기가 이미 말하는 정보라 가격축 옆이 지저분해지기만 한다
  (구 S/R의 밀도 % 라벨을 뺀 것과 같은 이유)
- ⚠ **돌파된 레벨을 지우지 않는다.** 현재가 기준으로 지지↔저항 **역할만 바뀐다** — 뚫린 저항이
  지지가 되는 게 실제 동작이고, 지우면 그 정보가 사라진다
- ⚠ **선 시작점은 그 레벨이 처음 생긴 시점**(`firstT`). 전 구간 가로선으로 깔면 오래된 레벨과
  방금 생긴 레벨이 똑같아 보이고 화면 왼쪽이 선으로 덮인다
- ⚠ 색은 캔들의 `BULL/BEAR`와 **일부러 다르다** (`CANVAS_C.PIVOT_SUP_*` `#2dd4bf`/`#0d9488`,
  `PIVOT_RES_*` `#fb7185`/`#e11d48`). 같은 색이면 포지션 라인(진입/TP/SL)과 구분이 안 된다.
  **테마별 2색** — 단일 색은 한쪽 테마에서 묻힌다
- **파라미터 4개 + 숨김 1개**, 전부 **단조롭다**:
  `pivot_bars`·`merge_atr`·`min_touch`는 올릴수록 레벨이 줄고, `top_n`은 표시만 늘린다
  - 숨김 `lookback`(600봉): 최악 조합(`bars=2`,`merge=0.1`)에서 1500봉이면 계산이
    3.3ms → **26ms**로 뛴다(실측). 이 지표가 답하려는 건 "최근 구간의 반응 지점"이다
- **기본값은 실측** (BTC 5m/15m/1h/4h/1d 각 1500봉): `bars 8` / `merge 0.5` / `touch 2` / `top_n 3`
  → TF당 **4~6줄**. `min_touch`를 1로 내리면 통과 레벨이 약 3배(30개)로 늘어난다

#### 멀티 타임프레임 (2026-08-13 사용자 요청)
**차트 TF와 무관하게** `pivot.tfs`에서 고른 TF들의 레벨이 **모든 프레임에 똑같이** 뜬다.
(예: 1h·4h·1d를 체크하면 5m 차트에서도 그 세 TF의 지지/저항이 같은 가격에 보인다)

- 설정 위치: 지표 메뉴 `Pivot Levels` ⚙ → **레벨 계산 타임프레임** (`TfGrid`, 중복 선택 체크박스)
  - ⚠ TF 그리드 옆에 **표시/숨김 버튼을 넣지 말 것** (2026-08-13 넣었다가 사용자 요청으로 제거).
    지표 행의 체크박스와 같은 값(`indicators.pivot`)이라 중복이다.
    지표를 끄고 켜는 곳은 체크박스 하나뿐이다 — `TfGrid`가 수동 구조와 공유 컴포넌트라
    한쪽에 붙이면 양쪽에 다 생기는 문제도 있다
  - ⚠ 수동 구조의 `struct.tfs`(구조 표시)·RSI의 `rsi.tfs`(구간 배경만)와 **뜻이 다르다**.
    저쪽 둘은 "어느 TF에서 보여줄지"(표시 필터)고 이쪽은 **계산 대상 TF**다.
    컴포넌트(`TfGrid`)만 공유한다
- 각 TF의 캔들은 `usePivotLevels`가 **Binance REST로 직접** 받아 온다(TF당 700봉).
  차트는 한 번에 한 TF만 들고 있어서 차트 캔들로는 불가능하다
  - 재조회는 그 TF의 **다음 봉 마감 직후**, 최대 30분 간격(`MAX_REFETCH_MS`).
    1d·1w를 봉 길이대로 두면 페이지를 켜 둔 채 며칠이 지나도 갱신되지 않는다
  - 선택에서 뺀 TF의 캔들도 캐시에 남긴다 — 다시 체크할 때 네트워크 없이 즉시 뜬다
  - 파라미터만 바꾸면 재조회 없이 계산만 다시 한다
- ⚠ 그래서 레벨 좌표가 **봉 인덱스가 아니라 timestamp**(`firstT`)다. 렌더러가 `tsToIdx`로
  현재 차트 기준 인덱스로 바꾼다 (수동 구조가 전 TF 공유되는 방식과 같다).
  `renderPivotLevels`가 캔들 배열을 인자로 받는 이유
- ⚠ **겹치면 상위 TF만 남긴다** (`combineTfLevels`). 1h와 4h가 사실상 같은 가격을 짚는 일이
  흔한데(실측: 1h·4h·1d 14개 → 10개), 그대로 두면 몇 px 차이로 선과 라벨이 겹쳐 못 읽는다.
  판정 기준은 **하위 TF 자신의 병합 폭(`tol`)** — 애초에 같은 레벨로 묶였을 거리다
- **선 오른쪽 끝의 작은 TF 태그**(`4h` 등)는 이것 때문에 필요하다 — 여러 TF가 섞이면 색·진하기
  만으로 출처를 알 수 없다. "강도는 숫자로 적지 않는다"와 상충하지 않는다(그건 진하기가 이미
  말하는 정보였고, TF는 다른 단서가 없다). 스타일은 EMA 우측 라벨과 같은 규칙
- 기본 `tfs = ["1h","4h","1d"]`. 전 TF(7개)를 켜면 중복 제거 후에도 19줄까지 나오지만,
  상위 TF 레벨 대부분은 y 범위 밖이라 실제로 화면에 그려지는 건 그보다 훨씬 적다
- ⚠ 계산은 **봉마감 기준**이다(의도). 피벗은 오른쪽 확인봉이 필요해 마지막 `pivot_bars` 봉에서
  어차피 안 생기고, 틱마다 돌리면 현재가가 레벨을 스칠 때 지지↔저항 색이 깜빡인다

### 트렌드 라인 / 채널 / 원
- `useTrendLines.js`가 lines/channels/circles를 각각 `useDrawableStore`로 관리 → localStorage 영구 저장
- 트렌드라인: `line_ep`(끝점) / `line_move`(몸통) / Delete로 삭제
- 채널: `channel_ep`(끝점) / `channel_move`(몸통) / `channel_offset`(미러선 폭)
- 원: `circle_move`(이동) / `circle_radius`(반지름)
- 선택된 도형: 금색(#f0b90b) + 핸들 표시

### 피보나치 되돌림 (2026-08-14 / 지표 분리 2026-08-15)
트레이딩뷰의 Fib Retracement 포팅. **선/채널/원과 같은 계열의 도형**이다
(`useDrawableStore("fibs")`, 좌표가 timestamp라 전 TF 공유).

⚠ **지표가 아니다 — 지표 메뉴에 행이 없고 전역 파라미터도 없다** (2026-08-15 사용자 요청).
한때 `Fibonacci` 체크박스가 있었고 그게 OFF면 렌더·히트에서 빠지고 TopBar 버튼도 죽었는데,
**"지표를 선택해야만 버튼이 활성화된다는 게 이상하다"**는 지적으로 지웠다. 선·채널·원 어느
것도 그런 관문이 없다. 지표 메뉴에 있던 유일한 근거였던 전역 레벨 목록도 도형별로 옮겼다.
되살리려면 `indicators.fib`·`indicatorParams.fib`(프론트·백엔드 DEFAULTS)·`showFib`·
`visibleFibs`·`fibEnabled`·`FibLevelPanel`이 전부 다시 필요하다 (같이 삭제됨).

- **데이터**: `{ id, t1, p1, t2, p2, opacity, locked, alert, levels }` — localStorage `"fibs"`
  - `levels` = 표시할 레벨. **도형별**이다. undefined면 기본 7개 —
    기존에 저장된 도형이 새 필드 때문에 선 하나 없이 뜨면 안 된다 (구조의 `showChoch`와 같은 규칙)
- **그리기**: TopBar `피보나치` 버튼(또는 `f`) → **2클릭** (원과 같은 구조).
  스냅 없음 — 트렌드라인·원과 같은 자유 좌표다
- **편집**: 앵커 끝점 드래그(`fib_ep`) / 몸통 드래그로 전체 평행이동(`fib_move`) / `Delete`로 삭제.
  잠금(`l`)·투명도(`[` `]`)·근접 알림(`a`)은 다른 도형과 완전히 동일
- **계산**: `chart/fib.js`의 순수 함수. **로그 모드에서는 로그 보간**을 쓴다(트뷰와 동일) —
  선형으로 계산하면 로그 차트에서 0.5 선이 두 앵커의 시각적 한가운데에 놓이지 않는다.
  채널(`ch.isLog`)과 달리 생성 시점이 아니라 **현재 스케일**을 본다: 피보나치는 "지금 보고 있는
  축에서의 비율"이 곧 의미라 축을 바꾸면 같이 따라가야 한다 (실측: 로그 0.5 = 기하평균과 일치)
- **근접 알림**: `useTrendLineAlert`이 **레벨 가로선 각각**을 본다 (0.2% / 히스테리시스 0.3%).
  토스트에 어느 레벨인지 비율로 찍는다(`피보나치 0.786 근접 (아래) $62,900`).
  한 번 울리면 그룹 키로 잠가 도형당 하나만 뜬다 — 레벨이 7~10개라 안 그러면 토스트가 쌓인다
- **표시할 레벨은 도형 더블클릭 팝업에서 고른다** (`LineOpacityPopup`의 `FibLevelRow`,
  투명도 슬라이더 아래 체크박스 10개 + `기본값` 버튼). 그 도형에만 적용된다
  - 정렬·중복 제거는 **저장할 때** 끝낸다(`normFibLevels`가 `FIB_ALL_LEVELS`로 filter).
    읽는 쪽(`fibLevelsOf`)은 배열을 그대로 돌려준다 — 마우스 이동마다 도는 경로라
    매번 새 배열을 만들면 memo가 전부 깨진다
  - 전부 끄면 가로선이 사라지고 **앵커 대각선만** 남는다. 그래서 히트 판정이 대각선도
    잡는다 — 안 그러면 도형을 고를 데가 없어져 팝업을 다시 열 방법이 사라진다

#### ⚠ 사용자 확정 사양 (2026-08-14, 임의 변경 금지)
**만들기 전에 트레이딩뷰 기본값을 나란히 놓고 고른 결과다.** "트뷰 기본은 저쪽"으로 되돌리지 말 것.
코드에는 `[F1]`~`[F5]` 번호로 같은 내용이 달려 있다 (`chart/fib.js`, `components/Chart/Fibs.jsx`).

| 결정 | 되돌리면 생기는 문제 |
|---|---|
| **[F1] 레벨 목록은 도형별 하나** (더블클릭 팝업) — 전역 값 없음 ※2026-08-15 변경 | 전역·도형별 두 값이 생기면 AND인지 덮어쓰기인지가 UI 어디에도 안 드러난다 (`struct.show_choch`에서 겪은 문제). **값이 하나라는 게 요점**이고, 그게 어디 있느냐는 그다음이다 — 2026-08-14~15은 같은 이유로 "전역 하나"였다 |
| **[F2] 구간 채우기 없음 — 선만** | 트뷰 기본은 반투명 밴드지만 거절됐다. 캔들 위에 색이 깔린다 |
| **[F3] 라벨은 비율만** — 가격·% 병기 없음 | 가격은 크로스헤어가 답한다. CHoCH 마크에서 글자를 다 걷어낸 기조와 같다 |
| **[F4] 레벨 선은 두 앵커 사이에만** — 오른쪽/양쪽 연장 없음 | 연장하면 현재가 구간까지 가로선이 덮는다 |
| **[F5] 첫 클릭 = 추세 시작(레벨 1), 둘째 = 추세 끝(레벨 0)** — 트뷰와 동일 | 뒤집으면 0.236과 0.786이 자리를 바꿔, 같은 두 점인데 트뷰와 다른 가격에 선이 생긴다 |
| 신규 도형은 기본 7개(0·0.236·0.382·0.5·0.618·0.786·1) 체크 / 확장 3개(1.272·1.414·1.618)는 후보에만 | 확장은 되돌림이 아니라 돌파 후 목표가라 성격이 다르다 |
| 알림 ON 스타일에 **글로우 없음** (호박색 + 점선만) | 레벨이 7~10줄이라 글로우를 겹치면 그 가격대가 통째로 흐릿한 띠가 되어, 거절된 [F2] 채우기와 똑같이 보인다 |
| 레벨선 개별 드래그 없음 | 위치가 곧 비율이라 하나만 옮기면 정의가 깨진다 |

- ⚠ SVG는 **뷰포트로 자른다**(`clipSegmentX`) — 트렌드라인·채널과 같은 이유인데,
  도형 하나가 선 7~10개라 배율이 그만큼 더 크다 (`chart/svgGeom.js`의 5m 실측 참고)
- ⚠ 렌더·히트 판정·근접 알림이 **같은 레벨 배열**을 봐야 한다 → 셋 다 `fibLevelsOf(fb)` 하나를 부른다
  (`Fibs.jsx` / `hitDetection.findHitFib` / `useTrendLineAlert`).
  각자 만들면 팝업에서 끈 레벨이 클릭에 잡히거나, 보이지도 않는 선에서 알림만 울린다
- ⚠ 히트 우선순위는 채널 > 원 > 선 > **피보나치** > 수동 구조 > 자동 ZZ.
  `buildHitChain` 5번(선택)과 `onDoubleClick`(팝업)의 순서를 **같게 유지할 것** —
  어긋나면 "클릭하면 선이 잡히는데 더블클릭하면 피보나치 팝업이 뜬다"가 된다

### 보조지표 (프론트엔드 계산, 백엔드 불필요)
- **Volume**: 거래량 캔버스 (가시 범위 maxVol 정규화, useVolResize로 높이 조절)
  - 바 색상 `vol.colorMode`: `neutral`(단색) / `candle`(양봉·음봉 색). 실시간 색 전환은 `candle`에서만 보인다
- **EMA**: 다중 EMA (id/period/color/enabled 속성, useMemo 캐시로 무한루프 방지)
- **Pivot Levels**: 스윙 피벗을 가격대로 묶은 지지/저항 — 위 "Pivot Levels" 절 참고
  (`chart/pivotLevels.js` 순수 함수 + `usePivotLevels` 훅). **멀티 TF** — 선택한 TF들의
  캔들을 REST로 따로 받아 계산하므로, 여기서만 차트 캔들을 쓰지 않는다
- **FVG**: 3캔들 패턴으로 갭 검출, 중간값 50% 진입 시 소멸
- ⚠ **FVG·오더블록 박스는 최신 봉까지만 채운다** (2026-08-15 사용자 요청,
  `overlayRenderers.js`의 `boxRightEdge`). 화면 오른쪽 끝(IW)까지 늘이면 마지막 봉 오른쪽
  빈 자리(미래 영역)에도 색이 깔려, 아직 오지 않은 구간에 근거가 있는 것처럼 보인다.
  마지막 봉의 오른쪽 가장자리에 맞추려고 봉 절반을 더한다(`renderRsiZones`와 같은 방식).
  과거를 보는 중이라 마지막 봉이 화면 밖이면 IW로 클램프한다
- **오더블록**: 스윙 감지 → BOS 탐지 → 직전 역방향 캔들을 OB로 등록, 미티게이션 시 소멸
- **Structure Zigzag (ZZ)**: `기타/structure_zigzag.pine` 포팅 — 왼쪽 left_bars 봉만 보는 피벗(오른쪽 확인봉 없음),
  ※ **bias 규칙은 Custom Structure Zigzag(deriveStructure.js)와 동일하게 통일됨** (2026-08-12/13)
    — 실제 돌파가 있을 때만 bias를 세우고, 돌파하면 CHoCH 여부와 무관하게 bias는 항상 갱신한다.
    마크는 **같은 방향 추세가 아닐 때** 찍는다 (bull `bias !== 1` / bear `bias !== -1`) —
    미정(0) 상태의 **첫 돌파도 CHoCH**다 (2026-08-13 사용자 요청).
    `기타/structure_zigzag.pine`도 같이 수정했으므로 **한쪽만 고치면 트레이딩뷰와 결과가 어긋난다.**
  꼬리(고가/저가) 기준 판정, Wilder ATR × atr_mult 미만 스윙은 노이즈로 제거,
  꼭짓점을 회색 지그재그로 연결 + 구조 고/저점 돌파 시 CHoCH 마크
  ※ **CHoCH 마크는 수동 구조(Structures.jsx의 ChochMarks)와 픽셀 단위로 같은 규칙** (2026-08-12 통일):
    - **가로선 끝 = 레그 선분과 레벨의 교차점**(`crossIdx`, 소수 bar index). 피벗 봉에서 끊으면
      화면의 직선 지그재그와 어긋나 **가로선이 오른쪽으로 삐져나온다**(사용자 지적으로 수정)
    - **진행 중 레그(curSeg)에서 나온 CHoCH = 점선, 확정분 = 실선.** 다음 피벗으로 레그가
      확정되면 curSeg가 교체돼 자동으로 실선이 된다 (수동 구조의 `ev.live`와 같은 의미)
    - 끝점·실선/점선은 **저장하지 않고 `computeStructureZigzag`가 매번 파생한다** — 진행 중
      레그는 끝점이 계속 연장되므로 교차점도 같이 움직여야 한다. 누적 기록(`_st.chochs`)은
      건드리지 않으므로 forward-only 원칙은 그대로다
    - 화면 밖 판정 / 최소 폭 2px / 불투명도 1도 동일. 한쪽만 바꾸지 말 것
    - ⚠ **글자는 없다 — 가로선 하나뿐이다** (2026-08-14 사용자 요청).
      `"CHoCH"` → `"C"` → 제거 순으로 줄였다. 마크가 여러 개 붙으면 글자끼리 겹쳐
      복잡해 보인다는 이유고, 방향은 **색(초록/빨강)과 선 위치**가 이미 말해준다.
      되살릴 거면 ZZ·수동 구조·Pine **셋을 같이** — 하나만 되살리면 지표마다 다르게 보인다
    - `기타/structure_zigzag.pine`도 같이 수정했다 (교차점 + 점선→실선 전환 + 라벨 제거).
      `label.new` 호출이 하나도 남지 않아 `labelSize` 상수도 지웠다
  ※ 지그재그 선 자체는 ZZ·수동 구조가 다르다 — ZZ의 마지막 세그먼트는 실제 피벗 구간이라
    실선이고, 수동 구조의 진행 중 레그는 "마지막 꼭짓점 → 현재가" 투영이라 점선이다
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
  ※ 세그먼트는 `getZzSegments()`로 노출 (bar index 좌표) — 레그 등락률 hover가 히트 판정에 쓴다
- **RSI 패널**: Wilder's smoothing, 별도 캔버스, 드래그로 높이 조절 (useRsiResize)
  ※ RSI 다이버전스 지표는 **없다** — 2026-08-12에 한 번, 2026-08-13에 재작성분까지
    사용자 요청으로 지웠다. RSI 패널에는 RSI 선 말고 아무 오버레이도 없다
  ※ **RSI 패널(선)은 전 TF 공통이다.** 지표 체크박스(`indicators.rsi`)만 본다 —
    `rsi.tfs` 필터는 패널을 건드리지 않는다 (아래 "구간 배경" 참고)
- **RSI 과매수/과매도 구간 배경** (2026-08-13, `overlayRenderers.js::renderRsiZones`)
  - RSI가 과매수(≥ob) / 과매도(≤os)인 봉 구간을 **메인 차트**에 세로 밴드로 칠한다
  - **메인 차트에만.** RSI 패널에는 밴드를 넣지 않는다 (사용자 선택)
  - **과매수 = 빨강 / 과매도 = 파랑** (`CANVAS_C.RSI_ZONE_OB` `#f6465d` / `RSI_ZONE_OS` `#60a5fa`)
    — 2026-08-13 사용자 요청으로 변경. 그전에는 둘 다 파랑이었고 "어느 쪽인지는 RSI 패널이
    답한다"였는데, 과매수는 붉은 계열이 직관적이라는 판단으로 나눴다. 되돌리지 말 것
    - ⚠ **RSI 패널의 선 색도 같은 토큰**이다 (`rsiRenderer.js`의 `RSI_OB_C`/`RSI_OS_C`).
      한쪽만 바꾸면 같은 조건인데 패널은 파랑, 배경은 빨강처럼 어긋난다
    - ⚠ 그래서 `computeRsiZones`는 구간에 `kind`(`"ob"`/`"os"`)를 달고, **종류가 바뀌면
      구간을 끊는다**. 안 끊으면 사각형 하나가 두 상태를 덮어 색을 정할 수 없다
  - **봉 단위로 끊는다** — RSI 선처럼 임계값 교차점을 보간하지 않는다. 밴드는 캔들과
    나란히 놓이는 배경이라 봉 경계에서 끊겨야 어느 봉이 과매수였는지 눈으로 맞아떨어진다
  - **연속 구간은 사각형 하나로 합친다** — 봉마다 fillRect하면 경계에서 알파가 겹쳐
    세로 줄무늬가 생긴다 (반투명 사각형을 이어 붙일 때의 고전적 문제)
  - **캔들보다 먼저 그린다**(배경). 다른 오버레이와 달리 **pan 중에도 그린다** —
    사각형 몇 개라 비용이 없고, 드래그할 때만 사라지면 구간이 깜빡이는 것처럼 보인다
  - **마지막 구간과 같은 종류로 연속된 꼬리만 칠한다** (2026-08-15 사용자 지정,
    `overlayRenderers.js`의 `lastRsiZoneRun`). 목록이 `… ob ob os os os`면 뒤의 `os` 셋만 나오고,
    반대 종류를 만나는 순간 끊긴다("과매수 직전까지"). 마지막 둘의 종류가 다르면 **하나만** 뜬다
    - ⚠ **개수 조절(`rsi.zone_max`) 방식으로 되돌리지 말 것** — 키·슬라이더·`RSI_ZONE_MAX`
      상수까지 함께 제거됐다. 그 방식은 지금 흐름과 무관한 옛 구간까지 같이 물들었고,
      몇 개를 보여줄지가 데이터가 아니라 사용자 설정에 달려 있었다
      (실측 BTC 1h 1000봉: 전체 26개 중 "최근 5개"는 `ob os os os os`로 **종류가 섞였고**,
      새 규칙은 `os` 4개만 나온다)
    - 판정은 **화면이 아니라 전체 목록 기준**이다 — 뷰포트에 따라 달라지면 스크롤할 때마다
      밴드가 다른 데 찍혀 같은 지표로 보이지 않는다 (이 원칙은 그대로)
  - **표시 타임프레임 필터** `rsi.tfs` (중복 선택, **기본 전 TF**, 2026-08-14 사용자 확정) —
    IndicatorMenu RSI ⚙ → `구간 배경 표시 타임프레임`. 여기서 고른 TF에서만 밴드가 칠해진다
    - ⚠ **거르는 건 배경뿐이다. RSI 패널(선)은 전 TF에서 계속 보인다.**
      처음엔 `showRsi` 하나로 지표 전체를 걸렀다가 사용자가 정정한 요구사항이다.
      `App.jsx`가 두 값을 나눠 갖는다: `showRsi`(패널·레이아웃 높이) /
      `showRsiZones = showRsi && rsi.tfs.includes(interval_)`(배경). 다시 합치지 말 것
    - 이유: 배경은 캔들 위에 깔리는 것이라 TF마다 밀도가 크게 다르지만(5m은 온통 물든다),
      RSI 선 자체는 어느 TF에서나 보고 싶은 값이다
    - ⚠ **기본값은 전 TF**다. `struct.tfs`처럼 `["1h"]`로 두지 말 것 — 새 필터가 기본으로
      좁으면 기존 사용자에게는 기능이 사라진 것처럼 보인다
    - ⚠ **구간 계산(`computeRsiZones`)은 걸러진 TF에서도 돌린다** — 안 그리는 TF에서도
      메뉴의 "검출된 과매수/과매도 N개"(= 개수 슬라이더 상한)가 살아 있어야 미리 맞춰둘 수 있다.
      `zone_bg`가 꺼져 있어도 계산하는 것과 같은 이유 (candleRenderer.js)
    - ⚠ **알림은 이 필터와 무관하다.** `useAlertMonitor`는 TF별 WebSocket을 따로 감시하고
      설정도 NotificationMenu에 따로 있다 — 배경을 끈 TF의 RSI 알림도 계속 울려야 한다
    - 라벨에 "구간 배경"을 꼭 적을 것. 그냥 "표시 타임프레임"이면 RSI 전체가 사라지는 줄 안다
  - **전체 표시 토글** `zone_all` (IndicatorMenu RSI ⚙ → `구간 배경 전체 표시`, 기본 **OFF**,
    2026-08-15 사용자 요청) — ON이면 위 "마지막 연속 구간" 규칙을 건너뛰고 **검출된 전 구간**을 칠한다
    - ⚠ **개수 슬라이더(`zone_max`)의 부활이 아니다.** 노브가 아니라 on/off고, 켜도
      "몇 개"를 사용자가 고르지 않는다 — 데이터가 정한 전부가 그대로 나온다.
      다시 슬라이더로 바꾸지 말 것 (`zone_max`를 지운 이유가 그대로 살아 있다)
    - ⚠ 기본은 OFF다. ON이 기본이면 5m처럼 구간이 잦은 TF에서 화면이 통째로 물든다 —
      그게 애초에 "꼬리만" 규칙이 생긴 이유다
  - 토글: IndicatorMenu RSI ⚙ → `구간 배경`(`zone_bg`, 기본 ON). RSI 지표가 꺼지면 함께 꺼진다.
    `검출된 과매수/과매도 N개` 행은 남아 있지만 이제 순수 정보 표시다(칠하는 건 마지막 연속 구간뿐)
  - ⚠ 구간 계산(`computeRsiZones`)은 **`zone_bg`가 꺼져 있어도 돌린다** — 메뉴의
    `검출된 …N개`가 배경을 끄면 0으로 주저앉으면 안 되기 때문. rsiData 참조 비교
    캐시라 봉마감 전까지 재계산이 없어 비용은 없다. RSI 지표 자체가 꺼지면 `clearRsiZones()`
  - ⚠ `rsiData`는 React `candles` 기반이라 **진행 중 봉은 반영되지 않는다**(봉마감 시 갱신).
    RSI 패널도 같은 데이터를 쓰므로 둘은 항상 일치한다 — 여기만 `candlesRef`로 앞서가게
    만들면 패널의 선과 배경이 어긋나 보인다
  - `ChartArea`의 RSI useEffect가 `redrawRSI` + **`redrawCanvas`**를 같이 부른다
    (밴드가 메인 캔버스에 있으므로). `redrawChart`가 아닌 이유는 SVG 오버레이가 RSI와 무관해서

### 체결 감지
- **LIMIT 주문**: User Data Stream WebSocket (`orderWatcher.js`)으로 즉시 감지
  → `store`에 WATCHING 상태 → FILLED 이벤트 수신 시 `placeTPSL()` 실행
- **MARKET 주문**: 즉시 체결 → `placeTPSL()` 바로 실행
- **SCALE_IN/SPLIT_TP 체결**: store 제거 후 position/tpsl refetch 트리거
- 체결 발생 시 `statsCache.invalidateCache()` 호출 → 다음 /api/stats 요청 시 재계산

#### ⚠ TP/SL이 늦거나 아예 안 걸리던 문제 (2026-08-15 수정, 되돌리지 말 것)
실계좌에서 LONG 포지션이 **1.6시간 동안 SL 없이** 방치된 사고의 원인 4가지.
`trade_log.json` 실측상 **체결을 인지한 뒤 TP/SL 등록까지는 0.13~0.28초**다 —
느렸던 건 등록이 아니라 **"체결 인지"와 "화면 반영"**이었다.

| 결정 | 되돌리면 재발하는 문제 |
|---|---|
| `position.js`는 WATCHING 주문을 **직접 지우지 않는다** — `resolveOrphans`가 바이낸스에 물어본 뒤 CANCELED/EXPIRED/REJECTED일 때만 삭제 | 체결과 취소는 **둘 다** openOrders에서 사라진다. 구분 없이 지우면 store 항목이 없어져 `onFilled`(`!store.has`)·`pollForFills`·`reconcile`이 **전부** 대상을 잃고 TP/SL이 영구 미등록. 게다가 옛 유예(30초)가 reconcile 주기(60초)보다 짧아 삭제가 먼저 도달하는 게 일반적이었다 |
| LIMIT 접수 후 `verifyImmediateFill`로 실제 상태를 **한 번 더 확인** | 호가를 먹는 지정가는 접수와 동시에 체결돼 UDS FILLED가 `store.set`보다 먼저 도착 → `!store.has(o.i)`로 버려진다. POST 응답 status만 믿어도 안 된다 — 바이낸스는 즉시 체결돼도 보통 `NEW`를 돌려준다 |
| `onFilled`은 **WATCHING일 때만** 실행 (멱등) | UDS·verifyImmediateFill·resolveOrphans·poll·reconcile 다섯 경로가 같은 주문에 동시 도달할 수 있다 |
| `checkExistingTPSL`은 `{ hasTP, hasSL }` — **`hasTP \|\| hasSL` 금지** | SL만 걸리고 TP가 실패해도 "있음"이 되어 reconcile이 TPSL_PLACED로 확정 → 빠진 쪽이 영영 재시도되지 않음 |
| MARKET 성공 시 `push.pushUpdate([...,"tpsl"])` + `executeOrder`가 `_refetchTpsl()` 호출 | 거래소엔 0.2초 만에 걸려 있는데 화면엔 60초 폴링 전까지 안 나온다. **반대쪽 포지션을 이미 들고 있으면 더 나쁘다** — `useTpsl`의 `hasPos`가 계속 true라 "포지션 생김"에 의한 즉시 조회가 아예 트리거되지 않는다 |
| `useTpsl`은 포지션 유무를 `useStore.getState()`로 **즉시** 읽는다 (클로저 금지) / push는 **position → tpsl 순서** | 체결 push는 둘을 함께 보내는데, 클로저의 `hasPos`는 아직 false라 조회를 건너뛰고 TP/SL을 **지워버린다** |
| `placeTPSL` 실패 시 **거부 사유**를 `trade_log.json`에 남긴다 (`errors`) | 예전엔 실패 타입만 남겨서 나중에 로그를 봐도 바이낸스가 왜 거절했는지 알 수 없었다 (콘솔은 이미 사라진 뒤) |
| reconcile이 **SL 없는 포지션을 상시 감시** → critical 알림 (사이드당 1회 래치) | `recoveryService`의 안전망은 **서버 시작 때만** 돈다. 켜 둔 채로 생긴 무방비 포지션은 아무도 알려주지 않았다 |

- ⚠ 미해결: 포지션 보유 중 추가 진입에서 `placeTPSL`이 **5회 전부 거부**된 사례가 3건 있다
  (`trade_log.json`, 전부 31초 = 1+2+4+8+16 재시도 풀타임, SL 실패 → TP 스킵).
  바이낸스 거부 사유는 당시 기록이 없어 특정하지 못했다 — 이제 `errors`에 남으므로
  다음에 재현되면 그 값을 볼 것 (과거 `git log 1f1dfc3`에서 헷지모드 **-4130** 이력 있음)

### 차트 렌더링
- 캔들: D3 imperative (`renderCandles`) → `canvasRef`에 직접 드로우
- 거래량: D3 imperative (`renderVolumeCanvas`) → `volCanvasRef`에 별도 드로우
- RSI: D3 imperative (`renderRSICanvas`) → `rsiCanvasRef`에 별도 드로우
- FVG/OB/SR/EMA/RSI 구간 배경: 캔버스 렌더 (`overlayRenderers.js`)
- 오버레이 (박스/포지션 라인/트렌드라인/채널/원/피보나치/수동 구조): React SVG (`ChartSvg` 내)
- `useChartRenderer.js`의 `forceUpdate`(renderTick)로 캔버스 렌더 후 React 오버레이 동기화
- pan 중: `redrawChart()`가 redrawCanvas+redrawVolume+redrawRSI+forceUpdate 동시 호출

### 리플레이 트레이딩 (2026-08-14~15)
트레이딩뷰 바 리플레이에 해당. 과거 구간을 재생하며 **가짜 돈으로 연습**한다.
`frontend/src/replay/` + `hooks/useReplay.js` + `components/ReplayBar.jsx` + `store/replaySlice.js`.

- **같은 화면 + 모드 전환**이다(별도 페이지 아님, 2026-08-14 사용자 확정). TopBar의 보라색
  `▶ 리플레이` 버튼 → TopBar 아래에 `ReplayBar` 등장. 보라(`#a78bfa`)를 쓴 이유는 금색·초록·빨강이
  실거래에서 이미 뜻을 갖기 때문이다 — **이 바가 떠 있다 = 화면이 과거다**
- **`replayOn` 하나가 모든 분기의 기준**이다. 캔들 소스·지표 미래 차단·알림·주문 경로가 전부 이걸 본다

#### ⚠ 실주문 차단 (안전장치)
- `api/client.js`의 `setReplayGuard` — 리플레이 중 **GET 외 모든 요청을 던진다**
- `orderSlice`의 주문 액션 12개는 각각 첫 줄에서 `paperActions`로 위임한다
- ⚠ **새 주문 액션을 추가하면 위임 한 줄도 같이 넣을 것.** 빠뜨리면 그 액션만 에러가 난다
  (조용히 실주문이 나가지는 않는다 — 그게 가드를 이중으로 둔 이유다)
- **`replayOn`은 저장하지 않는다** — 새로고침하면 항상 실거래로 시작. 페이퍼 화면을
  실거래로 착각하는 사고를 막는다. 저장하는 건 시작 날짜뿐
- 실계좌 폴링(`useBalance`/`usePosition`/`useTpsl`/`useDailyLoss`)은 리플레이 중 멈춘다.
  안 그러면 페이퍼 포지션이 몇 초마다 실계좌 값으로 덮인다

#### 하위 TF 구동 (`replay/timeframes.js`)
1h 리플레이를 **5m 12틱**으로 굴린다 (4h→15m, 1d→1h …). 봉 단위 재생은 거절됨.
- **근거는 실측**: 구동 TF로 **99.5%의 봉에서 고가·저가 순서가 판명**되고, 어느 쪽이 먼저인지는
  거의 반반(1h 48.4/51.1)이다. 즉 "SL 우선" 같은 고정 규칙은 **모호한 봉의 절반에서 틀린다**
- 남는 0.5%(고가·저가가 같은 구동봉 안)는 체결 엔진이 SL 우선으로 처리한다

#### 체결 규칙 (`replay/paperBroker.js`) — 전부 "모르면 불리하게"
| 규칙 | 되돌리면 생기는 문제 |
|---|---|
| 봉 하나에 TP·SL 둘 다 닿으면 **SL 우선** | 유리한 쪽을 고르면 연습 성적이 실제보다 좋게 나온다 |
| 체결 판정은 **방향**(`crossedUp`/`crossedDown`) — "범위 안에 있나"가 아님 | 갭이 손절을 통째로 건너뛴다. 롱 SL 90인데 고가 85로 갭 하락하면 포지션이 살아남았다(실제 버그) |
| SL·강제청산이 갭이면 **갭 시가**에 체결 | 청산가에 그대로 체결시키면 손실이 작게 나온다 (−$9.60 vs −$30.00) |
| 처리 순서 = 펀딩비 → 진입 → 강제청산 → 종료주문 | 진입을 뒤로 미루면 "같은 봉에서 들어갔다 손절"이 사라진다 |
| 승패는 **수수료를 뺀 뒤**로 판정 | +$0.50 벌고 수수료 $4 낸 거래가 "승"이 되어 승률이 부풀려진다 |
| "거래 1건" = **청산 1건** | 포지션 단위로 묶으면 "절반 익절 + 절반 손절"이 뭉개진다 |
| 손실 0이면 PF는 `null`("—") | "∞"를 띄우면 표본 2건짜리가 완벽한 전략처럼 보인다 |
- 수수료 메이커 0.02% / 테이커 0.04%, 펀딩비는 **그 시점 실제 이력**을 8시간마다 반영
- 청산가는 격리 근사(유지증거금률 0.4%). SL이 청산가보다 멀면 **청산이 먼저** 터진다(정상)
- 스냅샷 3종(position/tpsl/balance)은 **백엔드 라우트와 글자 그대로 같은 모양**이다.
  그래서 사이드바·차트 오버레이가 리플레이인지 모른 채 그대로 돈다 — 필드를 바꾸지 말 것
- **일일 손실 한도는 연습에도 건다**(`replay/dailyLoss.js`, 재생 시각의 UTC 하루 기준).
  연습에서만 무제한이면 실전에서 막히는 매매를 계속 연습하게 된다

#### 동작 규칙
- ⚠ **뒤로 시크하면 연습 계좌가 초기화된다.** 안 그러면 "손실만 지우고 다시 하기"가 된다.
  앞으로 시크는 건너뛴 봉을 브로커에 먹여 체결을 재현하므로 계좌가 유지된다
- **세션 길이 상한 90일**(`SESSION_MAX_MS`). 끝을 "현재"로 두면 2024년을 고른 순간 구동 봉이
  23만 개(155회 요청, 1분+)가 된다(실측). 시작일이 바뀌면 `setReplayRange`가 끝도 다시 잡는다
- **세션은 localStorage에 저장된다**(`replay/session.js`). 새로고침해도 계좌·포지션·진행 위치가
  남는다. 진행 위치를 **커서가 아니라 시각으로** 저장하므로 도중에 TF를 바꿔도 이어진다.
  구간(시작·끝)이 다르면 복원하지 않는다 — 진입가가 화면 밖인 유령 포지션이 되기 때문
- **모드 전환·시크 뒤에는 `chartActionsRef.current?.resetDomain()`을 부른다.** 가격대가 통째로
  바뀌는데 y축이 그대로면 캔들이 화면 밖으로 나가 차트가 텅 빈 것처럼 보인다(실제 증상)
  - ⚠ **"차트가 납작하다"의 진짜 원인은 `getScales`의 폴백이었다** (2026-08-15).
    도메인이 비어 있는 짧은 순간(리셋 직후, TF 전환 중)마다 폴백이 걸리는데, 예전엔
    x는 최근 200봉인데 y는 **로드된 3000봉 전체의 고저**였다. 실측: 캔들이 화면 세로의
    **12%**만 차지 → 지금은 89% (`scales.js`의 `FALLBACK_BARS` 주석).
    휠을 굴리면 `useChartInteraction`이 보이는 봉으로 y를 다시 계산해 그때서야 정상으로 보였다.
    → **폴백 y는 x 도메인 안의 봉만 본다.** 폭(300)·패딩(0.06)은 `applyInitialDomain`과 같은 값
  - ⚠ **`resetDomain`의 `defer`를 정확히 고를 것** — 둘 다 실제로 버그를 냈다
    - `resetDomain({ defer: true })` = 버리기만. **TF 전환처럼 `candlesRef`에 아직 옛 캔들이
      들어 있을 때 반드시 이것.** 즉시 잡으면 **옛 TF의 봉 개수·가격대로 도메인이 확정**되고
      `isInitialLoadRef`까지 꺼져서 새 캔들이 와도 다시 안 잡는다
      (증상: "TF를 바꿨을 때 엉뚱한 곳을 보여준다")
    - `resetDomain()` = 즉시 다시 잡음. **모드 전환·시크처럼 `candlesRef`가 이미 새 데이터일 때.**
      여기서 비우기만 하면 candles identity가 안 바뀌어 `[candles]` 이펙트가 안 돌고
      아무도 도메인을 다시 잡지 않는다
  - ⚠ **호출 조건에 `candleLoading`을 쓰지 말 것.** 그건 "언제 부를지"지 "부를지 말지"가 아니다.
    로딩이 false로 떨어지는 순간마다 리셋하면 ① 페이지 첫 로드에서 ChartArea가 방금 잡아둔
    도메인을 도로 지우고(위 납작 증상의 방아쇠였다) ② TF 전환·WS 재로드 때마다 사용자의
    팬/줌이 날아간다. `replayOn`/`replayStartMs`가 **실제로 바뀌었을 때만** 부른다 (App.jsx `domainKeyRef`)
- `engine.price`는 커서 0에서도 **null을 돌려주지 않는다**(직전 확정봉 종가). null이면 화면이
  `liveClose`에 남은 **오늘 시세**를 써서, 방금 진입한 포지션의 미실현이 −$2,104로 찍혔다
- ⚠ **나갈 때 `setReplayOn`이 `position`/`balance`/`tpsl`을 초기값으로 비운다** (2026-08-15).
  페이퍼 스냅샷은 실계좌와 **같은 슬롯**을 쓰므로, 안 비우면 실계좌 응답이 도착할 때까지
  연습 계좌가 화면에 남고 `usePositionCloseAlert`이 그 교체를 청산으로 오인해
  `롱/숏 포지션 종료`를 sticky 알림으로 띄운다 (연습에서 매매를 안 해도 뜬다 —
  진입 전 실계좌 포지션이 기준선으로 얼어붙고 나갈 때 **빈 페이퍼 스냅샷**과 비교되므로).
  - **반드시 `replayOn`과 같은 `set` 호출**에 둘 것. 나누면 "replayOn=false인데 position은
    아직 페이퍼"인 렌더가 한 번 생겨 같은 오알림이 재현된다
  - `syncPaper`도 **`replayOn`이 false면 아무것도 쓰지 않는다** — 종료 직후 재생 루프의
    setTimeout이 한 번 더 남아 `applyMove → syncBroker`로 도달할 수 있다
  - ※ 실거래 알림 동작은 **그대로다.** 리플레이 중에도 기준선(prevLong/prevShort)은 얼어 있어,
    연습하는 사이 실제로 청산된 포지션은 실계좌 값이 도착할 때 정상적으로 알림이 뜬다

#### 미래 누출 차단 — 리플레이의 품질을 결정하는 부분
- `usePivotLevels(params, endMs)`: **반드시 재생 시각까지만** 계산. 없으면 2023년을 재생하는 중에
  오늘까지의 고/저점으로 만든 지지·저항이 그려진다
- `useAlertMonitor(..., enabled)`: TF별 실시간 RSI 감시를 끈다 ("지금 1h가 과매수"는 재생 시점에서
  알 수 없는 사실이다). ↔ **차트 기반 알림(추세선 근접·CHoCH)은 살아 있다** — 리플레이 가격으로 동작
- `useMarketInfo(replayNowMs)`: 펀딩비·공포탐욕을 그 시점 이력으로. 카운트다운도 **재생 시각** 기준이라
  일시정지 중에는 멈춘다. 공포탐욕(api.alternative.me)은 **2018-02-01부터** 있어 전 구간을 덮는다
- `usePositionCloseAlert` / `useRealtimeData`의 `criticalAlert`: 실계좌 알림이라 리플레이 중 억제
- ⚠ **가드는 "실주문 차단"이지 "쓰기 금지"가 아니다.** 계좌와 무관한 UI 설정은 통과시킨다
  (`api/client.js`의 `ALLOW_IN_REPLAY` — 지금은 `/api/indicator-params`).
  막아 뒀더니 `useIndicatorParams`가 `.catch(() => {})`로 삼켜서, 연습 중에 바꾼 지표 설정이
  아무 말 없이 사라졌다
- 레버리지 변경은 리플레이에서 **페이퍼 포지션에 직접 적용**한다(`SidebarPanel`).
  백엔드 POST를 그대로 두면 가드에 막혀 에러만 뜬다

#### 도형 분리 (`replay/drawingKeys.js`)
리플레이 중에는 `replay_` 접두사 키를 쓴다. 실거래 도형은 **보이지 않는다**.
- ⚠ **"미래 좌표만 숨기기"로는 안 풀린다.** 5월 저점 두 개를 이은 선은 좌표가 전부 과거지만
  **8월에 그은 것**이다. 그 선이 지켜졌다는 걸 알고 그었으므로 좌표가 과거여도 hindsight다.
  판단 기준은 좌표가 아니라 **"언제 그렸나"**이고, 실거래 모드에서 그린 건 전부 재생 시점 이후다
- ※ 예전엔 컨트롤 바에 `기존 도형` 토글이 있어서 실거래 도형을 **읽기 전용**으로 볼 수 있었다.
  2026-08-15 사용자 요청으로 **기능째 제거**됐다 — 되살리려면 `drawingKey`의 showLive 인자,
  `drawingReadOnly`, `useDrawableStore`의 readOnly, `replaySlice.replayShowLive`가 전부 다시 필요하다
- ⚠ `useDrawableStore`는 **키가 바뀌면 렌더 도중에 다시 읽는다**(useEffect 아님).
  useEffect로 하면 한 프레임 동안 실거래 도형이 깜빡이는데, 그게 이 기능이 막으려던 것이다
- **🎲(무작위 시점)를 누르면 연습 도형을 지운다** (2026-08-15). 시작일을 **직접 입력**할 때는
  지우지 않는다 — 같은 구간을 다시 보려는 의도일 수 있고, 🎲만이 "다 버리고 새로"라는 뜻이
  분명한 버튼이다 (사용자 확정)
  - 안 지우면 **메모리가 아니라 "유출"이 문제**다. 예전 연습 구간에서 그은 선이 새 구간에
    그대로 살아 있는데, 좌표가 멀어 화면에는 클리핑돼 안 보이면서 계산에는 계속 들어간다.
    특히 `useTrendLineAlert`의 `linePriceAt`은 선을 **현재 봉 시각까지 선형 외삽**하므로
    수평에 가까운 선은 몇 년 떨어진 구간에서도 근접 알림을 띄운다
    ("화면에 없는 선에서 알림이 온다" — 실제로 가능한 상태였다)
  - ⚠ **localStorage만 지우면 안 된다.** 키는 그대로(`replay_*`)라 `useDrawableStore`가
    다시 읽지 않고, React 상태에 남아 있던 도형이 다음 debounce 저장에 **되살아난다.**
    `reloadToken`(App의 `drawingGen`)을 같이 올려야 하고, 그 경로는 대기 중인 저장 타이머도 버린다
  - 연습 플랜 박스(`replay_drawing`)는 스토어에 있어 `clearReplayDrawings`가 못 건드린다 →
    App이 `setDrawing(null)`로 따로 비운다
  - 연습 계좌는 손댈 게 없다 — `session.js`는 **키 하나**(`replay_session`)에 구간을 값으로 넣어
    저장하므로 구간이 바뀌면 복원되지 않고 다음 저장에 덮인다 (구간별 키가 쌓이지 않는다)
- ⚠ **플랜 박스(`drawing`)도 나눈다** — 스토어에 있어서 처음엔 빠져 있었고, 그 탓에
  **리플레이 진입만으로 실거래 플랜 박스가 지워졌다**(App의 drawing↔pending 동기화가
  페이퍼 position의 pending 없음을 보고 `setDrawing(null)`). `uiSlice.swapDrawingStorage`가
  모드 전환 때 키(`drawing` ↔ `replay_drawing`)를 갈아끼운다.
  전환 전에 **보류 중인 debounce 저장을 먼저 흘려보내야** 이전 모드 박스가 새 키에 덮이지 않는다

#### 일부러 구현하지 않은 것
| 안 한 것 | 이유 |
|---|---|
| 구간 자동 연장 | 구간이 바뀌면 엔진을 다시 만들어야 해서 재생 위치·계좌가 초기화된다. 90일을 다 보면 시작일을 옮긴다 |
| 호가창 깊이 / 시장 충격 / 부분 체결 / 지정가 대기열 | "내 주문이 시장을 움직이지 않는다" 가정. 개인 규모에서는 무난하다 |
| 리플레이 구간별 도형 분리 | 연습용은 한 벌뿐. 구간마다 나누면 localStorage에 쓰레기가 쌓이고 "아까 그린 게 어디 갔나"가 된다 |
| 자본 곡선 그래프 | `tradeStats.js`의 `equityCurve()`는 있고 검산도 됐다. UI만 안 붙였다 |
| 1분 미만 구동 | 바이낸스 선물 klines 최소 단위가 1m이라 불가능 |

#### ⚠ 이 폴더만 상대 import에 `.js` 확장자를 붙인다
Vite는 양쪽 다 되지만 node ESM은 확장자가 없으면 못 찾는다. `pivotLevels.js`가 node에서 도는 건
import이 하나도 없어서고, 여기는 그렇지 않다. 확장자를 떼면 **"실제 응답으로 검산한다"는
이 계층의 설계 근거가 사라진다** (엔진·브로커·통계 로직은 전부 node에서 실측 검증했다).

## 실행
- 백엔드: 포트 3002 (`node server.js`)
- 프론트엔드: 포트 5174 (`npm run dev`)
- 한번에 실행: `start.bat`
