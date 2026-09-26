# 멀티계정 (A′) 작업 목록

> **상태: 승인 대기 — 코드는 아직 한 글자도 바꾸지 않았다.**
> 작성 2026-09-26 · 갱신 2026-09-26(월별 결산 자동 기록이 생겨 7-1번을 고쳤다).
> 아래 **줄 번호는 그날 기준**이다 — 코드가 바뀌면 먼저 낡는다.
> 착수 전에 `grep`으로 다시 확인할 것.

사용자가 바이낸스 계정 하나 안에 **가상 서브계정**을 하나 만들었고, hadge로 두 계정을
같이 운용하려 한다. 지금 코드는 계정 하나를 전제로 한다.

---

## 왜 A′인가 (2026-09-26 사용자 결정)

세 가지를 놓고 A′를 골랐다.

| | 무엇 | 왜 안 골랐나 / 골랐나 |
|---|---|---|
| **A′** | **코드 한 벌 · 설정 두 벌 · 프로세스 둘** | **골랐다.** 상태 파일이 계정마다 갈려서 "둘이 서로 덮어쓴다"가 구조적으로 안 생긴다. 고칠 것은 설정을 빼내는 일뿐이다 |
| B | 백엔드 하나가 계정 둘을 다룬다 | 얻는 것이 "화면 하나에서 둘을 본다"뿐인데, `orderWatcher`를 계정마다 돌리고 store를 나누고 경보 키에 계정을 넣어야 한다. 2026-09-02에 심볼별로 나눈 것과 같은 규모다 |
| C | 서브계정은 바이낸스 앱·웹으로만 본다 | 지금 상태 |

A′는 Freqtrade·Hummingbot 같은 오픈소스 트레이딩 봇이 택한 모양과 같다 — 설치는 한 번,
설정 파일을 계정마다 두고, 인스턴스마다 **저장소를 따로** 둔다.

⚠ 처음에 "폴더를 복사해서 두 벌로 만든다"고 제안했다가 **접었다.** 코드가 두 벌이 되면
한쪽만 고치는 일이 반드시 생긴다. A′는 **같은 폴더의 같은 코드**가 설정만 달리 읽는다.

---

## 핵심 — `binanceClient.js`는 안 바꾼다

계정마다 **프로세스가 따로**라서 `process.env`가 이미 프로세스 단위로 분리된다.
그래서 `services/binanceClient.js`는 한 글자도 안 바꾼다 (`:90`의 `BINANCE_API_SECRET`,
`:116`의 `BINANCE_API_KEY`가 그 프로세스의 값이 된다). **A′가 싼 이유가 이것이다.**

바꿀 것은 셋뿐이다: ① 어느 `.env`를 읽을지 ② 어느 폴더에 상태를 쓸지 ③ 어느 포트로 뜰지.

---

## 0. 사용자가 먼저 할 일

바이낸스에서 **서브계정용 API 키를 발급**한다 (서브계정 관리 → API 관리, **선물 권한 포함**).
Claude가 할 수 없는 일이고, 이것 없이는 나머지가 무의미하다.

---

## 1. 새로 만드는 것

| 무엇 | 왜 |
|---|---|
| 환경변수 `HADGE_ACCOUNT` (`main` / `sub1`) | 계정 식별자. 로그·잠금 파일·화면 표시가 전부 이 값을 쓴다 |
| `backend/config/paths.js` (새 파일) | `DATA_DIR`을 **한 곳에서** 정한다. 아래 여섯 파일이 같은 규칙을 써야 하므로 정본을 하나 둔다 |
| `backend/.env.sub1` (새 파일) | 서브계정 키 + 포트 + 허용 origin |

`DATA_DIR`의 **기본값은 지금의 `backend/`**다. 그래서 **본계정은 파일이 하나도 움직이지
않는다** — 이사 작업이 없다. 서브계정만 `backend/data/sub1/` 아래에 새로 생긴다.

---

## 2. 백엔드 — 설정을 빼내는 곳

| 파일:줄 | 지금 | 바뀔 모습 |
|---|---|---|
| `server.js:3` | `require("dotenv").config({ quiet: true })` | `HADGE_ACCOUNT`에 맞는 `.env` 파일을 읽는다 (`.env` / `.env.sub1`) |
| `server.js:27` | `const PORT = 3002` | `process.env.PORT ?? 3002` |
| `server.js:30-32` | `ALLOWED_ORIGINS` (이미 `.env`에서 읽는다) | **코드 변경 없음** — `.env.sub1`에 `http://localhost:5175`만 적는다 |
| `server.js:131` | `const HOST = "127.0.0.1"` | **그대로 둔다** (계정과 무관하다) |

