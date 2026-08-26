import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import { installClientLog } from './api/clientLog'
import { installBackup } from './api/backup'

// 화면에서 터진 예외를 백엔드 로그로 보낸다.
// ⚠ **App보다 먼저** 걸어야 첫 렌더에서 터진 것도 잡힌다 (그때가 가장 중요하다)
installClientLog()
// 브라우저 저장소를 백엔드에 하루 한 벌씩 남긴다 — 되돌리기는 콘솔의 __restoreBackup()
installBackup()

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
)
