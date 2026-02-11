@echo off
title Agenda LC
echo.
echo  ========================================
echo    AGENDA LC - Iniciando...
echo  ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js no esta instalado.
    echo.
    echo  Descargalo gratis de: https://nodejs.org
    echo  Elegi la version LTS y segui los pasos.
    echo  Despues volve a ejecutar este archivo.
    echo.
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo  Instalando dependencias...
    npm install
    echo.
)

:: Seed data if needed
if not exist "data\agenda.json" (
    echo  Cargando datos iniciales...
    node seed.js
    echo.
)

echo  ========================================
echo    Agenda LC esta corriendo!
echo.
echo    Abri tu navegador en:
echo    http://localhost:3000
echo.
echo    Contrasena: agenda2026
echo.
echo    No cierres esta ventana.
echo  ========================================
echo.

:: Open browser automatically
start http://localhost:3000

:: Start server
node server.js
pause
