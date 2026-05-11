@echo off
cd /d C:\Users\a\Desktop\hadge\backend
start "hadge Backend" cmd /k "node server.js"
timeout /t 2 /nobreak >nul
cd /d C:\Users\a\Desktop\hadge\frontend
start "hadge Frontend" cmd /k "npm run dev"
timeout /t 4 /nobreak >nul
start http://localhost:5174
