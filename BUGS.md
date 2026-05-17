# 코드 전수조사 결과 — 버그/이슈 목록

조사일: 2026-05-17
범위: backend 전체 + frontend src 전체 (CLAUDE.md 기준)

심각도:
- 🔴 **Critical** — 실거래 안전성 / 데이터 손상 / 자금 손실 가능
- 🟠 **High** — 핵심 기능 오작동, 사용자 체감 큰 버그
- 🟡 **Medium** — 특정 조건에서 오작동, UI 부정확
- 🔵 **Low** — 데드 코드, 메모리 누수, 코드 품질

---

## 🔴 Critical

### C1. ChartArea의 `locked` 로직이 헷지모드와 어긋남 → 한쪽 사이드만 점유돼도 모든 박스 드로잉 차단
- **파일**: `frontend/src/components/ChartArea.jsx:73`
- **현상**:
  ```js
  const hasPending = !!position?.pending;
  const locked     = hasPending; // 헷지모드: 포지션만으로는 잠금 안 함
  ```
  `hasPending`은 `pending` 객체 존재 여부만 본다. 백엔드는 LONG/SHORT 중 어느 한쪽이라도 pending이 있으면 `pending: { long, short }` 객체를 반환. 따라서 한쪽 사이드에만 pending이 있어도 `locked = true` → `useChartInteraction` 의 `buildHitChain` 이 `drawMode && !locked` 분기에서 박스 그리기를 막아 **반대 사이드 신규 진입 불가**.
- **대비**: App.jsx의 `derivePositionFlags`는 `drawLocked = (hasLong || longPendingExists) && (hasShort || shortPendingExists)` 로 양쪽 모두 막혔을 때만 잠금하도록 이미 정리됨. ChartArea만 옛 로직.
- **수정**: `derivePositionFlags(position)` 결과의 `drawLocked` 를 `locked` 로 사용. (또는 App.jsx에서 `drawLocked` 를 prop으로 내려보내기.)

### C2. `BoxOverlay` 의 드래그 핸들 표시 조건도 같은 버그
- **파일**: `frontend/src/components/Chart/BoxOverlay.jsx:38`
- **현상**: `!hasPos && <>...핸들...</>` — 반대편에 포지션이 있으면(`hasPos === true`) drawing 박스 핸들이 사라져 진입/TP/SL을 드래그 조정할 수 없음.
- **수정**: `drawing.isLong ? !hasLong : !hasShort` 또는 `derivePositionFlags` 결과 `sameSidePos` 기반으로 분기.

### C3. `recoveryService` 안전망의 store 매칭이 가장 오래된 1건만 사용
- **파일**: `backend/services/recoveryService.js:125-127`
- **현상**: 포지션이 LONG/SHORT 양쪽에 있는데 양쪽 모두 TP/SL이 없는 상황에서, store 내 항목 중 `o.tp && o.sl && o.side === entrySide` 매칭을 `.find()` 로 1건만 가져옴. 같은 사이드에서 가장 오래된 항목이 매칭되며, **현재 포지션과 무관한 옛날 진입 정보(가격이 전혀 다른)** 가 TP/SL로 등록될 수 있음. → 잘못된 가격에 TP/SL 걸려 손절이 큰 손실 → 청산 위험.
- **수정**: `posData.find(p => p.positionSide === openPosSide).entryPrice` 와 store의 fillPrice 가 가까운(±2%) 항목만 선택, 없으면 위험 경고만 남기고 자동 등록 스킵.

### C4. `placeTPSL` 의 `sl` 가 실패해도 `tp` 는 그대로 등록됨 — SL 없는 포지션이 일정 시간 유지될 수 있음
- **파일**: `backend/services/binanceClient.js:75-114`
- **현상**: TP/SL 각각 독립 재시도(최대 5회, 1+2+4+8+16=31초). TP는 성공/SL은 실패한 경우 31초 동안 SL 없는 채로 포지션이 노출됨. `pushAlert("critical", ...)` 가 발화되긴 하지만, 사용자가 즉시 대응 못 하면 위험. reconcile(60초) 가 다시 시도하지만 그 사이 청산 가능.
- **개선**: SL 우선 등록(또는 SL 실패 즉시 포지션 시장가 청산 옵션) — 최소한 SL이 들어가야 TP를 등록하도록 순서 변경.

