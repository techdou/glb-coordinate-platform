@echo off
REM 向后兼容入口：委托给根目录 start.bat（再调 scripts/start.py）
REM 推荐直接使用根目录的 start.bat。
setlocal
cd /d "%~dp0\.."
call start.bat %*
endlocal
