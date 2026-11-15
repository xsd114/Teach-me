@echo off
chcp 65001 >nul
title ALP - AI Library Professor
cd /d "%~dp0"

echo.
echo   ALP - AI Library Professor
echo   ============================================
echo   正在启动后端与前端，请稍候...
echo.

start "ALP server" cmd /k "pnpm --filter @alp/server start"
timeout /t 3 /nobreak >nul
start "ALP web" cmd /k "pnpm --filter @alp/web dev"
timeout /t 6 /nobreak >nul
start "" "http://127.0.0.1:5273"

echo.
echo   已启动。界面：http://127.0.0.1:5273
echo   关掉那两个命令行窗口即停止服务。
timeout /t 3 /nobreak >nul