---

## 3. 백엔드 — 계정마다 갈라야 하는 상태 파일 여섯

| 파일:줄 | 지금 박혀 있는 경로 |
|---|---|
| `store/pendingOrders.js:5` | `backend/pending_orders.json` |
| `store/logStore.js:50` | `backend/logs/` |
| `store/backupStore.js:22` | `backend/backups/` |
| `services/dailySummary.js:6` | `backend/daily_summary.jsonl` |
| `services/incomeLogger.js:39` | `backend/income_cursor.json` |
| `services/incomeLogger.js:40` | `backend/logs/.income_cursor.json` (옛 위치에서 옮겨오는 경로) |
| `store/trackerStore.js:8` | `기타/tracker_data.json` — **7-1번 때문에 여기도 갈라야 한다.** 다만 이 파일은 `DATA_DIR` 밖(`기타/`)에 있는 것이 2026-08-22 사용자 결정이라, 폴더를 옮기지 않고 **파일 이름에 계정을 넣는 쪽**이 그 결정을 지킨다 (`tracker_data.sub1.json` 꼴) |

일곱 곳이 `config/paths.js`의 규칙을 쓰게 바꾼다.

**조회 도구도 따라가야 한다**
- `tools/logq.js:24,27` — 자기 `DIR`·`SUMMARY_FILE`을 따로 들고 있다. 같이 고친다
- `tools/backup.js` — `backupStore.DIR`을 쓰므로(`:27`, `:38`) **자동으로 따라온다**

---

## 4. 같은 계정을 두 번 띄우는 것을 막는 가드

지금 `server.js:147-163`의 `probeExisting()`은 **포트로만** 판정한다. 포트가 다르면
통과하므로, 실수로 본계정을 3002와 3003에 두 번 띄우면 둘 다 뜬다. 그게 바로 이 가드가
막으려던 상황이다 — `server.js:138-140` 주석에 실측이 적혀 있다: 백엔드 둘이 살아 있으면
60초 정합이 두 벌 돌아 **한쪽이 취소한 주문을 다른 쪽이 다시 걸고**,
`pending_orders.json`을 둘이 덮어쓰고, 거래소 가중치가 두 배가 된다.

→ **잠금 파일**을 더한다: `${DATA_DIR}/run.lock`에 PID를 적고, 이미 살아 있는 PID가 있으면
`DUPLICATE_INSTANCE`를 남기고 종료한다. 계정마다 `DATA_DIR`이 다르므로 **계정 단위로
정확히 하나만** 뜬다. 포트 판정은 **지우지 않고 그대로 남긴다** (두 겹).

---

## 5. 프론트 · 실행

| 파일:줄 | 지금 | 바뀔 모습 |
|---|---|---|
| `frontend/src/constants.js:72` | `API_BASE = "http://localhost:3002"` | `import.meta.env?.VITE_API_BASE ?? "http://localhost:3002"` |
| `frontend/vite.config.js:7` | `port: 5174` | 환경변수에서 읽는다 |
| `start.bat` | 3002·5174·`node server.js` 고정 | `start.bat main` / `start.bat sub1` |

⚠ **`constants.js`에 `import.meta.env`를 그냥 쓰면 `npm test`가 깨진다.**
`frontend/tests/calc.test.js:9`가 이 파일을 node로 직접 import하는데, node에는
`import.meta.env`가 없어서 `undefined`를 읽다가 던진다. 그래서 위처럼 `?.`와 기본값을
반드시 붙인다. (이 저장소에 `import.meta`를 쓰는 곳은 2026-09-26 기준 **하나도 없다** —
첫 사례가 된다)

※ `API_BASE`는 프론트의 유일한 백엔드 주소다 — 푸시 WebSocket 주소도 여기서 파생한다
(`hooks/useRealtimeData.js:6`이 `API_BASE.replace(/^http/, "ws")`). 그래서 한 곳만 고치면 된다.

---

## 6. 미리 알아야 할 것 — 화면 설정이 계정마다 따로가 된다