### C5. `daily-loss` 한도 체크가 진입 직전에만 호출 — 미체결 LIMIT가 체결되는 순간에는 재확인 없음
- **파일**: `backend/routes/order.js:16`, `services/orderWatcher.js::onFilled`
- **현상**: LIMIT 주문 등록 시점엔 한도 OK였지만, 체결 대기 중 다른 거래로 손실이 누적되어 한도 초과 상태에서 체결되면 그대로 진입.
- **수정**: `onFilled` 진입 시 `checkDailyLoss()` 한 번 더 확인, 초과 시 즉시 청산 또는 경고 push.

### C6. `placeTPSL` 의 5회 재시도 동안 reconcile(60초) 가 동시에 호출되면 중복 TP/SL 등록 가능
- **파일**: `backend/services/binanceClient.js:75-114`, `orderWatcher.js:163-198`
- **현상**: `onFilled` 가 placeTPSL 호출 중(예: 16초 backoff 대기) reconcile 타이머가 60초 주기로 돌면, store의 상태가 아직 `FILLED` 상태로 남아 있는 동안 reconcile이 `retryable.filter` 로 잡아서 `placeTPSL` 을 또 호출 → 같은 TP/SL 이중 등록.
- **완화 장치 있음**: `checkExistingTPSL` 로 사전 확인하지만, 첫 호출이 늦으면(전체 31초) 재시도 윈도우와 충돌 가능.
- **수정**: store에 "placing 중" 락 플래그(`tpslPlacing: true`) 추가, reconcile은 이 플래그 set이면 스킵.

---

## 🟠 High

### H1. `frontend/src/api/client.js` 의 에러 파싱이 비-JSON 응답에서 throw → 원래 HTTP 에러가 가려짐
- **파일**: `frontend/src/api/client.js:9`
- **현상**:
  ```js
  if (!res.ok) throw new Error((await res.json()).error);
  ```
  서버가 500/502 등으로 HTML 또는 빈 응답을 보내면 `res.json()` 가 SyntaxError 발생 → `e.message = "Unexpected token < in JSON..."` 가 화면에 표시됨. 사용자는 진짜 원인을 알 수 없음.
- **수정**:
  ```js
  if (!res.ok) {
    const text = await res.text();
    let msg;
    try { msg = JSON.parse(text).error; } catch { msg = text || `HTTP ${res.status}`; }
    throw new Error(msg);
  }
  ```

### H2. `useAlertMonitor` 가 `1w` 까지 6개 WebSocket을 띄우지만, `useNotificationSettings`/`NotificationMenu` 는 5TF 만 지원 → 1w는 영구히 알람 불가능
- **파일**:
  - `frontend/src/hooks/useAlertMonitor.js:4` `ALL_TF = [..., "1w"]`
  - `frontend/src/hooks/useNotificationSettings.js:3-9` DEFAULT에 "1w" 없음
  - `frontend/src/components/NotificationMenu.jsx:4` `TFS` 에 "1w" 없음
- **현상**: 1w TF의 WebSocket·REST 호출·다이버전스 계산을 모두 실행하지만, `settingsRef.current["1w"]` 가 undefined → 모든 알람 분기가 false. 리소스 낭비 + 사용자 혼란.
- **수정**: 둘 중 하나로 통일 — 1w 알람을 지원하려면 DEFAULT/TFS에 추가, 아니면 ALL_TF 에서 제거.

### H3. `close.js` 부분 청산 시 분할 TP 사전 취소 → 청산 성공 → 재등록 사이에 다른 요청이 들어오면 race
- **파일**: `backend/routes/close.js:23-138`
- **현상**: 분할 TP를 먼저 취소하고 시장가 청산 → 잔여 비율로 재등록. 이 사이에 사용자가 추가 진입 / TP/SL 수정 / 다른 부분 청산을 트리거하면 잔여 포지션 계산이 꼬임. 특히 청산 도중 부분 체결만 되는 경우 `newSize = originalSize - closeQty` 가 실제와 다를 수 있음.
- **완화 장치 있음**: 롤백 로직 존재. 하지만 race 자체를 막진 못함.
- **수정**: close 진행 중 동일 사이드에 대한 추가 close/scale-in/split-tp 요청을 큐잉(또는 409 반환).

