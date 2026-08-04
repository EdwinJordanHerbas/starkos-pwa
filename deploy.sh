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
  for M in migration.sql migration-v5.sql migration-v6.sql migration-v7.sql migration-v8.sql migration-v9.sql migration-v10.sql migration-v11.sql migration-v12.sql migration-v13.sql migration-v14.sql; do
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

echo ">> ffmpeg (la tecnica en video, en vez de un GIF de 180px a tirones)"
# La imagen es node:20-alpine y no lo trae. Sin ffmpeg la app NO se rompe: el
# backend devuelve 404 en el .mp4 y el visor se cae al GIF, que de todos modos
# ya sale a 360px y con la cadencia corregida. Con ffmpeg, ademas, MP4 720x720.
if docker exec backend sh -c 'command -v ffmpeg' >/dev/null 2>&1; then
  echo "   ya estaba instalado"
else
  docker exec backend sh -c 'apk add --no-cache ffmpeg >/dev/null 2>&1' \
    && echo "   ffmpeg instalado" \
    || echo "   !! no se pudo instalar ffmpeg - la tecnica seguira en GIF"
fi
# Los caches viejos guardan dentro los tiempos malos y la resolucion de 180px:
# se tiran enteros. El backend usa .cache/ejercicios-v3 y los vuelve a pedir.
rm -rf /opt/backend/.cache/ejercicios /opt/backend/.cache/ejercicios-v2

echo ">> nginx: se copia el del repo (antes se parcheaba a ciegas con sed)"
# Los siete sed encadenados que habia aqui buscaban cada uno lo que habia
# insertado el anterior: en cuanto uno no casaba, los siguientes fallaban en
# silencio y la ruta nueva se quedaba fuera sin que nadie se enterara hasta
# ver un 404 raro en el movil. Ahora el archivo del repo ES el del servidor.
cp "$SRC/nginx.conf" "$NGINX_SITE"
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  echo "   nginx recargado"
else
  echo "   !! nginx.conf invalido - se restaura el anterior y NO se recarga"
  cp "$NGINX_SITE.bak" "$NGINX_SITE"
  nginx -t && echo "   restaurado correctamente"
fi

echo ">> Dependencias del backend (web-push para la mision diaria)"
# node_modules vive en /opt/backend (montado en /app), asi que persiste entre reinicios
docker exec backend sh -c 'cd /app && npm install --no-audit --no-fund web-push >/dev/null 2>&1' \
  && echo "   web-push instalado" \
  || echo "   !! no se pudo instalar web-push — los avisos quedaran inactivos"

echo ">> Reiniciar contenedor backend"
docker restart backend

echo ">> Cron: mision diaria (cada hora) + respaldo del envio a Notion"
CRON_TICK='0 * * * * curl -fsS -X POST http://127.0.0.1:3000/push/tick >/dev/null 2>&1'
# El envio a Notion ya se dispara solo al editar un proyecto: este cron es la
# red de seguridad por si el backend se reinicio con un envio pendiente.
CRON_NOTION='15 5 * * * curl -fsS -X POST -H "Authorization: Bearer $(cat /opt/backend/.secrets/app_token 2>/dev/null)" http://127.0.0.1:3000/notion/push >/dev/null 2>&1'
# `|| true` es obligatorio: sin crontab previo, `crontab -l` sale con codigo 1 y
# `set -e` mataba el subshell entero en silencio, dejando el cron sin instalar.
ACTUAL="$(crontab -l 2>/dev/null || true)"
{
  printf '%s\n' "$ACTUAL" | grep -v 'push/tick' | grep -v 'notion/sync' | grep -v 'notion/push' | grep -v '^$' || true
  echo "$CRON_TICK"
  echo "$CRON_NOTION"
} | crontab -
crontab -l | grep -q 'push/tick' && echo "   cron instalado" || echo "   !! el cron NO se instalo"

echo ">> DEPLOY OK. El backend tarda ~25s en reinstalar deps y arrancar."
echo ">> Verifica con:  docker logs --tail 15 backend ; curl -s https://okirosport.es/health"
