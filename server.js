// OKIRO Backend v4 — producción
// Requiere Node 18+ (usa fetch global)
const express = require('express');
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');
const app = express();

// ════════════════════════════════════════════════════════
// SECRETOS EN ARCHIVO
// ════════════════════════════════════════════════════════
// Las variables de entorno quedan grabadas en el contenedor al crearlo, así que
// rotar una obliga a recrearlo y a manejar el resto de secretos en texto plano.
// Un archivo montado se edita y basta con reiniciar. Prioridad: archivo > entorno.
//
//   Rotar la clave de acceso:
//     openssl rand -base64 32 > /opt/backend/.secrets/app_token
//     chmod 600 /opt/backend/.secrets/app_token
//     docker restart backend
const SECRETS_DIR = path.join(__dirname, '.secrets');
function secret(nombre, fallbackEnv) {
  try {
    const v = fs.readFileSync(path.join(SECRETS_DIR, nombre), 'utf8').trim();
    if (v) return v;
  } catch { /* sin archivo: se usa el entorno */ }
  return process.env[fallbackEnv] || '';
}

// ════════════════════════════════════════════════════════
// CONFIG (archivo de secretos, con respaldo en variables de entorno)
// ════════════════════════════════════════════════════════
const PORT           = parseInt(process.env.PORT || '3000', 10);
const APP_TOKEN      = secret('app_token', 'APP_TOKEN');            // clave de acceso única (mono-usuario)
const APP_USER_NAME  = process.env.APP_USER_NAME || 'Stark';
const AI_MODEL       = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
const AI_DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '40', 10);
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const APP_TZ         = process.env.APP_TZ || 'Europe/Madrid';       // zona horaria del usuario

// Fecha de HOY en la zona del usuario, NO en UTC.
// El servidor corre en UTC: con toISOString() todo lo registrado entre las
// 00:00 y las 02:00 (hora española) se guardaba en el día anterior y rompía la racha.
const hoyStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ }).format(new Date());

