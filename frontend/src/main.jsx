import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import { installClientLog } from './api/clientLog'
import { installBackup } from './api/backup'
import { migrateDrawingsToSymbol, cleanupLegacyDrawings } from './replay/drawingKeys.js'
import { lsRemove, lsGetJSON, lsSetJSON } from './utils/storage.js'
// 살아 있는 지표 이름의 **정본** — 아래 `indicators` 정리가 이 목록만 남긴다
import { INDICATORS } from './components/IndicatorMenu.jsx'

// 화면에서 터진 예외를 백엔드 로그로 보낸다.
// ⚠ **App보다 먼저** 걸어야 첫 렌더에서 터진 것도 잡힌다 (그때가 가장 중요하다)
installClientLog()
// 브라우저 저장소를 백엔드에 하루 한 벌씩 남긴다 — 되돌리기는 콘솔의 __restoreBackup()
installBackup()

// 스토어를 만들기 전에 도형 키를 심볼별로 옮긴다 (2026-09-02).
// 심볼이 키에 들어가기 전에 저장된 것은 전부 BTCUSDT 것이다 - 안 옮기면
// **그려둔 도형과 플랜 박스가 전부 사라진 것처럼 보인다.**
// 한 번만 돈다 (플래그)
migrateDrawingsToSymbol()
// 이사가 끝난 뒤 남아 있던 옛 키를 지운다 (2026-09-04 사용자 요청).
// ⚠ **새 키가 실제로 있는 것만** 지운다 — 안 옮겨진 항목은 옛 키가 유일한 사본이다.
//   백엔드 백업(60일)에는 그대로 남아 있으므로 되돌릴 길도 열려 있다
cleanupLegacyDrawings()

// ── 없어진 기능이 남긴 키 정리 (2026-09-04) ────────────────────────────────
// 거래량 구간 기능이 사라지면서 값만 남았다 — 코드 어디에서도 이 이름을 읽지 않는다.
// ⚠ **여기에 넣기 전에 `frontend/src` 전체에서 그 이름을 검색해 참조가 0인지 확인할 것.**
//   쓰이는 키를 넣으면 사용자 설정이 새로고침마다 사라진다.
// ⚠ 지운 뒤에도 백엔드 백업(60일)에는 남아 있다
const DEAD_KEYS = ["volRanges", "volrange_compare_filter"]
for (const k of DEAD_KEYS) lsRemove(k)

// ── `indicators` 안의 없어진 지표 on/off 정리 (2026-09-26 사용자 요청) ─────────
// `indicators`는 **살아 있는 키**라 위처럼 통째로 지울 수 없다 — 안에 든 항목만 고른다.
// 살아 있는 이름의 정본은 `IndicatorMenu`의 `INDICATORS` 하나다.
//   ⚠ **목록을 여기 복제하지 말 것.** 복제하면 지표를 새로 추가할 때 그 on/off가
//     새로고침마다 사라진다 — 목록에 없는 이름으로 보이기 때문이다.
// 실제로 남아 있던 찌꺼기 6개와 없어진 때 (커밋으로 확인):
//   fib    2026-08-15 `aa456e3` 피보나치를 지표에서 **도형으로 분리**
//   sr     2026-08-13 `da09acd` S/R Levels(KDE) → Pivot Levels로 교체
//   div    2026-08-12 `3e8eb92` RSI 다이버전스 제거
//   rsidiv 2026-08-12 같은 건의 다른 한 벌
//   ms     2026-08-12 `8e053db` Market Structure → 수동 구조 도구로 교체
//   chocho 2026-08-12 `8820caa` ChoCho Signal 되돌려 제거
// ※ 정리는 **다음 새로고침부터 보인다** — 스토어가 이 파일 본문보다 먼저 값을 읽기
//   때문이다. 남아 있어도 해롭지 않다: 읽는 쪽이 `indicators[key] !== false`라 모르는
//   이름은 쳐다보지 않는다. 그래서 굳이 즉시 반영하려고 순서를 바꾸지 않았다
// ⚠ 백엔드 백업(60일)에는 지운 값이 그대로 남아 있다
const live = new Set(INDICATORS.map(i => i.key))
const saved = lsGetJSON("indicators", null)
if (saved && typeof saved === "object") {
  const kept = Object.fromEntries(Object.entries(saved).filter(([k]) => live.has(k)))
  if (Object.keys(kept).length !== Object.keys(saved).length) lsSetJSON("indicators", kept)
}

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
)
