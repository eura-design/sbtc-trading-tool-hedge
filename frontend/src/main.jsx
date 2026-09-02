import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import { installClientLog } from './api/clientLog'
import { installBackup } from './api/backup'
import { migrateDrawingsToSymbol } from './replay/drawingKeys.js'

// 화면에서 터진 예외를 백엔드 로그로 보낸다.
// ⚠ **App보다 먼저** 걸어야 첫 렌더에서 터진 것도 잡힌다 (그때가 가장 중요하다)
installClientLog()
// 브라우저 저장소를 백엔드에 하루 한 벌씩 남긴다 — 되돌리기는 콘솔의 __restoreBackup()
installBackup()

// 스토어를 만들기 전에 도형 키를 심볼별로 옮긴다 (2026-09-02).
// 심볼이 키에 들어가기 전에 저장된 것은 전부 BTCUSDT 것이다 - 안 옮기면
// **그려둔 도형과 플랜 박스가 전부 사라진 것처럼 보인다.**
// 한 번만 돌고(플래그), 옛 키는 지우지 않는다 (되돌릴 여지 + 백업에 남게)
migrateDrawingsToSymbol()

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
)
