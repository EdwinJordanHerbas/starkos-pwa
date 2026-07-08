#!/usr/bin/env bash
# OkiroSport — despliegue en el droplet (Docker + nginx del host)
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
grep -q 'Backend v3' "$SRC/server.js" || { echo "!! GitHub aun no tiene la v3. Aborto sin tocar nada."; exit 1; }

echo ">> Backend (server.js)"
cp "$SRC/server.js" /opt/backend/server.js

echo ">> Frontend (/opt/pwa)"
cp "$SRC/index.html" "$SRC/manifest.json" "$SRC/sw.js" "$SRC/mock.js" /opt/pwa/
rm -rf /opt/pwa/src /opt/pwa/icons
cp -r "$SRC/src" /opt/pwa/src
cp -r "$SRC/icons" /opt/pwa/icons

echo ">> nginx: asegurar rutas /ia y /auth hacia el backend"
if ! grep -q '|ia|auth)' "$NGINX_SITE"; then
  sed -i 's#|strava|notion)#|strava|notion|ia|auth)#' "$NGINX_SITE"
fi
nginx -t && systemctl reload nginx

echo ">> Reiniciar contenedor backend"
docker restart backend

echo ">> DEPLOY OK. El backend tarda ~25s en reinstalar deps y arrancar."
echo ">> Verifica con:  docker logs --tail 12 backend ; curl -s https://okirosport.es/health"
