# OKIRO (carpeta local: `starkos-pwa`)

⚠️ **La carpeta se llama `starkos-pwa` pero el proyecto es OKIRO** (`okirosport.es`). El nombre
viejo se quedó; no renombrarlo sin avisar, que hay rutas de despliegue apuntando ahí.

## Qué es

PWA + backend propio. **No es Astro ni Next**: es JavaScript sin framework servido por Express.

- `index.html` en la raíz — la app
- `src/js/`, `src/css/` — el código de cliente
- `server.js` — backend Express
- `manifest.json` — configuración de PWA
- `mock.js` — datos de prueba

## Stack y comandos

Dependencias: `express`, `pg` (PostgreSQL), `web-push` (notificaciones push).
Gestor: **npm** (`package-lock.json`).

- `npm start` → `node server.js`
- No hay build: los archivos se sirven tal cual.
- Para arrancar en local en Windows hay `iniciar-local.cmd`.

## Base de datos

Postgres en el droplet, compartido con otros proyectos. El esquema va por **migraciones
acumulativas** en la raíz: `migration.sql`, `migration-v5.sql`, `migration-v6.sql`,
`migration-v7.sql`. Se aplican a mano y en orden.

**Trampa conocida:** las bases las creó el superusuario `postgres` pero cada app se conecta con
su propio usuario. Al crear tablas nuevas hay que dar permisos o la app responde
*"permission denied for table X"*. Los `GRANT` exactos están en la ficha `droplet-digitalocean`.

## Despliegue

Al **droplet de DigitalOcean** vía `deploy.sh` + `nginx.conf`, no a Vercel. Hacer push no
despliega. El acceso es `ssh droplet`.

La API usa un **Bearer token**; está en el `.env` del servidor, no en el repo. Ver la ficha de
memoria `okiro-proyecto` para cómo se siembran los proyectos y qué falta por automatizar.
