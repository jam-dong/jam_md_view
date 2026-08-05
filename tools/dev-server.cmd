@echo off
REM Static dev server for Tauri (no build step needed).
REM Serves the src/ directory on http://127.0.0.1:1420 so `tauri dev` can load it.
setlocal
set PYTHON_EXE="C:\Program Files\Python313\python.exe"
if not exist %PYTHON_EXE% (
  set PYTHON_EXE=python
)
%PYTHON_EXE% -m http.server 1420 --bind 127.0.0.1 --directory "%~dp0..\src"
endlocal
