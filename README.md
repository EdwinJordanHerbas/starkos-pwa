# OkiroSport

**Tu sistema personal de rendimiento híbrido.** PWA instalable que unifica en una sola pantalla lo que normalmente vive en 4 apps: entrenamiento de fuerza, running (Strava), nutrición con IA y proyectos personales — con un coach IA que analiza tu día y tu semana.

> Producto: ver [PRODUCTO.md](PRODUCTO.md) · Dominio: [okirosport.es](https://okirosport.es)

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JS vanilla (sin build) · diseño "Liquid Glass" · PWA (service worker + offline) |
| Backend | Node 18+ · Express (`server.js`) |
| Base de datos | PostgreSQL (Docker) — esquema en `migration.sql` |
| Proxy | Nginx + Let's Encrypt (`nginx.conf`) |
| IA | Claude (Anthropic) — **key del servidor**, el usuario no configura nada |
| Integraciones | Strava (OAuth + webhook) · Notion (sync de tareas) |

## Variables de entorno

```bash
# Obligatorias
DATABASE_URL=postgres://user:pass@localhost:5432/starkos

# Seguridad (MUY recomendada en producción — sin ella la API queda abierta)
APP_TOKEN=una-clave-larga-y-unica          # clave de acceso de la PWA

# IA (foto de comida + resúmenes)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5           # por defecto; ~0,2 céntimos por análisis
AI_DAILY_LIMIT=40                          # tope de llamadas IA al día (protege tu factura)

# Obligatoria en producción — sin ella el servidor NO arranca (sale con exit 1).
# En local se puede omitir arrancando con NODE_ENV=development.
STRAVA_WEBHOOK_TOKEN=...

# Zona horaria para las fechas del registro diario. Por defecto Europe/Madrid.
# El servidor corre en UTC: sin esto, lo registrado de 00:00 a 02:00 caería en el día anterior.
APP_TZ=Europe/Madrid

# Opcionales
PORT=3000
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
```

**Coste de la IA** (con Haiku 4.5): una foto de comida ≈ 0,2 céntimos; un resumen ≈ 0,3 céntimos. Uso personal intensivo (10 análisis/día) ≈ **menos de 1 €/mes**. Puedes subir a `claude-sonnet-5` u `claude-opus-4-8` en `ANTHROPIC_MODEL` si quieres análisis más finos.

## Despliegue (VPS)

```bash
# 1. Código
git pull

# 2. Base de datos (idempotente, se puede re-ejecutar)
cat migration.sql | docker exec -i postgres psql -U postgres -d starkos

# 3. Dependencias + arranque
npm install
# con systemd/pm2, asegurando las variables de entorno de arriba:
pm2 restart okirosport || pm2 start server.js --name okirosport

# 4. Nginx (solo si cambió nginx.conf)
sudo cp nginx.conf /etc/nginx/sites-available/okirosport
sudo nginx -t && sudo systemctl reload nginx
```

## Desarrollo local sin base de datos

```bash
NODE_ENV=development node server.js     # o npm start
→ http://localhost:3000/?mock=1
```

`NODE_ENV=development` es necesario en local: sin él el servidor aborta pidiendo
`STRAVA_WEBHOOK_TOKEN`. En PowerShell: `$env:NODE_ENV="development"; node server.js`.

`?mock=1` activa `mock.js`, que intercepta la API con datos de ejemplo (incluida la IA). Sin ese parámetro el mock **no hace nada**, así que es seguro en producción.

## Seguridad

- **`APP_TOKEN`**: la PWA pide la clave una vez (pantalla de acceso) y la guarda en el dispositivo. Todos los endpoints la exigen salvo `/health` y los callbacks de Strava.
- **IA con límite diario** (`AI_DAILY_LIMIT`): aunque alguien tuviera tu clave, no puede quemar tu cuenta de Anthropic.
- La key de Anthropic **nunca sale del servidor**.

## Estructura

```
index.html          SPA (6 secciones: HOY · GYM · NUTRI · PROJ · IA · LOG)
server.js           API Express + proxy IA + Strava/Notion
migration.sql       esquema PostgreSQL + rutinas seed (PUSH/PULL/LEGS)
sw.js               service worker (offline + cache estáticos)
manifest.json       manifest PWA (instalable)
icons/              iconos generados (192/512/maskable/apple-touch)
mock.js             datos falsos para dev (solo con ?mock=1)
nginx.conf          proxy inverso + SSL
src/js/             app · projects · gym · nutrition · ia
src/css/            styles · components · sections · animations (Liquid Glass)
```

## Checklist antes de abrir al público

- [ ] `APP_TOKEN` definido en el servidor (¡y distinto de los ejemplos!)
- [ ] `ANTHROPIC_API_KEY` configurada y `AI_DAILY_LIMIT` razonable
- [ ] `migration.sql` ejecutada (crea tablas + rutinas seed)
- [ ] HTTPS activo (el service worker y la instalación PWA lo requieren)
- [ ] Probar en el móvil: instalar desde el navegador («Añadir a pantalla de inicio»)
- [ ] Hacer una foto de comida real y verificar el análisis
- [ ] Guardar un día completo y comprobar que aparece en LOG y en la racha
