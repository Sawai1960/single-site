@echo off
chcp 65001 >nul
cd /d "%~dp0"
title シングルサイト換算ツール（UMIN 障害時の代替）

echo UMIN（https://square.umin.ac.jp/single-site/）が使えないときの代わりに、
echo この PC でツールを立ち上げます。院内の端末（10.x）からも開けます。
echo.

if not exist "out\index.html" goto :build

for %%f in ("out\index.html") do echo 手元の書き出し（最後に UMIN へ送ったもの）: %%~tf
echo 5 秒以内に R を押すと、作り直してから立ち上げます（2〜3 分）。押さなければ、そのまま立ち上げます。
choice /c SR /t 5 /d S /n >nul
if errorlevel 2 goto :build
goto :serve

:build
echo 書き出しを作り直します。2〜3 分かかります。
call npm.cmd run build
if errorlevel 1 goto :failed

:serve
set IP=
for /f %%i in ('powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress"') do set IP=%%i

echo.
echo ============================================================
echo  この PC の住所:   http://localhost:43128/single-site/
echo  院内からの住所:   http://%IP%:43128/single-site/
echo  この窓を閉じると止まります。UMIN が復旧したら閉じてください。
echo ============================================================
echo.

start "" /b powershell -NoProfile -Command "Start-Sleep 2; Start-Process 'http://localhost:43128/single-site/'"
call npm.cmd run preview

:failed
echo.
echo 止まりました。すでに別の窓で起動している場合は、そちらを使ってください。
pause