### H4. `useRealtimeData` 가 컴포넌트 외부 store와 분리된 `wsConnected` state를 가짐 — 어디서도 안 씀
- **파일**: `frontend/src/hooks/useRealtimeData.js:13`
- **현상**: `App.jsx::useRealtimeData()` 호출은 반환값 안 받음. `wsConnected` state는 의미가 없고 매 연결 변화마다 App을 리렌더만 발생시킴.
- **수정**: state 제거 또는 store로 옮겨 BalanceCard `online` 표시 등과 통합.

### H5. `useChartInteraction.onMouseDown` 의 `tp.onUp` 가 `updatePendingTpsl` 호출 — 그러나 PendingOrderStore 의 TP 변경은 store에만 반영되고 새 LIMIT 주문은 그대로
- **파일**: `frontend/src/chart/dragStateMachine.js:115-118` + `backend/routes/order.js::PATCH /api/order`
- **현상**: pending LIMIT 의 TP만 드래그하면 backend store의 `tp` 가 update될 뿐, 실제 LIMIT 주문은 가격 변경 안 됨. 체결 후에야 새 TP 등록됨. 사용자에게 명확히 보이지 않음(UI는 새 TP 위치로 즉시 이동). 의도된 동작이긴 하지만, **TP만 드래그한 박스는 시장가가 닿으면 옛 SL 거리 기반 qty 그대로 체결됨** → 명세상 OK라도 사용자 혼란 가능.
- **개선**: TP 드래그 후에 UI에 "TP는 체결 후 적용됨" 안내, 또는 SL과 동일하게 `replacePendingOrder` 호출(qty도 재계산).

### H6. `useEMA` 의 cacheRef.current 가 무한 누적
- **파일**: `frontend/src/hooks/useEMA.js:27-44`
- **현상**: EMA 항목 삭제 시 cache map의 해당 id 항목은 그대로 남음. 사용자가 EMA를 수십 번 추가/삭제하면 누적 메모리. EMA 데이터는 캔들 길이 * 8바이트(double) 정도라 1500봉 * 2 = 24KB/항목. 큰 문제는 아니나 청소 필요.
- **수정**: useMemo 끝에 `for (const id of cacheRef.current.keys()) if (!seenIds.has(id)) cacheRef.current.delete(id);`

### H7. `useToast` sticky 알림의 setInterval 정리 누락 시 누수
- **파일**: `frontend/src/hooks/useToast.js:59`
- **현상**: `addLineAlert` 가 `intervalRefs.current[id]` 에 3초 반복 인터벌을 등록. `handleConfirm` 으로만 정리. 사용자가 페이지 새로고침 없이 컴포넌트 트리가 unmount되면 인터벌이 영구히 도는 + AudioContext 새로 생성 — 메모리/CPU 누수. (현재 앱 구조상 App.jsx 가 항상 떠있어 실무 영향은 낮지만 dev mode HMR 시 누적됨.)
- **수정**: useToast 내부 cleanup useEffect 에서 `Object.values(intervalRefs.current).forEach(clearInterval)` 추가.

### H8. `start.bat` 의 절대 경로 하드코딩 — 다른 사람이 사용 불가
- **파일**: `start.bat`
- **현상**: `cd /d C:\Users\a\Desktop\hadge\backend` 가 하드코딩. 사용자 a가 아닌 환경에선 동작 안 함.
- **수정**: `cd /d %~dp0backend` 등 배치 파일 위치 기준 상대 경로.

---

## 🟡 Medium

### M1. `pendingOrders.load()` 가 동기적이므로 OK이지만, `recoveryService` 가 호출 전 다른 라우트가 store를 사용하면 빈 상태로 응답
- **파일**: `backend/store/pendingOrders.js:10`, `recoveryService.js:7`
- **현상**: `server.js` 가 `app.listen` 콜백 안에서 `recoverPendingOrders()` 를 await 하지 않음(외부 await가 콜백 내부에 있어서 server.close 시점엔 OK이지만 라우트 등록은 listen 전에 끝남). 따라서 listen 직후 ~수초간 store는 빈 상태. 이 사이에 들어온 요청은 pending 정보 없이 응답.
- **현재 동작**: API 키 검증 후에만 recover → 키 없으면 영원히 load 안 함. → `routes/position.js` 가 store를 빈 상태로 보고 모든 미체결을 "external" 로 표시.
- **수정**: `store.load()` 를 `server.js` 모듈 로드 시점에 동기 실행하도록 분리 (recoveryService에서 분리).

