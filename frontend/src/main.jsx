import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import { installClientLog } from './api/clientLog'

// 화면에서 터진 예외를 백엔드 로그로 보낸다.
// ⚠ **App보다 먼저** 걸어야 첫 렌더에서 터진 것도 잡힌다 (그때가 가장 중요하다)
installClientLog()

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
)
