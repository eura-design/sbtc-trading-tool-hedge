@echo off
chcp 65001 >nul

echo [1/2] 백엔드 서버 시작중...
cd /d C:\Users\a\Desktop\BTC\backend
start "BTC Backend" cmd /k "node server.js"

echo [2/2] 프론트엔드 시작중...
timeout /t 2 /nobreak >nul
cd /d C:\Users\a\Desktop\BTC\frontend
start "BTC Frontend" cmd /k "npm run dev"

echo 브라우저 오픈중...
timeout /t 4 /nobreak >nul
start http://localhost:5173