### M2. `dailyloss.js::checkDailyLoss` 의 `todayPnl <= -limit` 비교에서 부동소수점 오차로 경계 통과
- **파일**: `backend/routes/dailyloss.js:48`
- **현상**: `todayPnl` 가 `-limit` 와 정확히 같을 때 통과(`<=` 는 같은 값도 차단). 부동소수점 오차로 `-3.9999999999` 가 `-4.0` 보다 작지 않으면 통과될 수 있음.
- **수정**: `todayPnl < -limit + EPSILON` 와 같이 명시적 마진.

### M3. `srService::runKDE` 가 Promise 안 reject 안 함, 항상 resolve(false|result) — 호출자가 throw 처리 어려움
- **파일**: `backend/services/srService.js:13-46`
- **현상**: `sr.js::/refresh` 는 `result === false` 만 보고 500 반환. 부분 실패 처리에 한계.

### M4. `srService` 의 KDE.py 실행 시 stdin 파이프 미사용 + `kill` 미호출
- **파일**: `backend/services/srService.js:23`, `srService.js::stop`
- **현상**: `stop()` 은 setInterval만 정리. 진행 중인 python 프로세스가 있으면 백엔드 종료 후에도 좀비로 남을 수 있음.
- **수정**: `proc` 핸들을 모듈 변수에 저장 후 `stop()` 에서 `kill()`.

### M5. `useCandles.js` 의 `r1`/`r2` 응답 검증 부재
- **파일**: `frontend/src/hooks/useCandles.js:60-65`
- **현상**: 바이낸스가 빈 배열을 반환하면 `recent[0].t.getTime()` 가 throw. `interval` 미지원이거나 일시적 장애 시 차트 영원히 빈 상태.
- **수정**: `if (!recent.length) return;` 추가, `candlesRef.current` 비우지 않기.

### M6. `useCandles.js` 의 WebSocket 새 candle push에서 `arr.push(candle)` 후 setCandles 호출 — pan/zoom 중에는 React 리렌더가 발생해 줌이 튀어보일 수 있음
- **파일**: `frontend/src/hooks/useCandles.js:39-46`
- **현상**: 봉 마감 시점 setCandles → useChartRenderer의 candles 변경 → forceUpdate → re-render. 미세 깜빡임.
- **수정**: 봉 마감도 RAF로 한 번 더 묶거나, `redrawChart` 만 호출하고 setCandles 는 N봉마다.

### M7. `useChartInteraction.onWheel` 의 `wheelSyncTimerRef` 가 isLog 변경 시 재드로우 누락 가능
- **파일**: `frontend/src/hooks/useChartInteraction.js:107-111`
- **현상**: 휠 후 150ms 타이머로 _panning 해제 + redrawChart. 그 사이 isLog 토글되면 yDomain 계산이 선형 그대로일 수 있음.
- **수정**: isLog 변경 시 wheelSyncTimer 즉시 cancel.

### M8. `useTrendLineAlert` 의 `pendingRef.current` 가 절대 정리 안 됨
- **파일**: `frontend/src/hooks/useTrendLineAlert.js:33`
- **현상**: 도형이 삭제돼도 `pendingRef.current` 의 키는 남음. 메모리 누수(매우 작음). 또한 같은 ID로 새 도형이 생기면(id 재사용은 없지만 이론상) 알람 못 받음.
- **수정**: useEffect cleanup에서 현재 lines/channels/circles ID 셋 기준으로 정리.

### M9. `usePositionCloseAlert` 가 페이지 새로고침으로 포지션 상태가 초기화 → 첫 폴링 후 prevRef와 비교할 때 false-true 가 발생할 수 있음
- **파일**: `frontend/src/hooks/usePositionCloseAlert.js`
- **현상**: useStore initial state는 `position: null`. 첫 `usePosition` fetch가 끝나면 `position.long` 가 있을 수 있음. `prevLongRef.current === null` 분기로 초기화는 함. 하지만 첫 fetch에서 hasLong=true → prevLong=true 로 기록되므로, 만약 그 사이에 한 차례 빈 응답(`null`)이 끼면 종료 알람 오발.
- **현재 코드는 안전**: 첫 마운트 시 prevRef가 null 이라 기록만 함. 이후 변화만 감지. OK.
- 단, position이 `null` 로 되면(API 실패) `!hasLong` 이 true → 진짜 종료가 아닌데 알람 발화. 보강: position fetch error 시 setPosition(null) 대신 이전 값 유지.

