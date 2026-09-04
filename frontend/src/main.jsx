import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import { installClientLog } from './api/clientLog'
import { installBackup } from './api/backup'
import { migrateDrawingsToSymbol, cleanupLegacyDrawings } from './replay/drawingKeys.js'
import { lsRemove } from './utils/storage.js'

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

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
)