// ── Estáticos (la PWA) — siempre públicos ────────────────
app.use(express.static(__dirname, {
  setHeaders(res, filePath) {
    // El service worker y el index no deben quedar cacheados por el navegador
    if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ── CORS ─────────────────────────────────────────────────
const PROD_ORIGIN = 'https://okirosport.es';
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const isDev  = process.env.NODE_ENV === 'development' || /^https?:\/\/localhost(:\d+)?$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', isDev ? (origin || PROD_ORIGIN) : PROD_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '15mb' }));

// ── AUTH: clave de acceso única ──────────────────────────
// Si APP_TOKEN no está definido, la API queda abierta (modo dev).
const PUBLIC_PATHS = [
  /^\/health$/,
  /^\/strava\/(webhook|callback|auth)$/,  // Strava llama sin cabeceras propias
  /^\/push\/tick$/                        // lo dispara el cron del host, ver nota abajo
];
// Por qué /push/tick es público: no lee ni escribe datos del usuario y no expone nada.
// Como mucho manda un aviso a TUS propios dispositivos suscritos, una sola vez al día
// (tabla push_enviados) y solo si la hora coincide con la que configuraste. Alternativa
// descartada: exigir el token al cron, que ataría los avisos a que el archivo de
// secretos exista y fallaría en silencio si se rota mal.
app.use((req, res, next) => {
  if (!APP_TOKEN) return next();
  if (PUBLIC_PATHS.some(r => r.test(req.path))) return next();
  if ((req.headers.authorization || '') === `Bearer ${APP_TOKEN}`) return next();
  res.status(401).json({ error: 'No autorizado' });
});

app.get('/auth/check', (req, res) => res.json({ ok: true }));

// ── DB ───────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (e) => console.error('DB error', e.message));
const db = (q, p) => pool.query(q, p);

// ── LÍMITE DIARIO DE IA (protege tu factura) ─────────────
let aiUsage = { day: '', count: 0 };
function aiQuotaOk() {
  const today = hoyStr();
  if (aiUsage.day !== today) aiUsage = { day: today, count: 0 };
  if (aiUsage.count >= AI_DAILY_LIMIT) return false;
  aiUsage.count++;
  return true;
}

// ── Llamada a Claude (key del servidor, nunca del cliente) ─
async function claude(content, maxTokens = 1024) {
  if (!ANTHROPIC_KEY) {
    const err = new Error('ANTHROPIC_API_KEY no configurada en el servidor');
    err.status = 503;
    throw err;
  }
  if (!aiQuotaOk()) {
    const err = new Error(`Límite diario de IA alcanzado (${AI_DAILY_LIMIT}/día)`);
    err.status = 429;
    throw err;
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model:      AI_MODEL,
      max_tokens: maxTokens,
      messages:   [{ role: 'user', content }]
    })
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const err = new Error(d?.error?.message || `Anthropic HTTP ${r.status}`);
    err.status = 502;
    throw err;
  }
  const d = await r.json();
  return d.content?.[0]?.text || '';
}

// ════════════════════════════════════════════════════════
// PUSH — la misión diaria
// ════════════════════════════════════════════════════════
// El sistema avisa; no anima (kit de marca). Dos disparos al día:
//   · hora_aviso  → "Misión diaria disponible."  (solo si aún no registraste)
//   · hora_cierre → "El aura no ha salido hoy."  (solo si el día acaba en blanco)
let webpush = null;
let PUSH_READY = false;
try {
  webpush = require('web-push');
  const pub  = secret('vapid_public',  'VAPID_PUBLIC_KEY');
  const priv = secret('vapid_private', 'VAPID_PRIVATE_KEY');
  const mail = process.env.VAPID_SUBJECT || 'mailto:okiro@okirosport.es';
  if (pub && priv) {
    webpush.setVapidDetails(mail, pub, priv);
    PUSH_READY = true;
  }
} catch { /* web-push no instalado: la app funciona igual, sin avisos */ }

// La clave pública es pública por definición: el cliente la necesita para suscribirse
app.get('/push/clave', (req, res) => {
  res.json({ clave: secret('vapid_public', 'VAPID_PUBLIC_KEY') || null, activo: PUSH_READY });
});

app.post('/push/suscribir', async (req, res) => {
  const { endpoint, keys, hora_aviso, hora_cierre } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Suscripción incompleta' });
  }
  try {
    await db(
      `INSERT INTO push_subs (endpoint, p256dh, auth, hora_aviso, hora_cierre, activa)
       VALUES ($1,$2,$3,$4,$5,TRUE)
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh=$2, auth=$3, hora_aviso=$4, hora_cierre=$5, activa=TRUE`,
      [endpoint, keys.p256dh, keys.auth, hora_aviso ?? 8, hora_cierre ?? 22]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/push/baja', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Falta endpoint' });
  try {
    await db('UPDATE push_subs SET activa=FALSE WHERE endpoint=$1', [endpoint]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ¿Hay registro hoy? Un día cuenta si tiene sueño, entreno, comida o nota.
async function registradoHoy() {
  const hoy = hoyStr();
  const { rows } = await db(
    `SELECT 1 FROM daily_logs
      WHERE fecha=$1 AND (COALESCE(sueno,0)>0 OR entreno_completado
                          OR COALESCE(nutricion,0)>0 OR COALESCE(notas,'')<>'')
      UNION ALL SELECT 1 FROM comidas       WHERE fecha=$1
      UNION ALL SELECT 1 FROM sesiones_gym  WHERE fecha=$1
      LIMIT 1`, [hoy]
  ).catch(() => ({ rows: [] }));
  return rows.length > 0;
}

async function enviarATodos(titulo, cuerpo) {
  if (!PUSH_READY) return { enviados: 0, motivo: 'push inactivo' };
  const { rows } = await db('SELECT * FROM push_subs WHERE activa=TRUE');
  let enviados = 0;
  for (const s of rows) {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(sub, JSON.stringify({ titulo, cuerpo }));
      enviados++;
    } catch (e) {
      // 404/410 = el navegador tiró la suscripción; darla de baja en vez de reintentar
      if (e.statusCode === 404 || e.statusCode === 410) {
        await db('UPDATE push_subs SET activa=FALSE WHERE endpoint=$1', [s.endpoint]).catch(() => {});
      }
    }
  }
  return { enviados };
}

// Lo llama el cron cada hora. Decide solo si toca avisar y qué decir.
app.post('/push/tick', async (req, res) => {
  try {
    const horaLocal = parseInt(
      new Intl.DateTimeFormat('en-GB', { timeZone: APP_TZ, hour: '2-digit', hour12: false })
        .format(new Date()), 10
    );
    const hoy  = hoyStr();
    const hecho = await registradoHoy();
    if (hecho) return res.json({ ok: true, accion: 'nada', motivo: 'ya registrado hoy' });

    const { rows: subs } = await db('SELECT * FROM push_subs WHERE activa=TRUE');
    const tocaAviso  = subs.some(s => s.hora_aviso  === horaLocal);
    const tocaCierre = subs.some(s => s.hora_cierre === horaLocal);
    const tipo = tocaCierre ? 'cierre' : tocaAviso ? 'mision' : null;
    if (!tipo) return res.json({ ok: true, accion: 'nada', hora: horaLocal });

    // Idempotencia: si ya se mandó ese aviso hoy, no repetir
    const { rowCount } = await db(
      'INSERT INTO push_enviados (fecha, tipo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [hoy, tipo]
    );
    if (!rowCount) return res.json({ ok: true, accion: 'nada', motivo: 'ya enviado' });

    const r = tipo === 'cierre'
      ? await enviarATodos('OKIRO', 'El aura no ha salido hoy.')
      : await enviarATodos('OKIRO', 'Misión diaria disponible.');
    res.json({ ok: true, accion: tipo, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Extrae el primer objeto JSON de un texto (tolera ```json ... ```)
function parseJSONLoose(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

// hoyStr() se define arriba, junto a APP_TZ (fecha local del usuario, no UTC).

// ════════════════════════════════════════════════════════
// HEALTH
// ════════════════════════════════════════════════════════
app.get('/health', async (req, res) => {
  try {
    await db('SELECT 1');
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════
// LOGS DIARIOS
// ════════════════════════════════════════════════════════
app.get('/logs', async (req, res) => {
  try {
    // 90 días: con 30 el rango S (racha de 60+) era incomputable en el cliente
    const { rows } = await db('SELECT * FROM daily_logs ORDER BY fecha DESC LIMIT 90');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/logs', async (req, res) => {
  const { fecha, sueno, energia, entreno_completado, tipo_entreno, nutricion, tareas_completadas, tareas_total, notas } = req.body;
  try {
    const { rows } = await db(
      `INSERT INTO daily_logs (fecha, sueno, energia, entreno_completado, tipo_entreno, nutricion, tareas_completadas, tareas_total, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (fecha) DO UPDATE SET
         sueno=$2, energia=$3, entreno_completado=$4, tipo_entreno=$5,
         nutricion=$6, tareas_completadas=$7, tareas_total=$8, notas=$9
       RETURNING *`,
      [fecha, sueno, energia, entreno_completado, tipo_entreno, nutricion, tareas_completadas, tareas_total, notas]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// PROYECTOS
// ════════════════════════════════════════════════════════
app.get('/proyectos', async (req, res) => {
  try {
    const { rows } = await db('SELECT * FROM proyectos ORDER BY id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/proyectos', async (req, res) => {
  const { nombre, objetivo } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const { rows } = await db(
      'INSERT INTO proyectos (nombre, objetivo, progreso, ultima_accion) VALUES ($1,$2,0,$3) RETURNING *',
      [nombre, objetivo || '', 'Proyecto creado']
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/proyectos/:id', async (req, res) => {
  const { progreso, ultima_accion } = req.body;
  try {
    const { rows } = await db(
      'UPDATE proyectos SET progreso=$1, ultima_accion=$2, updated_at=NOW() WHERE id=$3 RETURNING *',
      [progreso, ultima_accion, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/proyectos/:id', async (req, res) => {
  try {
    await db('DELETE FROM proyectos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// RUTINAS & GYM
// ════════════════════════════════════════════════════════
app.get('/rutinas', async (req, res) => {
  try {
    const { rows } = await db('SELECT * FROM rutinas ORDER BY id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/rutinas', async (req, res) => {
  const { nombre, descripcion, dias } = req.body;
  try {
    const { rows } = await db(
      'INSERT INTO rutinas (nombre, descripcion, dias) VALUES ($1,$2,$3) RETURNING *',
      [nombre, descripcion, JSON.stringify(dias || [])]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/rutinas/:id/ejercicios', async (req, res) => {
  try {
    const { rows } = await db(
      'SELECT * FROM ejercicios WHERE rutina_id=$1 ORDER BY orden',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/ejercicios', async (req, res) => {
  const { rutina_id, nombre, series, reps_objetivo, orden } = req.body;
  try {
    const { rows } = await db(
      'INSERT INTO ejercicios (rutina_id, nombre, series, reps_objetivo, orden) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [rutina_id, nombre, series, reps_objetivo, orden]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Inicia o recupera sesión del día
app.post('/sesiones', async (req, res) => {
  const { fecha, rutina_id, notas } = req.body;
  const hoy = fecha || hoyStr();
  try {
    const { rows } = await db(
      `INSERT INTO sesiones_gym (fecha, rutina_id, notas)
       VALUES ($1,$2,$3)
       ON CONFLICT (fecha) DO UPDATE SET rutina_id=EXCLUDED.rutina_id
       RETURNING *`,
      [hoy, rutina_id, notas || '']
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sesiones/hoy', async (req, res) => {
  try {
    const { rows } = await db(
      `SELECT s.*, r.nombre AS rutina_nombre
       FROM sesiones_gym s
       LEFT JOIN rutinas r ON r.id = s.rutina_id
       WHERE s.fecha = $1`, [hoyStr()]
    );
    if (!rows.length) return res.json(null);
    const sesion = rows[0];
    const { rows: series } = await db(
      `SELECT sr.*, e.nombre AS ejercicio_nombre, e.reps_objetivo
       FROM series_realizadas sr
       JOIN ejercicios e ON e.id = sr.ejercicio_id
       WHERE sr.sesion_id = $1
       ORDER BY e.orden, sr.serie_num`,
      [sesion.id]
    );
    sesion.series = series;
    res.json(sesion);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sesiones', async (req, res) => {
  try {
    const { rows } = await db(
      `SELECT s.*, r.nombre AS rutina_nombre,
         (SELECT COUNT(*) FROM series_realizadas WHERE sesion_id=s.id) AS total_series
       FROM sesiones_gym s
       LEFT JOIN rutinas r ON r.id = s.rutina_id
       ORDER BY s.fecha DESC LIMIT 30`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/sesiones/:id/series', async (req, res) => {
  const { ejercicio_id, serie_num, peso, reps } = req.body;
  try {
    const { rows } = await db(
      `INSERT INTO series_realizadas (sesion_id, ejercicio_id, serie_num, peso, reps, completada)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (sesion_id, ejercicio_id, serie_num)
       DO UPDATE SET peso=$4, reps=$5
       RETURNING *`,
      [req.params.id, ejercicio_id, serie_num, peso, reps]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/sesiones/:id/completar', async (req, res) => {
  const { foto_url, notas } = req.body || {};
  try {
    const { rows } = await db(
      'UPDATE sesiones_gym SET completada=true, foto_url=$2, notas=$3 WHERE id=$1 RETURNING *',
      [req.params.id, foto_url || null, notas || '']
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// STRAVA
// ════════════════════════════════════════════════════════
const S_ID  = process.env.STRAVA_CLIENT_ID;
const S_SEC = process.env.STRAVA_CLIENT_SECRET;
const S_TOK = (() => {
  if (process.env.STRAVA_WEBHOOK_TOKEN) return process.env.STRAVA_WEBHOOK_TOKEN;
  if (process.env.NODE_ENV === 'development') return 'okirosport2024';
  console.error('FATAL: STRAVA_WEBHOOK_TOKEN no está definido. Configúralo en producción antes de arrancar.');
  process.exit(1);
})();

app.get('/strava/status', async (req, res) => {
  const configured = !!(S_ID && S_SEC);
  const { rows } = await db('SELECT athlete_id FROM strava_tokens LIMIT 1').catch(() => ({ rows: [] }));
  res.json({ configured, connected: rows.length > 0 });
});

app.get('/strava/auth', (req, res) => {
  if (!S_ID) return res.status(503).json({ error: 'Strava no configurado en variables de entorno' });
  res.redirect(
    `https://www.strava.com/oauth/authorize?client_id=${S_ID}&response_type=code` +
    `&redirect_uri=https://okirosport.es/strava/callback&approval_prompt=auto&scope=read,activity:read_all`
  );
});

app.get('/strava/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?strava=denied');
  if (!code) return res.status(400).json({ error: 'Sin código' });
  try {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: S_ID, client_secret: S_SEC, code, grant_type: 'authorization_code' })
    });
    const d = await r.json();
    await db(
      `INSERT INTO strava_tokens (athlete_id, access_token, refresh_token, expires_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (athlete_id) DO UPDATE SET access_token=$2, refresh_token=$3, expires_at=$4`,
      [d.athlete.id, d.access_token, d.refresh_token, d.expires_at]
    );
    res.redirect('/?strava=ok');
  } catch (e) { res.redirect('/?strava=error'); }
});

// Verificación del webhook Strava
app.get('/strava/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === S_TOK)
    return res.json({ 'hub.challenge': req.query['hub.challenge'] });
  res.sendStatus(403);
});

app.post('/strava/webhook', async (req, res) => {
  res.sendStatus(200); // Strava necesita 200 inmediato
  const { object_type, aspect_type, object_id, owner_id } = req.body;
  if (object_type !== 'activity' || aspect_type !== 'create') return;
  try {
    const { rows } = await db('SELECT * FROM strava_tokens WHERE athlete_id=$1', [owner_id]);
    if (!rows.length) return;
    let tok = rows[0];
    if (Date.now() / 1000 > tok.expires_at - 300) {
      const rr = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: S_ID, client_secret: S_SEC, refresh_token: tok.refresh_token, grant_type: 'refresh_token' })
      });
      const rd = await rr.json();
      await db(
        'UPDATE strava_tokens SET access_token=$1, refresh_token=$2, expires_at=$3 WHERE athlete_id=$4',
        [rd.access_token, rd.refresh_token, rd.expires_at, owner_id]
      );
      tok.access_token = rd.access_token;
    }
    const ar = await fetch(`https://www.strava.com/api/v3/activities/${object_id}`, {
      headers: { Authorization: `Bearer ${tok.access_token}` }
    });
    const act = await ar.json();
    await db(
      `INSERT INTO strava_activities
         (strava_id,athlete_id,nombre,tipo,fecha,distancia,tiempo,elevacion,calorias,avg_hr,max_hr,avg_speed,kudos,datos_raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (strava_id) DO NOTHING`,
      [act.id, owner_id, act.name, act.type, act.start_date, act.distance, act.moving_time,
       act.total_elevation_gain, act.calories, act.average_heartrate, act.max_heartrate,
       act.average_speed, act.kudos_count, JSON.stringify(act)]
    );
  } catch (e) { console.error('Strava webhook error:', e.message); }
});

app.get('/strava/actividades', async (req, res) => {
  try {
    const { rows } = await db('SELECT * FROM strava_activities ORDER BY fecha DESC LIMIT 20');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// NOTION
// ════════════════════════════════════════════════════════
app.post('/notion/config', async (req, res) => {
  const { token, database_id } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  try {
    await db(`INSERT INTO config (clave, valor) VALUES ('notion_token',$1) ON CONFLICT (clave) DO UPDATE SET valor=$1`, [token]);
    if (database_id)
      await db(`INSERT INTO config (clave, valor) VALUES ('notion_db',$1) ON CONFLICT (clave) DO UPDATE SET valor=$1`, [database_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/notion/sync', async (req, res) => {
  try {
    const { rows } = await db("SELECT clave, valor FROM config WHERE clave IN ('notion_token','notion_db')");
    const cfg = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
    if (!cfg.notion_token) return res.status(503).json({ error: 'Notion no configurado' });
    const r = await fetch(`https://api.notion.com/v1/databases/${cfg.notion_db}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.notion_token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ page_size: 100 })
    });
    const data = await r.json();
    if (data.status === 400) return res.status(400).json({ error: data.message });
    let completadas = 0;
    for (const page of (data.results || [])) {
      const done = page.properties?.Status?.select?.name === 'Done'
        || page.properties?.Completada?.checkbox === true
        || page.properties?.Done?.checkbox === true;
      if (done) completadas++;
    }
    await db(
      `INSERT INTO daily_logs (fecha, tareas_completadas, tareas_total)
       VALUES ($1,$2,$3)
       ON CONFLICT (fecha) DO UPDATE SET tareas_completadas=$2, tareas_total=$3`,
      [hoyStr(), completadas, data.results?.length || 0]
    );
    res.json({ synced: data.results?.length || 0, completadas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// NUTRICIÓN
// ════════════════════════════════════════════════════════
app.get('/nutricion/:fecha', async (req, res) => {
  try {
    const { rows } = await db('SELECT * FROM comidas WHERE fecha=$1 ORDER BY created_at', [req.params.fecha]);
    const totals = rows.reduce(
      (a, c) => ({ calorias: a.calorias + (c.calorias || 0), proteinas: a.proteinas + +(c.proteinas || 0), carbos: a.carbos + +(c.carbos || 0), grasas: a.grasas + +(c.grasas || 0) }),
      { calorias: 0, proteinas: 0, carbos: 0, grasas: 0 }
    );
    res.json({ comidas: rows, totales: totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/nutricion', async (req, res) => {
  const { fecha, nombre, calorias, proteinas, carbos, grasas, foto_url } = req.body;
  try {
    const { rows } = await db(
      'INSERT INTO comidas (fecha, nombre, calorias, proteinas, carbos, grasas, foto_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [fecha || hoyStr(), nombre, calorias || 0, proteinas || 0, carbos || 0, grasas || 0, foto_url || null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/nutricion/:id', async (req, res) => {
  try {
    await db('DELETE FROM comidas WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Análisis de foto de comida — usa la key del servidor (gratis para el usuario)
app.post('/nutricion/analizar-foto', async (req, res) => {
  const { imagen_base64, media_type } = req.body;
  if (!imagen_base64) return res.status(400).json({ error: 'imagen_base64 requerida' });
  try {
    const texto = await claude([
      { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: imagen_base64 } },
      { type: 'text', text: 'Analiza esta comida y estima sus macros. Devuelve ÚNICAMENTE un JSON sin markdown con este formato exacto:\n{"nombre":"nombre corto del plato en español","calorias":0,"proteinas":0,"carbos":0,"grasas":0}\nLos valores son números enteros (gramos para macros, kcal para calorías).' }
    ], 300);
    const data = parseJSONLoose(texto);
    if (!data.nombre) return res.status(422).json({ error: 'La IA no pudo identificar la comida' });
    res.json(data);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// USUARIOS — resolución de identidad
// ════════════════════════════════════════════════════════
// Compatibilidad: si la clave presentada es APP_TOKEN, es el dueño (usuario 1).
// Si no, se busca el hash en la tabla usuarios. No hay auto-registro: mientras
// solo exista el usuario 1 es imposible que alguien vea datos de otro.
const crypto = require('crypto');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

async function usuarioDe(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!bearer) return null;
  if (APP_TOKEN && bearer === APP_TOKEN) return 1;                 // el dueño
  const { rows } = await db(
    'SELECT id FROM usuarios WHERE token_hash=$1 AND activo LIMIT 1', [sha256(bearer)]
  ).catch(() => ({ rows: [] }));
  return rows[0]?.id ?? null;
}

// ════════════════════════════════════════════════════════
// PARTY — sostener, no competir
// ════════════════════════════════════════════════════════
// Solo circula dato nativo de OKIRO: rango y racha. Nada de Strava, cuyo acuerdo
// de API prohíbe mostrar los datos de un usuario a cualquier otro usuario.

// Racha de un usuario, calculada en SQL: días consecutivos con registro hacia atrás.
async function rachaDe(usuarioId) {
  const { rows } = await db(
    `WITH dias AS (
       SELECT DISTINCT fecha FROM daily_logs
        WHERE usuario_id=$1
          AND (COALESCE(sueno,0)>0 OR entreno_completado
               OR COALESCE(nutricion,0)>0 OR COALESCE(notas,'')<>'')
     ),
     -- Si hoy aún no hay registro, la racha de ayer sigue viva: el día no ha terminado
     base AS (
       SELECT CASE WHEN EXISTS (SELECT 1 FROM dias WHERE fecha = $2::date)
                   THEN $2::date ELSE $2::date - 1 END AS ini
     )
     SELECT COUNT(*)::int AS racha FROM dias, base
      WHERE fecha <= base.ini
        AND fecha > base.ini - (SELECT COUNT(*) + 1 FROM dias)
        AND base.ini - fecha = (SELECT COUNT(*) FROM dias d2
                                 WHERE d2.fecha > fecha AND d2.fecha <= base.ini)`,
    [usuarioId, hoyStr()]
  ).catch(() => ({ rows: [{ racha: 0 }] }));
  return rows[0]?.racha ?? 0;
}

function rangoDeRacha(n) {
  if (n >= 60) return 'S';
  if (n >= 30) return 'A';
  if (n >= 14) return 'B';
  if (n >= 7)  return 'C';
  if (n >= 3)  return 'D';
  return 'E';
}

app.get('/party', async (req, res) => {
  try {
    const uid = await usuarioDe(req);
    if (!uid) return res.status(401).json({ error: 'No autorizado' });

    const { rows: p } = await db(
      `SELECT p.* FROM parties p
         JOIN party_miembros m ON m.party_id = p.id
        WHERE m.usuario_id = $1 LIMIT 1`, [uid]
    );
    if (!p.length) return res.json({ party: null });

    const { rows: miembros } = await db(
      `SELECT u.id, u.nombre FROM party_miembros m
         JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.party_id = $1 ORDER BY m.entro_el`, [p[0].id]
    );

    const conRacha = [];
    for (const m of miembros) {
      const racha = await rachaDe(m.id);
      conRacha.push({ ...m, racha, rango: rangoDeRacha(racha), yo: m.id === uid });
    }

    // El aura del grupo es la del eslabón más débil: se sostiene entre todos.
    const rachaGrupo = conRacha.length ? Math.min(...conRacha.map(m => m.racha)) : 0;
    res.json({
      party: { id: p[0].id, nombre: p[0].nombre, codigo: p[0].codigo },
      miembros: conRacha,
      racha_grupo: rachaGrupo,
      rango_grupo: rangoDeRacha(rachaGrupo)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/party', async (req, res) => {
  try {
    const uid = await usuarioDe(req);
    if (!uid) return res.status(401).json({ error: 'No autorizado' });
    const nombre = String(req.body?.nombre || '').trim().slice(0, 80);
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });

    const codigo = crypto.randomBytes(4).toString('hex').toUpperCase();
    const { rows } = await db(
      'INSERT INTO parties (nombre, codigo, creada_por) VALUES ($1,$2,$3) RETURNING *',
      [nombre, codigo, uid]
    );
    await db('INSERT INTO party_miembros (party_id, usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
             [rows[0].id, uid]);
    res.json({ party: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/party/unirse', async (req, res) => {
  try {
    const uid = await usuarioDe(req);
    if (!uid) return res.status(401).json({ error: 'No autorizado' });
    const codigo = String(req.body?.codigo || '').trim().toUpperCase();

    const { rows } = await db('SELECT id FROM parties WHERE codigo=$1', [codigo]);
    if (!rows.length) return res.status(404).json({ error: 'Código no encontrado' });

    // Grupos pequeños a propósito: por encima de 6 deja de sostener y empieza a ser ruido
    const { rows: n } = await db('SELECT COUNT(*)::int AS c FROM party_miembros WHERE party_id=$1', [rows[0].id]);
    if (n[0].c >= 6) return res.status(409).json({ error: 'La party está llena (máx. 6)' });

    await db('INSERT INTO party_miembros (party_id, usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
             [rows[0].id, uid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/party/salir', async (req, res) => {
  try {
    const uid = await usuarioDe(req);
    if (!uid) return res.status(401).json({ error: 'No autorizado' });
    await db('DELETE FROM party_miembros WHERE usuario_id=$1', [uid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// CRUCE DE DATOS — el diferencial del producto
// ════════════════════════════════════════════════════════
// Responde a la pregunta que ninguna app grande responde:
// "¿mi semana floja de nutrición coincide con la semana floja de mis proyectos?"
// Devuelve series alineadas por fecha, normalizadas 0-100 para poder superponerlas.
app.get('/cruce/:dias?', async (req, res) => {
  const dias = Math.min(180, Math.max(7, parseInt(req.params.dias || '30', 10)));
  try {
    const [logsQ, comidasQ, sesQ, proyQ] = await Promise.all([
      db(`SELECT fecha, sueno, energia, nutricion, entreno_completado,
                 tareas_completadas, tareas_total
            FROM daily_logs
           WHERE fecha >= CURRENT_DATE - $1::int ORDER BY fecha`, [dias]),
      db(`SELECT fecha, SUM(calorias) AS kcal, SUM(proteinas) AS prot
            FROM comidas WHERE fecha >= CURRENT_DATE - $1::int
           GROUP BY fecha ORDER BY fecha`, [dias]).catch(() => ({ rows: [] })),
      db(`SELECT fecha, COUNT(*) AS n FROM sesiones_gym
           WHERE fecha >= CURRENT_DATE - $1::int AND completada
           GROUP BY fecha ORDER BY fecha`, [dias]).catch(() => ({ rows: [] })),
      db(`SELECT AVG(progreso)::numeric(5,1) AS medio FROM proyectos WHERE progreso < 100`)
        .catch(() => ({ rows: [{ medio: null }] }))
    ]);

    const iso  = d => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
    const byDate = (rows, fn) => {
      const m = {};
      for (const r of rows) m[iso(r.fecha)] = fn(r);
      return m;
    };

    const mLog     = byDate(logsQ.rows,    r => r);
    const mComidas = byDate(comidasQ.rows, r => ({ kcal: +r.kcal || 0, prot: +r.prot || 0 }));
    const mSes     = byDate(sesQ.rows,     r => +r.n || 0);

    // Eje de fechas completo: los días sin registro deben verse como huecos, no desaparecer
    const serie = [];
    const hoy = new Date(hoyStr() + 'T12:00:00Z');
    for (let i = dias - 1; i >= 0; i--) {
      const d = new Date(hoy); d.setUTCDate(d.getUTCDate() - i);
      const k = iso(d);
      const l = mLog[k] || {};
      const c = mComidas[k] || { kcal: 0, prot: 0 };
      const tareasPct = l.tareas_total > 0
        ? Math.round((l.tareas_completadas / l.tareas_total) * 100) : null;

      serie.push({
        fecha:     k,
        sueno:     l.sueno != null ? +l.sueno : null,
        energia:   l.energia != null ? +l.energia : null,
        nutricion: l.nutricion != null ? +l.nutricion : null,
        kcal:      c.kcal || null,
        entreno:   (l.entreno_completado || mSes[k] > 0) ? 1 : 0,
        tareas:    tareasPct,
        registrado: !!(l.sueno || l.entreno_completado || l.nutricion || c.kcal || mSes[k])
      });
    }

    // Correlación de Pearson entre dos series, ignorando huecos.
    // Con menos de 7 pares comunes no se devuelve: el ruido supera a la señal.
    const corr = (a, b) => {
      const pares = serie
        .map(d => [d[a], d[b]])
        .filter(([x, y]) => x != null && y != null);
      const n = pares.length;
      if (n < 7) return null;
      const mx = pares.reduce((s, p) => s + p[0], 0) / n;
      const my = pares.reduce((s, p) => s + p[1], 0) / n;
      let num = 0, dx = 0, dy = 0;
      for (const [x, y] of pares) {
        num += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2;
      }
      if (dx === 0 || dy === 0) return null;
      return +(num / Math.sqrt(dx * dy)).toFixed(2);
    };

    res.json({
      dias,
      serie,
      dias_registrados: serie.filter(d => d.registrado).length,
      correlaciones: {
        sueno_energia:   corr('sueno', 'energia'),
        sueno_tareas:    corr('sueno', 'tareas'),
        energia_tareas:  corr('energia', 'tareas'),
        nutricion_energia: corr('nutricion', 'energia')
      },
      progreso_proyectos_medio: proyQ.rows[0]?.medio != null ? +proyQ.rows[0].medio : null
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// FRONTERA DE PROCEDENCIA — Strava nunca entra en la IA
// ════════════════════════════════════════════════════════
// El acuerdo de API de Strava prohíbe expresamente usar datos obtenidos por su
// API "en modelos de inteligencia artificial o aplicaciones similares".
// La regla de esta casa: el dato nativo de OKIRO puede alimentar al Coach IA;
// el dato importado de Strava, jamás. La frontera no es la pantalla, es el origen.
//
// Un campo es apto para la IA si su procedencia es 'manual' u 'okiro'.
const ORIGENES_APTOS_IA = new Set(['manual', 'okiro', 'notion']);

function aptoParaIA(origen) {
  return ORIGENES_APTOS_IA.has(origen || 'manual');
}

// Devuelve el valor solo si su origen lo permite; si no, marca por qué se omite.
function campoIA(valor, origen, sufijo = '') {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (!aptoParaIA(origen)) return '[omitido: origen externo]';
  return `${valor}${sufijo}`;
}

// ¿De dónde viene el sueño de este día? Misma cascada que /resumen.
async function origenSueno(fecha) {
  const { rows } = await db(
    'SELECT sueno FROM daily_logs WHERE fecha=$1 AND sueno > 0', [fecha]
  ).catch(() => ({ rows: [] }));
  if (rows.length) return 'manual';
  const { rows: s } = await db(
    `SELECT 1 FROM strava_activities WHERE tipo ILIKE 'Sleep' AND fecha::date = $1 LIMIT 1`,
    [fecha]
  ).catch(() => ({ rows: [] }));
  return s.length ? 'strava' : 'none';
}

// ¿El entreno del día lo registraste tú en OKIRO, o llegó por webhook de Strava?
async function origenEntreno(fecha) {
  const { rows } = await db(
    'SELECT 1 FROM sesiones_gym WHERE fecha=$1 LIMIT 1', [fecha]
  ).catch(() => ({ rows: [] }));
  if (rows.length) return 'okiro';
  const { rows: s } = await db(
    `SELECT 1 FROM strava_activities WHERE tipo NOT ILIKE 'Sleep' AND fecha::date = $1 LIMIT 1`,
    [fecha]
  ).catch(() => ({ rows: [] }));
  return s.length ? 'strava' : 'none';
}

// ════════════════════════════════════════════════════════
// IA — RESÚMENES (generados en el servidor, sin key del usuario)
// ════════════════════════════════════════════════════════
async function buildPromptDaily() {
  const fecha = hoyStr();
  const [logsQ, comidasQ] = await Promise.all([
    db('SELECT * FROM daily_logs ORDER BY fecha DESC LIMIT 30'),
    db('SELECT * FROM comidas WHERE fecha=$1', [fecha])
  ]);
  const logs = logsQ.rows;
  const logHoy = logs.find(l => l.fecha && l.fecha.toISOString?.().startsWith(fecha)) ||
                 logs.find(l => String(l.fecha).startsWith(fecha)) || {};
  const tot = comidasQ.rows.reduce(
    (a, c) => ({ calorias: a.calorias + (c.calorias || 0), proteinas: a.proteinas + +(c.proteinas || 0), carbos: a.carbos + +(c.carbos || 0), grasas: a.grasas + +(c.grasas || 0) }),
    { calorias: 0, proteinas: 0, carbos: 0, grasas: 0 }
  );
  // Frontera de procedencia: lo que venga de Strava no llega al modelo
  const [oSueno, oEntreno] = await Promise.all([origenSueno(fecha), origenEntreno(fecha)]);
  const entrenoTxt = logHoy.entreno_completado ? `sí (${logHoy.tipo_entreno || 'sin tipo'})` : 'no';

  return `Eres el sistema OKIRO ("levántate"). Hablas en imperativo, corto y sin adornos.
Constatas, no consuelas ni celebras de más. Cero emojis, cero exclamaciones.
Atleta: ${APP_USER_NAME}. Híbrido gym + running + emprendedor.

Si un campo aparece como [omitido: origen externo], NO lo menciones ni especules
sobre él: no está disponible para este análisis. Trabaja solo con lo que ves.

LOG DE HOY:
- Sueño: ${campoIA(logHoy.sueno, oSueno, 'h')} | Energía: ${logHoy.energia || '—'}/10
- Entrenamiento: ${campoIA(entrenoTxt, oEntreno)}
- Nutrición: ${logHoy.nutricion || '—'}/10
- Tareas: ${logHoy.tareas_completadas ?? '—'}/${logHoy.tareas_total ?? 5}
- Notas: ${logHoy.notas || 'ninguna'}

MACROS HOY:
- Calorías: ${tot.calorias} / 2400 kcal objetivo
- Proteínas: ${tot.proteinas}g / 180g objetivo
- Carbos: ${tot.carbos}g / 300g objetivo
- Grasas: ${tot.grasas}g / 70g objetivo

Da un análisis breve (máx 150 palabras) con:
1. Estado del día en una línea
2. Punto fuerte
3. Punto a mejorar mañana
4. Puntuación del día X/10
Responde en español. Sin emojis. Frases cortas, de sistema, no de coach.`;
}

async function buildPromptWeekly() {
  // Frontera de procedencia: este prompt solo lee daily_logs y sesiones_gym, que son
  // nativas de OKIRO. strava_activities NO se consulta aquí y no debe consultarse:
  // meter datos de Strava en el modelo incumpliría su acuerdo de API.
  const [logsQ, sesQ] = await Promise.all([
    db('SELECT * FROM daily_logs ORDER BY fecha DESC LIMIT 7'),
    db('SELECT s.*, r.nombre AS rutina_nombre FROM sesiones_gym s LEFT JOIN rutinas r ON r.id=s.rutina_id ORDER BY s.fecha DESC LIMIT 7')
  ]);
  const logs = logsQ.rows;
  const diasEntreno = logs.filter(l => l.entreno_completado).length;
  const media = (fn) => logs.length ? (logs.reduce((s, l) => s + (parseFloat(fn(l)) || 0), 0) / logs.length).toFixed(1) : '—';
  const totalTareas = logs.reduce((s, l) => s + (parseInt(l.tareas_completadas) || 0), 0);
  const tipos = [...new Set(logs.filter(l => l.entreno_completado && l.tipo_entreno).map(l => l.tipo_entreno))].join(', ') || 'ninguno';
  return `Eres el sistema OKIRO ("levántate"). Hablas en imperativo, corto y sin adornos.
Constatas, no consuelas ni celebras de más. Cero emojis, cero exclamaciones.
Atleta: ${APP_USER_NAME}. Híbrido gym + running + emprendedor.

RESUMEN SEMANAL (últimos 7 días):
- Días con entrenamiento: ${diasEntreno}/7
- Media de sueño: ${media(l => l.sueno)}h
- Media de energía: ${media(l => l.energia)}/10
- Media de nutrición: ${media(l => l.nutricion)}/10
- Tareas completadas total: ${totalTareas}
- Tipos de entreno: ${tipos}
- Sesiones gym registradas: ${sesQ.rows.length}

Da un análisis semanal (máx 200 palabras) con:
1. Tendencia general
2. Mejor día y por qué
3. Patrón a corregir
4. Objetivo concreto para la próxima semana
5. Rango de la semana: E/D/C/B/A/S con justificación
Responde en español. Sin emojis. Frases cortas, de sistema, no de coach.`;
}

app.post('/ia/resumen', async (req, res) => {
  const tipo = req.body?.tipo === 'weekly' ? 'weekly' : 'daily';
  try {
    const prompt = tipo === 'weekly' ? await buildPromptWeekly() : await buildPromptDaily();
    const texto = await claude(prompt, 1024);
    res.json({ texto, modelo: AI_MODEL });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// RESUMEN DEL DÍA (dashboard de solo lectura)
// ════════════════════════════════════════════════════════
app.get('/resumen/:fecha', async (req, res) => {
  const fecha = req.params.fecha; // "YYYY-MM-DD"
  try {
    // ── 1. Sueño ────────────────────────────────────────
    const { rows: logRows } = await db(
      'SELECT sueno, notas FROM daily_logs WHERE fecha = $1', [fecha]
    );
    const logHoy = logRows[0] || null;
    let sueno_horas = null;
    let sueno_fuente = 'none';
    const nota = logHoy?.notas || '';

    if (logHoy?.sueno && parseFloat(logHoy.sueno) > 0) {
      sueno_horas = parseFloat(logHoy.sueno);
      sueno_fuente = 'manual';
    } else {
      // Intenta Strava (tipo Sleep) para esa fecha
      const { rows: stravaS } = await db(
        `SELECT datos_raw FROM strava_activities
         WHERE tipo ILIKE 'Sleep' AND fecha::date = $1 LIMIT 1`, [fecha]
      ).catch(() => ({ rows: [] }));
      if (stravaS.length) {
        const raw = stravaS[0].datos_raw || {};
        sueno_horas = raw.moving_time ? +(raw.moving_time / 3600).toFixed(1) : null;
        if (sueno_horas) sueno_fuente = 'strava';
      }
      // Fallback: último daily_log con sueño
      if (!sueno_horas) {
        const { rows: last } = await db(
          'SELECT sueno FROM daily_logs WHERE sueno > 0 ORDER BY fecha DESC LIMIT 1'
        ).catch(() => ({ rows: [] }));
        if (last.length) { sueno_horas = parseFloat(last[0].sueno); sueno_fuente = 'manual'; }
      }
    }

    // ── 2. Nutrición ─────────────────────────────────────
    const { rows: comidas } = await db(
      'SELECT calorias, proteinas FROM comidas WHERE fecha = $1', [fecha]
    ).catch(() => ({ rows: [] }));
    const calorias_consumidas = Math.round(comidas.reduce((s, c) => s + (c.calorias || 0), 0));
    const proteinas_consumidas = Math.round(comidas.reduce((s, c) => s + parseFloat(c.proteinas || 0), 0));
    const calorias_objetivo  = 2200;
    const proteinas_objetivo = 160;

    // ── 3. Sesión gym ────────────────────────────────────
    const { rows: sesRows } = await db(
      `SELECT s.completada FROM sesiones_gym s WHERE s.fecha = $1`, [fecha]
    ).catch(() => ({ rows: [] }));
    const sesion_gym_hoy = sesRows.length > 0 && !!sesRows[0].completada;

    // ── 4. Rutina planificada ────────────────────────────
    // Noon UTC para evitar problemas de timezone en el getDay()
    const dDate = new Date(fecha + 'T12:00:00Z');
    const diaLabel = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][dDate.getUTCDay()];
    const { rows: rutinas } = await db('SELECT nombre, dias FROM rutinas').catch(() => ({ rows: [] }));
    const rutinaHoy = rutinas.find(r => {
      const dias = Array.isArray(r.dias) ? r.dias : (typeof r.dias === 'string' ? JSON.parse(r.dias) : []);
      return dias.map(d => String(d).toLowerCase()).includes(diaLabel);
    });
    const rutina_hoy = rutinaHoy ? rutinaHoy.nombre : 'Descanso';

    // ── 5. Strava actividad (no sleep) ───────────────────
    const { rows: stravaA } = await db(
      `SELECT id FROM strava_activities
       WHERE tipo NOT ILIKE 'Sleep' AND fecha::date = $1 LIMIT 1`, [fecha]
    ).catch(() => ({ rows: [] }));
    const strava_actividad_hoy = stravaA.length > 0;

    // ── 6. Proyectos activos ─────────────────────────────
    const { rows: proyectos } = await db(
      'SELECT nombre, progreso FROM proyectos WHERE progreso < 100 ORDER BY progreso ASC'
    ).catch(() => ({ rows: [] }));
    const proyectos_activos    = proyectos.length;
    const proyecto_prioritario = proyectos[0]?.nombre || null;

    // ── 7. Score de energía ──────────────────────────────
    const sueno_score = Math.min(1, (sueno_horas || 0) / 8) * 40;
    const nutri_ratio = calorias_objetivo > 0 ? Math.min(1, calorias_consumidas / calorias_objetivo) : 0;
    const nutri_score = nutri_ratio * 35;
    const act_score   = (sesion_gym_hoy || strava_actividad_hoy) ? 25 : 0;
    const energia_score = Math.round(sueno_score + nutri_score + act_score);

    res.json({
      fecha,
      sueno_horas,
      sueno_fuente,
      calorias_consumidas,
      calorias_objetivo,
      proteinas_consumidas,
      proteinas_objetivo,
      sesion_gym_hoy,
      rutina_hoy,
      strava_actividad_hoy,
      energia_score,
      nota,
      proyectos_activos,
      proyecto_prioritario
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /logs/:fecha/nota — actualiza solo la nota del día
app.patch('/logs/:fecha/nota', async (req, res) => {
  const { notas } = req.body;
  const fecha = req.params.fecha;
  try {
    await db(
      `INSERT INTO daily_logs (fecha, notas) VALUES ($1,$2)
       ON CONFLICT (fecha) DO UPDATE SET notas=$2`,
      [fecha, notas ?? '']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Fallback SPA: cualquier GET no-API sirve el index ────
app.listen(PORT, () => {
  console.log(`OKIRO Backend v4.1 · :${PORT}`);
  console.log(`· Auth:  ${APP_TOKEN ? 'ACTIVADA (APP_TOKEN)' : 'DESACTIVADA — define APP_TOKEN en producción'}`);
  if (APP_TOKEN && APP_TOKEN.length < 24) {
    console.warn(`· ⚠ CLAVE DÉBIL: ${APP_TOKEN.length} caracteres. Detrás de esta clave están tu base de datos`);
    console.warn(`  y tu clave de Anthropic. Rótala:  openssl rand -base64 32 > ${SECRETS_DIR}/app_token`);
  }
  console.log(`· IA:    ${ANTHROPIC_KEY ? `activa · modelo ${AI_MODEL} · límite ${AI_DAILY_LIMIT}/día` : 'sin ANTHROPIC_API_KEY'}`);
  console.log(`· Push:  ${PUSH_READY ? 'activo' : 'sin claves VAPID — genera con: npx web-push generate-vapid-keys'}`);
});