### M10. `useChartRenderer` 의 deps에서 candlesRef.current 사용 — ref 변경은 deps에 영향 없음, 안전 가드 부족
- **파일**: `frontend/src/hooks/useChartRenderer.js:67`
- **현상**: redrawCanvas의 deps에 candlesRef 없음 — ref라 OK이지만, `c` 가 빈 배열일 때 `getScales` 가 null 반환 → 그냥 return. 안전. 하지만 isLog change useEffect (line 89-102) 에서도 `c = candlesRef.current` 사용 → ref 사용은 같은 패턴이라 OK.

### M11. `validateOrder` 가 `entry`/`tp`/`sl` 의 상대 거리(최소 슬리피지)나 가격 상한 검증 없음
- **파일**: `backend/middleware/validate.js`
- **현상**: tp가 entry보다 단 $0.01 만 높아도 통과 → 미체결 + 즉시 TP 체결 시나리오 가능. quantity 상한도 없어 잘못된 클라이언트가 큰 수량을 보내면 그대로 시도.
- **수정**: 최소 가격 차이(예: 0.1% 또는 N틱), quantity 상한 추가.

### M12. `useChartInteraction.onMouseDown` 의 `chain` 배열에 `drawMode && !locked` 가 두 번 등장 (3.7번과 6번)
- **파일**: `frontend/src/chart/hitDetection.js:166-171` 과 `:286-292`
- **현상**: 첫 번째가 매칭되므로 두 번째는 영원히 dead code. 의도 자체가 모호.
- **수정**: 둘 중 하나 제거.

### M13. `recoveryService` 가 안전망 단계에서 LONG/SHORT 양쪽 모두 TP/SL 없는 경우 같은 store entry를 두 번 사용
- **파일**: `backend/services/recoveryService.js:111-148`
- **현상**: `for (const openPos of openPositions)` 루프 안에서 매번 `[...store.entries()].find(...)` 호출. 같은 entry가 두 사이드에 둘 다 매칭될 수 있음. 첫 사이드에 placeTPSL 성공 시 store의 status가 TPSL_PLACED 로 바뀌어 두 번째 사이드 매칭에서 제외되지만, 실패 시 양쪽이 같은 가격 사용.
- **수정**: 사용한 recoverId를 매 루프마다 set으로 관리.

### M14. `pushService` 가 메시지 송신 실패에 클라이언트 제거 안 함
- **파일**: `backend/services/pushService.js:24-28`
- **현상**: `client.send(msg)` 가 throw 해도 무시. close 이벤트는 정상 종료에만 발화. 끊긴 연결이 set에 남아 매 broadcast 마다 시간 소비.
- **수정**: try/catch + clients.delete(client).

### M15. `dragStateMachine` 의 `entry.onUp` 가 `replacePendingOrder` 호출 — qty가 calcPosition 으로 재계산되어 사용자가 의도하지 않은 qty 변경
- **파일**: `frontend/src/chart/dragStateMachine.js:101-104`
- **현상**: 진입 박스 전체를 평행이동하면 entry/tp/sl 모두 동일 dy만큼 이동. SL 거리는 그대로지만 entry 가격이 바뀜에 따라 `calcPosition` 의 결과 qty가 미세하게 달라짐 (capital * riskPct / (entry - sl) — riskPerUnit 동일하므로 qty 동일해야 함). 잘 보면 OK이지만 entry 가격이 바뀌어 leverage 한도가 달라지므로 결과 다를 수 있음.
- **확인 필요**: 의도된 동작인지.

### M16. `useTrendLines` 의 `/api/trendlines` 마이그레이션 코드는 백엔드에 라우트 없음
- **파일**: `frontend/src/hooks/useTrendLines.js:17-22`
- **현상**: `api("GET", "/api/trendlines")` 항상 404 → `.catch(() => {})` 로 무시. dead code.
- **수정**: 마이그레이션이 더 이상 필요 없으면 제거.

