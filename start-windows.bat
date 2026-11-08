@echo off
cd /d "%~dp0"
echo Vinyl Sim - local server
echo   Home    http://127.0.0.1:8765/
echo   Cutter  http://127.0.0.1:8765/cutter
echo   Player  http://127.0.0.1:8765/player
echo Close this window or press Ctrl+C to stop.
py -3 serve.py --port 8765
pause
