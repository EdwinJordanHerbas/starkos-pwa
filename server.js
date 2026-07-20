// OkiroSport Backend v3 — producción
// Requiere Node 18+ (usa fetch global)
const express = require('express');
const { Pool } = require('pg');
const app = express();

// ════════════════════════════════════════════════════════
// CONFIG (variables de entorno)
// ════════════════════════════════════════════════════════
const PORT           = parseInt(process.env.PORT || '3000', 10);
const APP_TOKEN      = process.env.APP_TOKEN || '';                 // clave de acceso única (mono-usuario)
const APP_USER_NAME  = process.env.APP_USER_NAME || 'Stark';
const AI_MODEL       = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
const AI_DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '40', 10);
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;

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
  /^\/strava\/(webhook|callback|auth)$/   // Strava llama sin cabeceras propias
];
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
  const today = new Date().toISOString().split('T')[0];
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

// Extrae el primer objeto JSON de un texto (tolera ```json ... ```)
function parseJSONLoose(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

const hoyStr = () => new Date().toISOString().split('T')[0];

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
    const { rows } = await db('SELECT * FROM daily_logs ORDER BY fecha DESC LIMIT 30');
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
  const entreno = logHoy.entreno_completado ? `sí (${logHoy.tipo_entreno || 'sin tipo'})` : 'no';
  return `Eres el sistema de análisis de rendimiento de OkiroSport.
Atleta: ${APP_USER_NAME}. Híbrido gym + running + emprendedor.

LOG DE HOY:
- Sueño: ${logHoy.sueno || '—'}h | Energía: ${logHoy.energia || '—'}/10
- Entrenamiento: ${entreno}
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
Responde en español, tono directo de sistema RPG.`;
}

async function buildPromptWeekly() {
  const [logsQ, sesQ] = await Promise.all([
    db('SELECT * FROM daily_logs ORDER BY fecha DESC LIMIT 7'),
    db('SELECT s.*, r.nombre AS rutina_nombre FROM sesiones_gym s LEFT JOIN rutinas r ON r.id=s.rutina_id ORDER BY s.fecha DESC LIMIT 7')
  ]);
  const logs = logsQ.rows;
  const diasEntreno = logs.filter(l => l.entreno_completado).length;
  const media = (fn) => logs.length ? (logs.reduce((s, l) => s + (parseFloat(fn(l)) || 0), 0) / logs.length).toFixed(1) : '—';
  const totalTareas = logs.reduce((s, l) => s + (parseInt(l.tareas_completadas) || 0), 0);
  const tipos = [...new Set(logs.filter(l => l.entreno_completado && l.tipo_entreno).map(l => l.tipo_entreno))].join(', ') || 'ninguno';
  return `Eres el sistema de análisis de rendimiento de OkiroSport.
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
5. Rango de la semana: D/C/B/A/S con justificación
Responde en español, tono directo de sistema RPG.`;
}

app.post('/ia/resumen', async (req, res) => {
  const tipo = req.body?.tipo === 'weekly' ? 'weekly' : 'daily';
  try {
    const prompt = tipo === 'weekly' ? await buildPromptWeekly() : await buildPromptDaily();
    const texto = await claude(prompt, 1024);
    res.json({ texto, modelo: AI_MODEL });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ── Fallback SPA: cualquier GET no-API sirve el index ────
app.listen(PORT, () => {
  console.log(`OkiroSport Backend v3.0 · :${PORT}`);
  console.log(`· Auth:  ${APP_TOKEN ? 'ACTIVADA (APP_TOKEN)' : 'DESACTIVADA — define APP_TOKEN en producción'}`);
  console.log(`· IA:    ${ANTHROPIC_KEY ? `activa · modelo ${AI_MODEL} · límite ${AI_DAILY_LIMIT}/día` : 'sin ANTHROPIC_API_KEY'}`);
});