---

## 🔵 Low

### L1. `frontend/src/hooks/useDrawing.js` 는 어디서도 import 되지 않음 (dead code)
- **파일**: `frontend/src/hooks/useDrawing.js`
- **수정**: 삭제 (drawing 상태는 store/uiSlice에서 관리).

### L2. `TopBar` 가 `drawMode/onDrawModeToggle/locked/hasPos/hasPending` 를 받지만 사용 안 함 (dead props)
- **파일**: `frontend/src/components/TopBar.jsx:10`
- **수정**: 박스 모드 토글은 SidebarPanel의 "플랜" 버튼으로 이전됨. props/타입 정리.

### L3. `cursorRules.js` 의 `selectedChannelId`/`selectedCircleId` 검사가 `!id` 사용 — id가 0이면 false 반환 (Date.now() 사용이라 실무 영향 없음)
- **파일**: `frontend/src/chart/cursorRules.js:76, 87, 97, 108, 124, 135`
- **수정**: `id === null` 명시.

### L4. CLAUDE.md 가 알람 모니터를 "5개 타임프레임(5m/15m/1h/4h/1d)" 로 기술하지만 실제 코드는 6개(1w 포함)
- **파일**: `CLAUDE.md` 알림 시스템 섹션
- **수정**: H2 해결 후 문서 동기화.

### L5. `useNotificationSettings` DEFAULT 에 `tri` 필드가 있지만 NotificationMenu 의 ROWS 에는 없음 → 항상 false로 남음
- **파일**: `frontend/src/hooks/useNotificationSettings.js:4-8`
- **수정**: `tri` 가 더 이상 안 쓰이면 제거.

### L6. `useToast` 의 `addToast` setTimeout 이 toast 가 slice(-2) 로 이미 제거된 후에도 fire (no-op이지만 클로저 30초 점유)
- **파일**: `frontend/src/hooks/useToast.js:39-41`
- **수정**: timeout ID를 ref에 저장하고, 새 토스트 추가 시 evict된 토스트의 timeout cancel.

### L7. `serverSlice.tpsl` 초기값이 매번 같은 객체 참조 — 직접 변경 시 store 외부에서 mutate될 위험 (실무에선 OK이지만)
- **파일**: `frontend/src/store/serverSlice.js:6`
- **수정**: setTpsl이 항상 새 객체로 갈아끼우므로 큰 문제 없음.

### L8. `playNotifSound` 가 매 호출마다 AudioContext 생성 → Chrome autoplay policy 위반 가능 + 메모리 누수
- **파일**: `frontend/src/hooks/useToast.js:5`
- **수정**: 모듈 레벨에서 단일 AudioContext 생성, 사용자 첫 인터랙션 시 resume.

### L9. `useAlertMonitor` 의 startTFMonitor 의 `onDivUpdate` 콜백 파라미터명이 외부 `tf` 와 shadow
- **파일**: `frontend/src/hooks/useAlertMonitor.js:282`
- **현상**: `(tf, divs) => setDivsByTF(prev => ({ ...prev, [tf]: divs }))` — 안쪽 tf가 함수 파라미터로 shadow. 동작 OK, 가독성만 저하.

### L10. `useEMA` 가 `enabled: false` 인 EMA도 계산함
- **파일**: `frontend/src/hooks/useEMA.js:33`
- **수정**: `if (!enabled) continue;` 추가하여 계산 스킵.

### L11. `pendingOrders.set` 의 createdAt 보존 분기에 미세한 race
- **파일**: `backend/store/pendingOrders.js:34-45`
- **현상**: `existing?.createdAt ? info : { ...info, createdAt: Date.now() }` — 기존 entry에 createdAt 있으면 그대로, 새 entry면 새로 부여. info 객체에 createdAt 키가 이미 있어도 덮어쓰기. recoveryService에서 `createdAt: saved?.createdAt ?? Date.now()` 로 명시 전달하는데 set이 다시 덮어 씀. → recoveryService 의도와 충돌 가능 (현재는 existing가 있으면 보존되므로 OK).

