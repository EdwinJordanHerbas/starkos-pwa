@echo off
REM ══════════════════════════════════════════════════════════════════
REM  OkiroSport — arranque local (doble clic)
REM ══════════════════════════════════════════════════════════════════
REM
REM  PREREQUISITOS:
REM  1. PostgreSQL instalado y corriendo en localhost:5432
REM     (el que instala Odoo vale; usuario: odoo, contraseña: odoo)
REM  2. Base de datos "okirosport" creada:
REM        createdb -U odoo okirosport
REM  3. Esquema aplicado (solo la primera vez):
REM        psql -U odoo -d okirosport -f migration.sql
REM  4. Node.js 18+ instalado (node --version para verificar)
REM
REM  VARIABLES DE ENTORNO (opcionales — descomenta y rellena):
REM  - ANTHROPIC_API_KEY  : para habilitar análisis IA
REM  - ANTHROPIC_MODEL    : modelo a usar (por defecto claude-haiku-4-5)
REM  - APP_TOKEN          : token de autenticación (sin él la API queda abierta)
REM  - STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET : para integración Strava
REM  - STRAVA_WEBHOOK_TOKEN : token de verificación del webhook Strava
REM  - APP_USER_NAME      : nombre mostrado en los análisis IA (por defecto: Stark)
REM
REM ══════════════════════════════════════════════════════════════════

set DATABASE_URL=postgres://odoo:odoo@localhost:5432/okirosport
set PORT=3300
set NODE_ENV=development
set APP_USER_NAME=Stark

REM Para activar la IA en local, descomenta y pon tu key:
REM set ANTHROPIC_API_KEY=sk-ant-...
REM set ANTHROPIC_MODEL=claude-haiku-4-5

echo.
echo   OkiroSport local  -^>  http://localhost:3300
echo   (Ctrl+C para parar)
echo.
start http://localhost:3300
node server.js
