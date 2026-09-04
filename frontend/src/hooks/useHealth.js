import { useState, useEffect } from "react";
import { API_BASE } from "../constants";

export function useHealth() {
  // ⚠ **두 가지를 따로 본다** (2026-09-04 사용자 요청).
  //   `online`   — 백엔드가 응답하는가
  //   `exchangeDown` — 백엔드는 응답하는데 **바이낸스에 못 닿고 있는가**
  //   둘을 합치면 안 된다: 실측(logs/2026-08-27.jsonl) 05:11~06:39에 거래소 조회가
  //   **175건 전부 DNS 실패**로 끝났는데, 백엔드 자체는 멀쩡해서 `/api/health`가
  //   `ok:true`를 돌려줬다 — 점이 계속 초록이었다.
  //   바이낸스에 못 닿는 동안은 `watchAccount`가 계좌를 볼 수 없고, 그러면
  //   **무방비 포지션이 생겨도 경보를 띄울 수 없다**
  const [health, setHealth] = useState({ online: true, exchangeDown: false });

  useEffect(() => {
    // ⚠ **반드시 시간 제한을 건다** (2026-08-23). 없으면 **얼어붙은 백엔드를 못 잡는다** —
    //   포트는 열려 있어 연결은 되는데 응답이 영영 안 와서, fetch가 끝나지 않고
    //   `online`이 true인 채로 남는다. 실제로 92분간 멈춰 있었는데 점이 계속 초록이었다
    //   (콘솔 창 클릭 → 윈도우 빠른 편집 모드가 stdout을 막아 프로세스가 통째로 얼었다).
    //   **꺼진 것**은 연결이 즉시 거부돼 catch로 잡히지만, **얼어붙은 것**은 이것 없이는 못 잡는다
    const TIMEOUT_MS = 3000;
    const check = async () => {
      const ac = new AbortController();
      const t  = setTimeout(() => ac.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${API_BASE}/api/health`, { signal: ac.signal });
        const j   = await res.json().catch(() => null);
        // ⚠ 실패 **연속 3회**(약 9초)부터 본다 — `watchAccount`는 3초마다 돌고,
        //   한 번 튀는 것은 흔하다. 그때마다 점 색을 바꾸면 읽는 사람이 무시하게 된다
        // ⚠ API 키가 없으면 `watchAccount`가 아예 돌지 않는다 — 그때는 판정하지 않는다
        //   (`failStreak`이 0인 채로 남아 어차피 false지만, 뜻을 코드에 적어 둔다)
        const a = j?.account;
        setHealth({
          online: res.ok,
          exchangeDown: !!(j?.hasKey && a && a.polls > 0 && (a.failStreak ?? 0) >= 3),
        });
      } catch {
        // 응답 없음(얼어붙음) / 연결 거부(꺼짐) 둘 다 여기로.
        // ⚠ 이때 `exchangeDown`은 **false로 되돌린다** — 백엔드에 못 닿는 마당에
        //   거래소 상태는 알 수 없다. 빨간 점이 이미 그 사실을 말하고 있다
        setHealth({ online: false, exchangeDown: false });
      } finally {
        clearTimeout(t);
      }
    };
    check();
    // ⚠ 주기도 60초 → 10초. 얼어붙은 걸 1분이나 모르고 있으면 점이 있으나 마나다
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, []);

  return health;
}
