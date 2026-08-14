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
// ⚠ 구간(시작·끝)이 다르면 복원하지 않는다. 다른 시기를 재생하는데 이전 구간의
//   포지션이 남아 있으면 진입가가 화면 밖에 있는 유령 포지션이 된다.

const KEY = "replay_session";
const VERSION = 2;

export const sessionKey = (symbol, startMs, endMs) => `${symbol}|${startMs}|${endMs}`;

/** 브로커 상태를 평범한 객체로 (클래스 인스턴스는 JSON으로 안 나간다) */
export function saveSession(key, broker) {
  if (!broker) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({
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

/** 같은 구간의 저장분만 돌려준다. 없으면 null */
export function loadSession(key) {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!s || s.v !== VERSION || s.key !== key) return null;
    return s;
  } catch { return null; }
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

/** 저장분을 브로커 인스턴스에 되붓는다 */
export function restoreInto(broker, s) {
  broker.balance   = s.balance;
  broker.pos       = s.pos;
  broker.pending   = s.pending;
  broker.tpsl      = s.tpsl;
  broker.scaleIns  = s.scaleIns ?? [];
  broker.trades    = s.trades ?? [];
  broker.lastPrice = s.lastPrice;
  broker.lastTime  = s.lastTime;
  broker._id       = s.nextId ?? 1;
  // 펀딩비 커서까지 복원해야 이미 낸 펀딩비를 다시 물리지 않는다
  broker._fundIdx  = s.fundIdx ?? 0;
  return broker;
}

/** 저장된 세션에 되살릴 내용이 있는가 (빈 계좌면 복원할 이유가 없다) */
export const hasProgress = (s) => !!s && (s.trades?.length > 0 || s.lastTime != null);