### L12. `frontend/src/chart/dragStateMachine.js` 에 `channel_offset` 핸들러가 없는데 CLAUDE.md 와 cursorRules 에는 언급
- **파일**: `dragStateMachine.js:287` 는 `channel_mid_offset` / `channel_mirror_ep` 만 정의
- **현상**: CLAUDE.md "채널 타입: `channel_ep` (끝점), `channel_move` (몸통), `channel_offset` (미러선 폭 조절)" — `channel_offset` 은 실제로 `channel_mid_offset` 임. 문서/구현 불일치.
- **수정**: CLAUDE.md 타입명 갱신.

### L13. `validate.js` 의 `quantity` 검증이 음수/0 만 차단, 너무 큰 값(예: 1000 BTC)도 그대로 통과
- **파일**: `backend/middleware/validate.js:15`
- **수정**: `q > 1000` 등 상한 추가 (또는 계좌 잔고 기반 절대 상한).

### L14. `binanceClient.roundPrice` 가 0.1 단위로만 반올림 — BTCUSDT 의 tickSize는 0.1이지만 다른 심볼 확장 시 하드코딩 위험
- **파일**: `backend/services/binanceClient.js:71-73`
- **수정**: 심볼별 tickSize 캐시 (exchangeInfo 1회 조회 후 보관).

### L15. `useChartRenderer` 의 yDomain 초기 계산이 `d3.min`/`d3.max` 호출 — `useChartInteraction` 의 직접 for 루프와 일관성 없음
- **파일**: `frontend/src/hooks/useChartRenderer.js:67, 97`
- **수정**: 일관성 위해 같은 패턴으로 통일(또는 padYDomain 호출 정리).

### L16. `frontend/src/components/StatusAlert.jsx` 안 봤지만 일반적으로 빈 케이스 / 사용자 인터랙션 누락 가능 — 별도 점검 필요
- **참고**: 시간 관계상 본 조사에서 본문 확인 못함.

---

## 권장 수정 우선순위

1. **C1, C2** — 헷지모드 잠금/핸들 표시 로직 통일 (사용자 체감 가장 큼)
2. **C3** — recoveryService 안전망의 잘못된 TP/SL 자동 등록 차단 (실제 자금 위험)
3. **C5, C6** — 일일 손실 한도 가드 강화, placeTPSL 중복 방지 락
4. **C4** — SL 우선 등록 또는 SL 실패 시 즉시 청산 옵션
5. **H1** — api/client 에러 파싱 견고화
6. **H2** — 1w 알람 통일 (제거 or 추가)
7. **H8** — start.bat 상대 경로화
8. **M1, M5, M14** — 안정성 보강
9. **L1, L2, L4, L12** — 데드 코드/문서 정리

---

## 2차 조사 — 1차에서 미조사했던 영역

### 🟡 AddM1. `rsiRenderer.js` DPR 미적용 → HiDPI 디스플레이에서 RSI 라인 흐릿
- **파일**: `frontend/src/chart/rsiRenderer.js:18-21`
- **현상**: `canvas.width = M.left + IW + M.right` / `canvas.height = rsiH` — raw 픽셀. `candleRenderer`/`volumeRenderer`는 `initCanvas`로 DPR 적용하는데 여기만 누락.
- **수정**: `initCanvas(canvas, logW, rsiH)` 호출로 통일.
- **상태**: ✅ 수정됨.

### 🔵 AddL1. dead 컴포넌트 3개 삭제
- **파일**: `frontend/src/components/Chart/RSIPanel.jsx`, `VolumePanel.jsx`, `Confluence.jsx`
- **현상**: 어디서도 import 안 됨. RSIPanel/VolumePanel은 캔버스 렌더러로 대체됨. Confluence는 `xScale(new Date(z.t))` (잘못된 호출)인데 dead라 무해.
- **수정**: 파일 삭제.
- **상태**: ✅ 수정됨.

### 🔵 AddL2. `hitTest.js::findHitLine` log 모드에서 `p1`/`p2` <= 0 시 NaN
- **파일**: `frontend/src/utils/hitTest.js:30-31`
- **현상**: `Math.pow(ln.p2 / ln.p1, a0)` — p1이 0 또는 음수면 분수 거듭제곱이 NaN/Inf. 가격이 음수는 아니지만 yScale.invert가 극단 영역에서 0 이하를 반환할 가능성.
- **수정**: `if (!(ln.p1 > 0) || !(ln.p2 > 0))` 가드 → 선형 폴백.
- **상태**: ✅ 수정됨.

