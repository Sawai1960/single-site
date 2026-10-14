@echo off
chcp 65001 >nul
cd /d "%~dp0"
title シングルサイト換算ツール（院内試用）

if not exist "out\index.html" (
  echo 書き出したファイルが無いので作成します。2〜3 分かかります。
  call npm.cmd run build
  if errorlevel 1 goto :failed
)

set IP=
for /f %%i in ('powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress"') do set IP=%%i

echo.
echo ============================================================
echo  院内の住所: http://%IP%:43128/single-site/
echo  この窓を閉じると止まります。
echo ============================================================
echo.

start "" /b powershell -NoProfile -Command "Start-Sleep 2; Start-Process 'http://localhost:43128/single-site/'"
call npm.cmd run preview

:failed
echo.
echo 止まりました。すでに別の窓で起動している場合は、そちらを使ってください。
pause
