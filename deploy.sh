#!/usr/bin/env bash
# OKIRO — despliegue en el droplet (Docker + nginx del host)
# Uso:  bash /opt/deploy.sh
set -euo pipefail

SRC=/tmp/okiro-deploy
TARBALL=https://github.com/EdwinJordanHerbas/starkos-pwa/archive/refs/heads/main.tar.gz
NGINX_SITE=/etc/nginx/sites-available/okirosport

echo ">> Backup (para rollback)"
cp /opt/backend/server.js /opt/backend/server.js.bak
tar czf /opt/pwa.bak.tgz -C /opt/pwa .
cp "$NGINX_SITE" "$NGINX_SITE.bak"

echo ">> Descargar codigo de GitHub"
rm -rf "$SRC" && mkdir -p "$SRC"
curl -fsSL "$TARBALL" | tar xz -C "$SRC" --strip-components=1
grep -qE 'Backend v[0-9]' "$SRC/server.js" || { echo "!! El server.js descargado no parece valido. Aborto sin tocar nada."; exit 1; }

echo ">> Backend (server.js + package.json)"
cp "$SRC/server.js" /opt/backend/server.js
cp "$SRC/package.json" /opt/backend/package.json 2>/dev/null || true

echo ">> Frontend (/opt/pwa)"
cp "$SRC/index.html" "$SRC/manifest.json" "$SRC/sw.js" "$SRC/mock.js" /opt/pwa/
rm -rf /opt/pwa/src /opt/pwa/icons /opt/pwa/assets
cp -r "$SRC/src"    /opt/pwa/src
cp -r "$SRC/icons"  /opt/pwa/icons
cp -r "$SRC/assets" /opt/pwa/assets

echo ">> Migraciones de base de datos (idempotentes)"
if docker ps --format '{{.Names}}' | grep -q '^postgres$'; then
  for M in migration.sql migration-v5.sql; do
    docker exec -i postgres psql -U postgres -d starkos < "$SRC/$M" >/dev/null 2>&1 \
      && echo "   $M aplicada" \
      || echo "   !! $M fallo (no bloqueante) - revisa a mano"
  done
else
  echo "   contenedor postgres no encontrado, salto migraciones"
fi

echo ">> Directorio de secretos"
# Las variables de entorno quedan grabadas en el contenedor: un archivo se rota sin recrearlo
mkdir -p /opt/backend/.secrets && chmod 700 /opt/backend/.secrets

echo ">> nginx: rutas hacia el backend"
# Cada bloque es idempotente: añade su ruta solo si falta
if ! grep -q '|ia|auth)' "$NGINX_SITE"; then
  sed -i 's#|strava|notion)#|strava|notion|ia|auth)#' "$NGINX_SITE"
fi
# /resumen faltaba: el dashboard de HOY devolvia 404 de nginx en produccion
if ! grep -q 'resumen' "$NGINX_SITE"; then
  sed -i 's#|ia|auth)#|ia|auth|resumen)#' "$NGINX_SITE"
fi
# /push: suscripciones y disparo de la mision diaria
if ! grep -q 'cruce' "$NGINX_SITE"; then
  sed -i 's#|ia|auth|resumen)#|ia|auth|resumen|push|cruce|party)#' "$NGINX_SITE"
fi
nginx -t && systemctl reload nginx

echo ">> Dependencias del backend (web-push para la mision diaria)"
# node_modules vive en /opt/backend (montado en /app), asi que persiste entre reinicios
docker exec backend sh -c 'cd /app && npm install --no-audit --no-fund web-push >/dev/null 2>&1' \
  && echo "   web-push instalado" \
  || echo "   !! no se pudo instalar web-push — los avisos quedaran inactivos"

echo ">> Reiniciar contenedor backend"
docker restart backend

echo ">> Cron: mision diaria (cada hora) + sync de Notion (una vez al dia)"
CRON_TICK='0 * * * * curl -fsS -X POST http://127.0.0.1:3000/push/tick >/dev/null 2>&1'
CRON_NOTION='15 5 * * * curl -fsS -H "Authorization: Bearer $(cat /opt/backend/.secrets/app_token 2>/dev/null)" http://127.0.0.1:3000/notion/sync >/dev/null 2>&1'
# `|| true` es obligatorio: sin crontab previo, `crontab -l` sale con codigo 1 y
# `set -e` mataba el subshell entero en silencio, dejando el cron sin instalar.
ACTUAL="$(crontab -l 2>/dev/null || true)"
{
  printf '%s\n' "$ACTUAL" | grep -v 'push/tick' | grep -v 'notion/sync' | grep -v '^$' || true
  echo "$CRON_TICK"
  echo "$CRON_NOTION"
} | crontab -
crontab -l | grep -q 'push/tick' && echo "   cron instalado" || echo "   !! el cron NO se instalo"

echo ">> DEPLOY OK. El backend tarda ~25s en reinstalar deps y arrancar."
echo ">> Verifica con:  docker logs --tail 15 backend ; curl -s https://okirosport.es/health"
