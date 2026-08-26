// 연습 세션 저장 — 새로고침해도 계좌·포지션·성적이 남는다
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// `replayOn`은 일부러 저장하지 않는다(새로고침하면 항상 실거래로 시작). 그런데
// 그 탓에 새로고침 한 번이면 몇 시간 쌓은 연습 기록이 통째로 사라졌다.
// 모드는 안 살리되 **계좌 상태는 살린다** — 리플레이를 다시 켜면 이어서 하게 된다.
//
// ── 진행 위치를 커서가 아니라 **시각**으로 저장한다 ──────────────────────
// 커서(구동 봉 인덱스)는 타임프레임이 바뀌면 뜻이 달라진다(1h→5m 구동, 4h→15m 구동).
// 시각으로 저장하면 세션 도중 TF를 바꿔도 계좌가 그대로 이어진다.
//
// ── ⚠ 연습 성적(장부)은 **초기화 버튼을 누르기 전까지 사라지지 않는다** ──
// (2026-08-19 사용자 확정. 그전에는 구간이 바뀌면 통째로 버렸다)
// 그래서 복원이 **두 단계**다:
//   ① 같은 구간(`sameRange`)  → 전부 복원 (계좌 + 포지션·주문 + 진행 위치)
//   ② 다른 구간              → **장부만** 복원 (잔고·체결 로그·주문번호)
// ②에서 포지션·미체결·TP/SL을 버리는 이유는 그대로다 — 2023년 포지션을 들고
// 2025년 구간으로 넘어가면 진입가가 화면 밖인 유령 포지션이 된다. 하지만 그건
// **포지션의 문제지 성적의 문제가 아니다.** 승률·순손익은 언제 벌었든 내 기록이다.
// ⚠ 펀딩비 커서(`fundIdx`)도 ②에서는 0으로 되돌린다 — 구간이 바뀌면 펀딩비
//   이력 배열 자체가 새로 받은 다른 배열이라 옛 인덱스는 뜻이 없다.

import { lsGet, lsRemove, lsSet } from "../utils/storage.js";

const KEY = "replay_session";
const VERSION = 3;   // v2 → v3: 구간이 달라도 장부를 이어받는다

// ⚠ **저장 형식이 그대로인 버전은 계속 읽는다.** v2 → v3에서 바뀐 건 "구간이 다를 때
//   어디까지 복원하나"라는 **읽는 쪽 규칙**뿐이고, 저장되는 필드는 글자 하나 안 바뀌었다.
//   그런데 `s.v !== VERSION`으로 막아 두면 업데이트 직후 **첫 실행 한 번에 연습 기록이
//   통째로 버려진다** — "초기화 버튼을 누르기 전까지 성적은 사라지지 않는다"는 규칙을
//   그 규칙을 만든 커밋이 스스로 어기는 셈이다.
//   앞으로도 **필드를 바꿀 때만** VERSION을 올리고, 그때는 여기서 변환해 줄 것
const READABLE = new Set([2, 3]);

export const sessionKey = (symbol, startMs, endMs) => `${symbol}|${startMs}|${endMs}`;

/** 브로커 상태를 평범한 객체로 (클래스 인스턴스는 JSON으로 안 나간다) */
export function saveSession(key, broker) {
  if (!broker) return;
  try {
    lsSet(KEY, JSON.stringify({
      v: VERSION, key,
      startBalance: broker.startBalance,
      balance: broker.balance,
      pos: broker.pos,
      pending: broker.pending,
      tpsl: broker.tpsl,
      scaleIns: broker.scaleIns,
      trades: broker.trades,
      lastPrice: broker.lastPrice,
      lastTime: broker.lastTime,
      nextId: broker._id,
      fundIdx: broker._fundIdx,
    }));
  } catch (e) {
    // 용량 초과 등 — 저장 실패가 연습 자체를 막으면 안 된다
    console.warn("[replay] 세션 저장 실패:", e.message);
  }
}

/**
 * 저장분을 돌려준다. **구간이 달라도 돌려준다** — 어디까지 되살릴지는
 * `sameRange(saved, key)`로 부르는 쪽이 정한다 (위 두 단계 규칙).
 */
export function loadSession() {
  try {
    const s = JSON.parse(lsGet(KEY) || "null");
    if (!s || !READABLE.has(s.v)) return null;
    return s;
  } catch { return null; }
}

/** 저장분이 지금 재생하려는 구간의 것인가 */
export const sameRange = (s, key) => !!s && s.key === key;

export function clearSession() {
  lsRemove(KEY);
}

/**
 * 저장분을 브로커 인스턴스에 되붓는다.
 * @param full  true = 포지션·미체결까지 전부 / false = **장부만** (다른 구간)
 */
export function restoreInto(broker, s, full = true) {
  broker.balance = s.balance;
  broker.trades  = s.trades ?? [];
  broker._id     = s.nextId ?? 1;

  if (!full) {
    // 다른 구간 — 성적은 이어받되 포지션·주문은 두고 온다.
    // lastPrice/lastTime은 부르는 쪽이 새 엔진 값으로 채운다
    broker.pos      = { LONG: null, SHORT: null };
    broker.pending  = { LONG: null, SHORT: null };
    broker.tpsl     = { LONG: blank(), SHORT: blank() };
    broker.scaleIns = [];
    broker._fundIdx = 0;
    return broker;
  }

  broker.pos       = s.pos;
  broker.pending   = s.pending;
  broker.tpsl      = s.tpsl;
  broker.scaleIns  = s.scaleIns ?? [];
  broker.lastPrice = s.lastPrice;
  broker.lastTime  = s.lastTime;
  // 펀딩비 커서까지 복원해야 이미 낸 펀딩비를 다시 물리지 않는다
  broker._fundIdx  = s.fundIdx ?? 0;
  return broker;
}

function blank() { return { tp: null, sl: null, splitTps: [] }; }

/** 저장된 세션에 되살릴 내용이 있는가 (빈 계좌면 복원할 이유가 없다) */
export const hasProgress = (s) => !!s && (s.trades?.length > 0 || s.lastTime != null);