### 🔵 AddL3. `coordUtils::idxToTimestamp` 가 과거 영역(rawIdx<0) 외삽 안 함 → 0 캔들로 클램프
- **파일**: `frontend/src/utils/coordUtils.js:11-12`
- **현상**: 미래 외삽은 있지만 과거는 없음. 트렌드라인 끝점을 차트 좌측 너머로 드래그하면 시작점이 0번 캔들에 강제 클램프되어 점프하는 시각적 어색함.
- **수정 보류**: 의도된 동작일 가능성 (과거로 무한 외삽 시 t가 음수가 되어 다른 곳에서 깨질 위험).

### 🔵 AddL4. `useRsiResize`/`useVolResize` `onDividerMouseDown` deps에 `rsiH`/`volH`
- **파일**: `frontend/src/hooks/useRsiResize.js:45`, `useVolResize.js:44`
- **현상**: rsiH/volH 변경마다 함수 재생성. handlers는 ref로 관리되어 실제 영향 없음.
- **수정 보류**: 영향 무시할 정도.

### 🔵 AddL5. `useCrosshair::bodyPctEl` x 위치를 `priceText.textContent.length * 8` 로 계산
- **파일**: `frontend/src/hooks/useCrosshair.js:57`
- **현상**: 모노스페이스 13px 가정. 폰트 폭이 다르면 어긋남. (`getComputedTextLength`는 강제 레이아웃 유발하므로 의도된 trade-off라 주석에 명시)
- **수정 보류**: 인정된 trade-off.

### 🔵 AddL6. `volumeRenderer` 압축+useCandle 모드 fillStyle batch 없음
- **파일**: `frontend/src/chart/volumeRenderer.js:52-58`
- **현상**: 픽셀마다 `fillStyle` 변경 + `fillRect`. 색상별로 batch 가능.
- **수정 보류**: 압축 모드 픽셀 수는 viewport width 한도(<2000) → 미미한 성능 영향.

### 🔵 AddL7. `LineOpacityPopup` 이 도형 삭제 시 자동으로 닫히지 않음
- **파일**: `frontend/src/components/Chart/LineOpacityPopup.jsx:9-14`
- **현상**: `item = ...find(...)` 결과가 undefined여도 popup은 떠 있음 — opacity 100%로 표시되지만 조작 무효.
- **수정**: `useEffect(() => { if (!item) onClose(); }, [item, onClose])` 추가.
- **상태**: ✅ 수정됨.

### 🔵 AddL8. `Confluence.jsx::xScale(new Date(z.t))` — Date 객체를 bar-index 스케일에 전달
- **파일**: ~~`Confluence.jsx:21`~~ (삭제됨)
- **상태**: dead code 삭제로 자연 해결.

### 🔵 AddL9. CLAUDE.md의 `index.css` 설명에 `@keyframes toastIn` 미언급
- **파일**: `CLAUDE.md`
- **수정**: "전역 리셋 + @keyframes toastIn" 으로 보강.
- **상태**: ✅ 수정됨.

---

## 권장 수정 우선순위

1. **C1, C2** — 헷지모드 잠금/핸들 표시 로직 통일 (사용자 체감 가장 큼)
2. **C3** — recoveryService 안전망의 잘못된 TP/SL 자동 등록 차단 (실제 자금 위험)
3. **C5, C6** — 일일 손실 한도 가드 강화, placeTPSL 중복 방지 락
4. **C4** — SL 우선 등록 또는 SL 실패 시 즉시 청산 옵션
5. **H1** — api/client 에러 파싱 견고화
6. **H2** — 1w 알람 통일 (제거 or 추가)
7. **H8** — start.bat 상대 경로화
8. **M1, M5, M14, AddM1** — 안정성/렌더 보강
9. **L1, L2, L4, L12, AddL1, AddL7** — 데드 코드/문서 정리

---

## 미수정 보류 항목 (영향 작음/의도된 동작)

- AddL3, AddL4, AddL5, AddL6: 모두 영향이 무시할 정도이거나 의도된 trade-off
- L7, L9, L14, L15, M15: 이전 1차 조사에서 동일한 사유로 보류
