@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Sports Meet - Project Structure Setup
echo ============================================
echo.

if not exist "templates" (
    mkdir "templates"
    echo [CREATE] templates\
) else (
    echo [EXIST ] templates\
)

if not exist "static" (
    mkdir "static"
    echo [CREATE] static\
) else (
    echo [EXIST ] static\
)

call :makefile "app.py"
call :makefile "database.py"
call :makefile "templates\index.html"
call :makefile "templates\admin.html"
call :makefile "static\style.css"
call :makefile "static\script.js"

echo.
echo --------------------------------------------
echo Done. Existing files are NOT overwritten.
echo Fill the empty files with the source code.
echo --------------------------------------------
echo.
pause
exit /b 0

:makefile
if exist "%~1" (
    echo [EXIST ] %~1
) else (
    type nul > "%~1"
    echo [CREATE] %~1
)
exit /b 0