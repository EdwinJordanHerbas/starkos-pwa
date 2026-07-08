@echo off
REM ══════════════════════════════════════════════════
REM  OkiroSport — arranque local (doble clic)
REM  BD: PostgreSQL de Odoo (localhost:5432/okirosport)
REM ══════════════════════════════════════════════════
set DATABASE_URL=postgres://odoo:odoo@localhost:5432/okirosport
set PORT=3300

REM Para activar la IA en local, descomenta y pon tu key:
REM set ANTHROPIC_API_KEY=sk-ant-...
REM set ANTHROPIC_MODEL=claude-haiku-4-5

echo.
echo   OkiroSport local  -^>  http://localhost:3300
echo   (Ctrl+C para parar)
echo.
start http://localhost:3300
node server.js
