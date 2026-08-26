// 브라우저 저장소 백업 (2026-08-26 사용자 요청)
//
// ── 왜 있나 ────────────────────────────────────────────────────────────────
// 브라우저 저장소가 지워지면 **도형·플랜 박스·리스크/레버리지·지표·알림·단축키·
// 연습 기록이 전부 한꺼번에 사라진다.** 어디에도 사본이 없었다.
// (git은 백업이 아니다 — 데이터 파일은 전부 .gitignore에 있다)
//
// 백엔드가 하루 한 파일로 모아 둔다 → `backend/store/backupStore.js`
//
// ⚠ **`api()`를 쓰지 않는다** — clientLog와 같은 이유 셋:
//   ① 리플레이 가드에 걸린다 (연습 중에도 백업은 돌아야 한다)
//   ② `api()`는 상태 변경 요청을 전부 로그에 남긴다 — 10분마다 한 줄씩 쌓여
//      정작 사고를 찾을 때 소음이 된다
//   ③ 실패하면 던진다. 백업 실패로 화면이 멈추면 안 된다
//
// ⚠ **바뀐 게 없으면 안 보낸다.** 대부분의 주기는 아무것도 안 바뀐다.

import { API_BASE } from "../constants";
import { lsSet } from "../utils/storage";

const PERIOD_MS = 10 * 60 * 1000;   // 10분 — 잃어도 되는 최대 시간
const FIRST_MS  = 20 * 1000;        // 켜자마자 보내면 로딩과 겹친다

const FORCE_EVERY = 6;              // 6번에 한 번(=1시간)은 안 바뀌었어도 보낸다

let timer    = null;
let lastSent = null;   // 마지막으로 보낸 내용(문자열) — 같으면 안 보낸다
let ticks    = 0;

/** 브라우저 저장소 전체를 객체로 */
function snapshot() {
  const items = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === null) continue;
      const v = localStorage.getItem(k);
      if (v !== null) items[k] = v;
    }
  } catch { /* 저장이 막힌 환경 — 백업할 것도 없다 */ }
  return items;
}

function send({ keepalive = false, force = false } = {}) {
  const items = snapshot();
  if (Object.keys(items).length === 0) return;   // 빈 내용은 백엔드도 거절한다
  const body = JSON.stringify({ items });
  // ⚠ **가끔은 안 바뀌었어도 보낸다.** "바뀐 게 없으면 안 보낸다"만 두면,
  //   백엔드가 백업을 잃었을 때(폴더 삭제 등) 브라우저는 그걸 모르고 영영 안 보낸다 —
  //   탭을 며칠 열어두는 사용이라 그 상태가 오래 간다
  if (!force && body === lastSent) return;
  lastSent = body;
  fetch(`${API_BASE}/api/backup/browser`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive,
  }).catch(() => { lastSent = null; /* 실패했으면 다음에 다시 보낸다 */ });
}

/**
 * 되살리기 — **콘솔에서 부른다.** 화면에는 버튼을 만들지 않았다:
 * 저장소를 통째로 덮는 동작이라 실수로 눌릴 자리에 두면 안 되고,
 * 새 화면 문구를 만드는 건 사용자 확인이 필요한 일이라서다.
 *
 *   __restoreBackup()           — 무엇이 들어 있는지 보기만 한다
 *   __restoreBackup(true)       — 실제로 되돌린다
 *   __restoreBackup(true, "2026-08-20") — 그날 백업으로
 *
 * ⚠ **백업에 있는 키만 덮어쓴다.** 지금 있는데 백업에 없는 키는 **건드리지 않고
 *   목록만 알려준다** — 백업 이후에 생긴 것을 복구가 지우면 그건 복구가 아니다.
 */
async function restore(apply = false, day) {
  const url = `${API_BASE}/api/backup/latest${day ? `?day=${encodeURIComponent(day)}` : ""}`;
  let snap;
  try {
    const res = await fetch(url);
    if (!res.ok) { console.error("[backup] 백업이 없습니다"); return; }
    snap = await res.json();
  } catch (e) { console.error("[backup] 백엔드에 닿지 못했습니다:", e.message); return; }

  const items = snap.browser || {};
  const keys  = Object.keys(items);
  const now   = Object.keys(snapshot());
  const extra = now.filter(k => !(k in items));

  console.log(`%c[backup] ${snap.iso} 시점 백업`, "font-weight:700");
  console.log(`  브라우저 저장소 ${keys.length}개 키`);
  console.log(`  백엔드 파일: ${Object.keys(snap.files || {}).join(", ") || "없음"}`);
  if (extra.length) console.log(`  지금만 있는 키 ${extra.length}개 (건드리지 않습니다):`, extra);

  if (!apply) {
    console.log("%c  → 실제로 되돌리려면 __restoreBackup(true)", "color:#f0b90b");
    return;
  }
  let ok = 0;
  for (const [k, v] of Object.entries(items)) if (lsSet(k, v)) ok++;
  console.log(`%c[backup] ${ok}/${keys.length}개 복원 — 새로고침하세요`, "color:#0ecb81;font-weight:700");
}

export function installBackup() {
  if (timer) return;
  timer = setTimeout(function tick() {
    send({ force: ticks % FORCE_EVERY === 0 });
    ticks++;
    timer = setTimeout(tick, PERIOD_MS);
  }, FIRST_MS);

  // 탭을 닫거나 숨길 때 한 번 더 — 10분 주기 사이에 잃는 것을 줄인다
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") send({ keepalive: true });
  });

  if (typeof window !== "undefined") window.__restoreBackup = restore;
}
