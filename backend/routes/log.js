const express = require("express");
const { logClient } = require("../store/logStore");
const router   = express.Router();

/**
 * POST /api/log — 화면에서 일어난 일을 로그에 남긴다 (2026-08-25).
 * body: { session, events: [{ ts, event, level?, ...fields }] }
 *
 * 백엔드 로그만으로는 **"왜 이 주문이 나갔나"의 절반을 못 본다** — 거래소에 닿기
 * 전에 막힌 것(일일 한도·리플레이 가드)과 프론트 예외는 여기 흔적이 없다.
 *
 * ⚠ **브라우저가 보내는 값이라 그대로 믿지 않는다.** 개수·크기를 자르고,
 *   `kind`는 서버가 `"client"`로 고정한다 (보낸 쪽이 `event`로 위장할 수 없게).
 *   ⚠ 이 라우트에 **인증이 없다** — 로컬 전용이고 CORS가 origin을 제한하지만,
 *     외부에 노출할 일이 생기면 그때는 반드시 막을 것. 여기로 들어온 값은
 *     로그를 부풀릴 수는 있어도 주문에는 닿지 않는다
 *
 * ⚠ **`ts`는 브라우저 시계다.** 백엔드 시각(`ts`)과 다를 수 있어 `clientTs`로 따로 둔다 —
 *   순서를 볼 때 둘을 섞지 말 것
 */

const MAX_EVENTS = 50;
const MAX_FIELD  = 500;   // 문자열 필드 길이 상한

function clip(v) {
  if (typeof v === "string") return v.length > MAX_FIELD ? v.slice(0, MAX_FIELD) + "…" : v;
  if (v && typeof v === "object") {
    try {
      const s = JSON.stringify(v);
      return s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) + "…" : v;
    } catch { return null; }
  }
  return v;
}

router.post("/", (req, res) => {
  try {
    const { session, events } = req.body || {};
    if (!Array.isArray(events)) return res.status(400).json({ error: "events 배열이 필요합니다" });

    for (const e of events.slice(0, MAX_EVENTS)) {
      if (!e || typeof e.event !== "string") continue;
      const { ts, event, level, ...rest } = e;
      const fields = {};
      for (const [k, v] of Object.entries(rest)) fields[k] = clip(v);
      // ⚠ `kind:"client"`는 **함수가 정한다**(logClient) — 보낸 쪽 값을 쓰지 않는다.
      //   fields로 넣던 예전 방식은 logStore의 RESERVED 보호에 막힌다
      logClient(event, {
        ...fields,
        level: level === "error" || level === "warn" ? level : "info",
        session: typeof session === "string" ? session.slice(0, 32) : null,
        clientTs: typeof ts === "number" ? ts : null,
      });
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "로그 기록 실패" });
  }
});

module.exports = router;
