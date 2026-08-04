# OKIRO (carpeta local: `starkos-pwa`)

⚠️ **La carpeta se llama `starkos-pwa` pero el proyecto es OKIRO** (`okirosport.es`). El nombre
viejo se quedó; no renombrarlo sin avisar, que hay rutas de despliegue apuntando ahí.

## Qué es

PWA + backend propio. **No es Astro ni Next**: es JavaScript sin framework servido por Express.

- `index.html` en la raíz — la app
- `src/js/`, `src/css/` — el código de cliente
- `server.js` — backend Express
- `manifest.json` — configuración de PWA
- `mock.js` — datos de prueba (solo se descarga con `?mock=1`)
- `tools/` — comprobaciones que se ejecutan a mano, ver abajo

## Comprobaciones antes de dar algo por bueno

No hay build, así que `node --check` es lo único que avisa de un error de sintaxis. Lo demás:

- `node tools/test-gym.js` — ejecuta el `gym.js` real contra un DOM falso
- `node tools/test-codificacion.js` — que ningún archivo se guarde con las tildes rotas
- `node tools/css-sin-uso.js` — lista clases CSS candidatas a sobrar (no borra nada)

## Tres cosas que no son obvias

**Lo que hay en la carpeta del backend es público.** `express.static` sirve `__dirname` y va
antes del control de acceso. Hay un filtro que tapa `server.js`, las migraciones y todo lo que
empiece por punto (`.secrets`, `.cache`, `.git`); al añadir archivos al backend, comprobar que
no quedan servidos.

**Las rutas nuevas de la API hay que darlas de alta en `nginx.conf`.** Si no, nginx responde su
propio 404 y parece que el backend está roto.

**Los vídeos de técnica se mapean a mano y no se automatiza.** El catálogo de vídeo usa ids de
cuatro dígitos como los nuestros, pero no son los mismos ejercicios: de 238 coincidencias, 77
apuntan a otro movimiento. El mapeo revisado vive en `migration-v14.sql`, en la columna
`ejercicios.video_slug`. Para un ejercicio nuevo, buscar su nombre en el JSON del catálogo y
comprobar el clip antes de guardarlo.

## Stack y comandos

Dependencias: `express`, `pg` (PostgreSQL), `web-push` (notificaciones push).
Gestor: **npm** (`package-lock.json`).

- `npm start` → `node server.js`
- No hay build: los archivos se sirven tal cual.
- Para arrancar en local en Windows hay `iniciar-local.cmd`.

## Base de datos

Postgres en el droplet, compartido con otros proyectos. El esquema va por **migraciones
acumulativas** en la raíz, de `migration.sql` a `migration-v13.sql`. Son idempotentes y las
aplica `deploy.sh` en orden; a mano solo si algo falló.

Para probar cambios del backend sin tocar los datos reales: crear `starkos_test` en el mismo
Postgres, aplicarle las migraciones y arrancar ahí. Nunca contra `starkos`.

**Trampa conocida:** las bases las creó el superusuario `postgres` pero cada app se conecta con
su propio usuario. Al crear tablas nuevas hay que dar permisos o la app responde
*"permission denied for table X"*. Los `GRANT` exactos están en la ficha `droplet-digitalocean`.

## Despliegue

Al **droplet de DigitalOcean** vía `deploy.sh` + `nginx.conf`, no a Vercel. Hacer push no
despliega. El acceso es `ssh droplet`.

La API usa un **Bearer token**; está en el `.env` del servidor, no en el repo. Ver la ficha de
memoria `okiro-proyecto` para cómo se siembran los proyectos y qué falta por automatizar.
