@echo off
REM Lance la plateforme en local (le site doit etre ouvert via un petit serveur, pas en double-cliquant index.html)
cd /d "%~dp0"
start "" http://localhost:8000/
python -m http.server 8000
if errorlevel 1 py -m http.server 8000
pause
