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

# 4. Nginx: NO hace falta copiarlo a mano, lo hace deploy.sh (y revierte si no valida)
```

En la práctica todo esto lo hace `bash /opt/deploy.sh` en el droplet: descarga el código,
aplica las migraciones, instala ffmpeg si falta, despliega el nginx y reinicia el contenedor.

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
- **IA con límite diario** (`AI_DAILY_LIMIT`): aunque alguien tuviera tu clave, no puede quemar tu cuenta de Anthropic. El contador vive en la base de datos, así que un reinicio del backend no lo pone a cero.
- La key de Anthropic **nunca sale del servidor**.
- **El directorio del backend no se publica**: `express.static` sirve `__dirname` y se ejecuta antes del control de acceso, así que hay un filtro delante que niega los archivos que empiezan por punto (`.secrets`, `.cache`, `.git`) y los que son del servidor (`server.js`, migraciones, `deploy.sh`). Al añadir archivos nuevos al backend, comprobar que no quedan servidos.

## Estructura

```
index.html          SPA (5 secciones: HOY · GYM · NUTRI · PROJ · LOG; la IA vive dentro de HOY)
server.js           API Express + proxy IA + Strava/Notion
migration*.sql      esquema PostgreSQL, acumulativo de migration.sql a migration-v13.sql
sw.js               service worker (offline + cache estáticos)
manifest.json       manifest PWA (instalable)
icons/              iconos generados (192/512/maskable/apple-touch)
assets/             banners (.webp servidos, .png de origen) + catálogo de ejercicios
mock.js             datos falsos para dev (solo se descarga con ?mock=1)
nginx.conf          EL nginx del servidor, no una propuesta — lo despliega deploy.sh
src/js/             app · projects · gym · nutrition · ia
src/css/            styles · components · sections · animations (Liquid Glass)
tools/              comprobaciones a mano: test-gym · test-rutas · test-codificacion · css-sin-uso
```

## La técnica de los ejercicios

Se veía pixelada y a tirones, por dos motivos distintos: el GIF medía 180×180 y sus tiempos por
fotograma incluyen **dos congelaciones de un segundo** de los tres que dura la vuelta.

El backend usa **dos catálogos con el mismo id de cuatro dígitos**:

| | Repo | Qué aporta |
|---|---|---|
| Principal | [`omercotkd/exercises-gifs`](https://github.com/omercotkd/exercises-gifs) (MIT) | la misma animación a **360×360** |
| Respaldo | [`hasaneyldrm/exercises-dataset`](https://github.com/hasaneyldrm/exercises-dataset) | 180×180 y las miniaturas `.jpg` |

Sobre eso, el GIF se guarda con la cadencia uniforme (10 fps) y, **si hay ffmpeg**, se genera un
MP4: 720×720 desde el catálogo bueno, 540×540 si hubo que tirar del respaldo. Los dos pesan
menos que el GIF de 180 que se servía antes. `deploy.sh` instala ffmpeg en el contenedor; sin él
la app funciona igual con el GIF ya arreglado. Todo se cachea en `.cache/ejercicios-v3/` bajo
demanda.

### Y además, el vídeo de una persona

La animación 3D enseña el recorrido, pero no dónde apoyas el pie. Cada ejercicio puede llevar un
clip real en Full HD de [`free-exercise-db-with-videos`](https://github.com/arhxam/free-exercise-db-with-videos)
(MIT, 317 ejercicios, 593 clips con modelo masculino y femenino), que el backend sirve y cachea
en `/ejercicios/video/{sexo}/{slug}` igual que las animaciones.

El visor **abre siempre por la animación** (85 KB, instantánea) y ofrece un botón «ver en vídeo»:
los 330 KB del clip solo se descargan si los pides. Los que no son exactamente el mismo
movimiento van marcados con `video_aprox` y la app lo avisa en pantalla.

⚠️ **El mapeo es a mano, en `migration-v14.sql`, y tiene que seguir siéndolo.** Ese catálogo
también usa ids de cuatro dígitos y no coinciden con los nuestros: de los 238 que cruzan, solo
161 son el mismo ejercicio. Emparejar por id (o por sus `aliases`) enseñaría el ejercicio
equivocado una de cada tres veces.

## Checklist antes de abrir al público

- [ ] `APP_TOKEN` definido en el servidor (¡y distinto de los ejemplos!)
- [ ] `ANTHROPIC_API_KEY` configurada y `AI_DAILY_LIMIT` razonable
- [ ] `migration.sql` ejecutada (crea tablas + rutinas seed)
- [ ] HTTPS activo (el service worker y la instalación PWA lo requieren)
- [ ] Probar en el móvil: instalar desde el navegador («Añadir a pantalla de inicio»)
- [ ] Hacer una foto de comida real y verificar el análisis
- [ ] Guardar un día completo y comprobar que aparece en LOG y en la racha