프론트 포트가 5174 / 5175로 갈리면 브라우저가 **다른 출처(origin)로** 보기 때문에
`localStorage`가 완전히 분리된다. 서브계정 화면은 **처음에 이것들이 전부 비어 있다**:

도형·플랜 박스 · 리스크/레버리지 · 지표 설정 · 알림 · 단축키 · 테마 · 연습(리플레이) 세션 ·
즐겨찾기 심볼 · 패널 높이 · 카운트다운 위치

옮기는 방법은 있지만 **별건이라 이번 범위에 넣지 않았다.**

---

## 7. 결정해야 할 것 셋 (2026-09-26 현재 미결)

1. **`기타/tracker_data.json`(월별 결산)을 두 계정이 같이 쓸까, 따로 쓸까?**
   → **따로 두는 것 말고는 답이 없다.** (2026-09-26에 이 항목의 성격이 바뀌었다)

   그전에는 사람이 손으로 넣는 파일이라 "같이 쓰면 마지막에 쓴 쪽이 이긴다" 정도였다.
   지금은 `services/trackerAuto.js`가 **1시간마다 이 파일을 자동으로 덮어쓴다.**
   계정이 둘이면 두 백엔드가 각자 자기 계정의 income으로 **같은 파일을 서로 덮어쓴다** —
   4번에서 막으려던 것과 정확히 같은 문제이고, 이쪽은 사람이 눈치채기도 어렵다
   (숫자가 1시간마다 두 계정 사이에서 오간다).

   같이 봐야 할 것: `store/trackerStore.js:8` · `store/backupStore.js:32` ·
   `server.js:37`(`/tools` 정적 경로, 양쪽 백엔드가 같은 폴더를 내보낸다).
   합계를 보고 싶으면 나중에 읽는 쪽에서 합치면 된다.

   ⚠ `시드머니(seed)`는 계정마다 다른 값이다 — 파일을 나누면 자동으로 해결되지만,
     한 파일을 쓰면 이것부터 어긋난다.

2. **계정 이름을 무엇으로 할까?** (`main` / `sub1`? 아니면 실제 서브계정 이름?)
   로그·폴더 이름·잠금 파일이 이 값을 쓴다.

3. **화면에 어느 계정인지 표시할까?**
   멀티계정에서 가장 비싼 사고가 계정을 헷갈려 주문을 내는 것이다.
   `routes/health.js:7`에 계정 이름을 실어 보내고 `TopBar`에 표시하는 형태를 권한다.
   다만 이건 **새 화면 요소**라 따로 승인이 필요하다 — 이번 범위에 넣을지 물어볼 것.

---

## 8. 끝나고 검산할 것

- `npm test` — 프론트 219개(2026-09-26 기준) · 백엔드 전체. 특히 `calc.test.js`(5번 함정)
- **본계정만 띄워서 파일 경로가 하나도 안 움직였는지** 확인
  (`backend/logs/`·`backend/pending_orders.json`이 제자리인지)
- **같은 계정을 두 번** 띄워서 `DUPLICATE_INSTANCE`로 죽는지 (포트를 다르게 줘도 죽어야 한다)
- 두 계정을 동시에 띄워 10분쯤 돌린 뒤
  `node backend/tools/logq.js --event API_WEIGHT_HIGH`로 가중치를 본다.
  `binanceClient.js:129`의 `noteWeight()`가 `:131`에서 `x-mbx-used-weight-1m`을 읽어
  한도에 다가가면 경고를 남기므로, **"IP 한도가 합산되는가"를 추측 말고 실측으로** 본다
  (⚠ 이 점은 2026-09-26 현재 **확인하지 않았다** — 합산된다고 단정하지 말 것)

---

## 규모

고치는 파일 **12개** (백엔드 9 · 프론트 2 · `start.bat`),
새 파일 **2개** (`backend/config/paths.js`, `backend/.env.sub1`).
**계산 로직·주문 흐름은 건드리지 않는다.**

---

## 덤으로 알게 된 것

- 일일 손실 한도는 **계정마다 따로 계산된다** — 기준이 그 계정의 지갑 잔고이기 때문이다
  (`routes/dailyloss.js`). 따로 손댈 것이 없다
- `store/entryRecords.js`는 자기 파일이 없다 — `pendingOrders`(`:13`) 안에 산다.
  그래서 3번의 여섯 곳만 고치면 진입 기록도 같이 갈린다
