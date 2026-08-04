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
  /^\/push\/tick$/,                       // lo dispara el cron del host, ver nota abajo
  /^\/ejercicios\/media\//                // GIFs de técnica: un <img> no manda cabeceras
];
// Por qué /ejercicios/media es público: sirve las animaciones de un dataset
// público de ejercicios, las mismas para todo el mundo. No lee ni escribe nada
// del usuario. Tiene que serlo porque un <img src> no puede mandar el Bearer.
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

    // El aviso deja de ser un texto fijo: dice qué te espera y, al cerrar,
    // cómo ha quedado. Si la misión falla, el push sigue saliendo.
    let titulo = 'OKIRO';
    let cuerpo = tipo === 'cierre' ? 'El aura no ha salido hoy.' : 'Misión diaria disponible.';
    try {
      const m = await misionDelDia(hoy);
      if (tipo === 'cierre') {
        // Rechazarla cuenta como fallarla: decidir que no, no evita el coste.
        const cumplida = m.completa && m.estado !== 'rechazada';
        await db(
          `UPDATE misiones SET resultado=$1, xp_bonus=$2, cerrada_en=NOW()
            WHERE fecha=$3 AND resultado IS NULL`,
          [cumplida ? 'cumplida' : 'fallada',
           cumplida ? XP_MISION_CUMPLIDA : XP_MISION_FALLADA, hoy]);
        const p = await calcularProgreso();
        titulo = cumplida ? 'MISIÓN CUMPLIDA' : 'MISIÓN FALLADA';
        // Al fallar, el aviso no se queda en el castigo: recuerda lo que lleva
        // hecho. Un push que solo regaña es un push que se desactiva.
        const aliento = await mensajeDeAliento(m, hoy);
        cuerpo = cumplida
          ? `${m.total} de ${m.total} · +${XP_MISION_CUMPLIDA} XP · rango ${p.rango}. ${aliento}`
          : `${m.cumplidos} de ${m.total} · ${XP_MISION_FALLADA} XP. ${aliento}`;
        if (cuerpo.length > 200) cuerpo = cuerpo.slice(0, 197) + '...';
      } else if (m.total) {
        const pend = m.objetivos.filter(o => !o.cumplido);
        cuerpo = pend.length
          ? `${pend.length} objetivo${pend.length !== 1 ? 's' : ''}: ${pend.map(o => o.texto).join(' · ')}`
          : 'Misión ya completa. Buen día.';
      }
    } catch (e) { console.error('misión en el push:', e.message); }

    const r = await enviarATodos(titulo, cuerpo);
    res.json({ ok: true, accion: tipo, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// MISIÓN DIARIA
// ════════════════════════════════════════════════════════
// El modal enseñaba la rutina de gym y tenía dos botones que llamaban a la
// misma función, así que daba igual aceptar o saltar. Una misión de verdad
// cubre todos los ámbitos, se acepta o se rechaza —y queda registrado—, y
// sus objetivos se cumplen SOLOS al vivir el día: no hay nada que marcar.
//
// El cumplimiento no se guarda, se evalúa en vivo contra los datos reales.
// Así no hay dos verdades que sincronizar: si entrenaste, está entrenado.

// Objetivos del día a partir de lo que hay. Solo entra lo que tiene sentido
// hoy: sin rutina no se pide entreno, sin repasos no se pide inglés.
async function objetivosDelDia(fecha, recuperacion = false) {
  const objetivos = [];

  // 1. Entreno — solo si hoy toca rutina
  const dDate = new Date(fecha + 'T12:00:00Z');
  const diaLabel = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][dDate.getUTCDay()];
  const { rows: rutinas } = await db('SELECT nombre, dias FROM rutinas').catch(() => ({ rows: [] }));
  const rutinaHoy = rutinas.find(r => {
    const dias = Array.isArray(r.dias) ? r.dias : (typeof r.dias === 'string' ? JSON.parse(r.dias) : []);
    return dias.map(d => String(d).toLowerCase()).includes(diaLabel);
  });
  if (rutinaHoy) {
    objetivos.push({ clave: 'entreno', texto: `Completar la rutina ${rutinaHoy.nombre}`, meta: 1 });
  }

  // 2. Proteína — la que él haya fijado como objetivo, no una cifra de ejemplo.
  // La misión pedía 160 g fijos aunque en NUTRICIÓN tuviera puesto otro número.
  const objProt = (await objetivosDe()).proteinas;
  objetivos.push({ clave: 'proteina', texto: `Llegar a ${objProt} g de proteína`, meta: objProt });

  // 3. Descanso — registrar el sueño es lo que sostiene todo el cruce
  objetivos.push({ clave: 'sueno', texto: 'Registrar el sueño de la noche', meta: 1 });

  // 4. Proyectos — cerrar un hito del que más lo necesita
  const { rows: proyRows } = await db('SELECT * FROM proyectos').catch(() => ({ rows: [] }));
  const hojas = decorarProyectos(aplicarFuentes(proyRows, await valoresAutomaticos()), await contarTareas())
    .filter(p => !p.es_padre && p.progreso_real < 100 && p.tareas_total > p.tareas_hechas)
    .sort((a, b) => a.progreso_real - b.progreso_real);
  if (hojas.length) {
    // En recuperación se pide el doble: la penalización es más esfuerzo, no
    // menos, como la zona de penalización del anime.
    const n = recuperacion ? 2 : 1;
    objetivos.push({
      clave: 'hito',
      texto: n === 1 ? `Cerrar un hito de ${hojas[0].nombre}` : `Cerrar ${n} hitos`,
      meta:  n
    });
  }

  // 5. Idioma — solo si de verdad hay repasos esperando
  const ing = await valoresIngles();
  if (ing.ingles_repasos_hoy > 0) {
    const base = Math.min(20, ing.ingles_repasos_hoy);
    const cuantas = recuperacion ? Math.min(ing.ingles_repasos_hoy, base * 2) : base;
    objetivos.push({ clave: 'ingles', texto: `Repasar ${cuantas} palabras de inglés`, meta: cuantas });
  }

  return objetivos.map((o, i) => ({ ...o, orden: i }));
}

// Fecha del día anterior en formato ISO, sin arrastrar la zona horaria.
function ayerDe(fecha) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Cuánto llevas de cada objetivo, leído de los datos de verdad.
async function progresoObjetivos(fecha, objetivos) {
  const val = {};

  if (objetivos.some(o => o.clave === 'entreno')) {
    const { rows } = await db('SELECT completada FROM sesiones_gym WHERE fecha=$1', [fecha])
      .catch(() => ({ rows: [] }));
    val.entreno = rows.some(r => r.completada) ? 1 : 0;
  }
  if (objetivos.some(o => o.clave === 'proteina')) {
    const { rows } = await db('SELECT proteinas FROM comidas WHERE fecha=$1', [fecha])
      .catch(() => ({ rows: [] }));
    val.proteina = Math.round(rows.reduce((s, c) => s + parseFloat(c.proteinas || 0), 0));
  }
  if (objetivos.some(o => o.clave === 'sueno')) {
    const { rows } = await db('SELECT sueno FROM daily_logs WHERE fecha=$1', [fecha])
      .catch(() => ({ rows: [] }));
    val.sueno = rows.length && parseFloat(rows[0].sueno) > 0 ? 1 : 0;
  }
  if (objetivos.some(o => o.clave === 'hito')) {
    const { rows } = await db(
      'SELECT count(*) AS n FROM proyecto_tareas WHERE hecha AND completada_en = $1', [fecha]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    val.hito = Number(rows[0].n);
  }
  if (objetivos.some(o => o.clave === 'ingles') && poolTutor) {
    // `last_review` es la fecha del último repaso de cada palabra: contar las
    // de hoy dice cuántas has trabajado, sin tocar nada en tutoringles.
    const { rows } = await dbTutor(
      'SELECT count(*) AS n FROM user_words WHERE last_review = $1', [fecha]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    val.ingles = Number(rows[0].n);
  }

  return objetivos.map(o => {
    const hecho = val[o.clave] ?? 0;
    return { ...o, hecho, cumplido: hecho >= Number(o.meta || 1) };
  });
}

// La misión del día: se crea la primera vez que se pide y sus objetivos
// quedan fijados, para que no cambien a media tarde bajo tus pies.
async function misionDelDia(fecha) {
  let { rows } = await db('SELECT * FROM misiones WHERE fecha=$1', [fecha]);
  if (!rows.length) {
    // Si ayer se falló, hoy toca misión de recuperación: más exigente.
    const { rows: [previa] } = await db(
      'SELECT resultado FROM misiones WHERE fecha=$1', [ayerDe(fecha)]);
    const recuperacion = previa?.resultado === 'fallada';

    const objetivos = await objetivosDelDia(fecha, recuperacion);
    const { rows: nueva } = await db(
      'INSERT INTO misiones (fecha, recuperacion) VALUES ($1,$2) RETURNING *', [fecha, recuperacion]);
    for (const o of objetivos) {
      await db(
        'INSERT INTO mision_objetivos (mision_id, clave, texto, meta, orden) VALUES ($1,$2,$3,$4,$5)',
        [nueva[0].id, o.clave, o.texto, o.meta, o.orden]);
    }
    rows = nueva;
  }
  const mision = rows[0];

  const { rows: objs } = await db(
    'SELECT clave, texto, meta, orden FROM mision_objetivos WHERE mision_id=$1 ORDER BY orden',
    [mision.id]);
  const objetivos = await progresoObjetivos(fecha, objs);
  const cumplidos = objetivos.filter(o => o.cumplido).length;

  return {
    fecha,
    estado:       mision.estado,
    resultado:    mision.resultado,
    recuperacion: mision.recuperacion,
    xp_bonus:     mision.xp_bonus,
    objetivos,
    cumplidos,
    total:     objetivos.length,
    completa:  objetivos.length > 0 && cumplidos === objetivos.length
  };
}

// ── PROGRESO: XP, nivel, rango y racha ───────────────────
// Vivían en localStorage, así que se perdían al cambiar de móvil y el cron no
// podía penalizar nada. Ahora los calcula el backend desde los datos.
const XP_MISION_CUMPLIDA = 50;
const XP_MISION_FALLADA  = -25;

// Mismos puntos que enseñaba la app, ahora como única fuente de verdad.
function xpDelDia(l) {
  let xp = 0;
  if (l.entreno_completado) xp += 40;
  const s = parseFloat(l.sueno) || 0;
  if (s >= 7) xp += 15; else if (s > 0) xp += 5;
  xp += (parseInt(l.energia)   || 0);
  xp += (parseInt(l.nutricion) || 0);
  xp += (parseInt(l.tareas_completadas) || 0) * 8;
  if (l.notas && String(l.notas).trim()) xp += 5;
  return xp;
}

function nivelDesdeXP(xp) {
  let nivel = 1, resto = Math.max(0, xp), necesita = 80;
  while (resto >= necesita) { resto -= necesita; nivel++; necesita = 80 + (nivel - 1) * 40; }
  return { nivel, resto, necesita };
}

// El rango sale de la racha, no del nivel: es lo que ya hacía la app y lo que
// hace que romper la constancia se note de verdad.
const UMBRAL_RANGO = [['E', 0], ['D', 3], ['C', 7], ['B', 14], ['A', 30], ['S', 60]];

function rangoDesdeRacha(n) {
  let r = 'E';
  for (const [letra, dias] of UMBRAL_RANGO) if (n >= dias) r = letra;
  return r;
}

// Qué falta para el siguiente rango: sin esto ves una "E" y no sabes si estás
// cerca o lejos de la D.
function siguienteRango(racha) {
  const sig = UMBRAL_RANGO.find(([, dias]) => dias > racha);
  return sig ? { rango: sig[0], dias: sig[1] - racha } : null;
}

// De dónde sale el XP de un día. Se devuelve desglosado porque hoy nadie sabe
// que un entreno son 40 puntos y la nota del día 5.
function desgloseXP(l) {
  if (!l) return [];
  const d = [];
  if (l.entreno_completado) d.push({ que: 'Entreno completado', xp: 40 });
  const s = parseFloat(l.sueno) || 0;
  if (s >= 7)     d.push({ que: `Sueño ${s} h`, xp: 15 });
  else if (s > 0) d.push({ que: `Sueño ${s} h`, xp: 5 });
  const e = parseInt(l.energia)   || 0; if (e) d.push({ que: 'Energía',   xp: e });
  const n = parseInt(l.nutricion) || 0; if (n) d.push({ que: 'Nutrición', xp: n });
  const t = parseInt(l.tareas_completadas) || 0;
  if (t) d.push({ que: `${t} hito${t !== 1 ? 's' : ''} cerrado${t !== 1 ? 's' : ''}`, xp: t * 8 });
  if (l.notas && String(l.notas).trim()) d.push({ que: 'Nota del día', xp: 5 });
  return d;
}

// Cierra las misiones de días pasados que quedaron sin resultado. No depende
// del push: si el móvil estaba apagado o el cron falló, se sella igual la
// próxima vez que se mire el progreso.
async function cerrarMisionesPendientes() {
  const { rows } = await db(
    `SELECT fecha FROM misiones
      WHERE resultado IS NULL AND fecha < $1 ORDER BY fecha`, [hoyStr()]);
  for (const r of rows) {
    const fecha = new Date(r.fecha).toISOString().slice(0, 10);
    try {
      const m = await misionDelDia(fecha);
      // Rechazarla cuenta como fallarla: la decisión no evita la consecuencia.
      const cumplida = m.completa && m.estado !== 'rechazada';
      await db(
        `UPDATE misiones SET resultado=$1, xp_bonus=$2, cerrada_en=NOW()
          WHERE fecha=$3 AND resultado IS NULL`,
        [cumplida ? 'cumplida' : 'fallada',
         cumplida ? XP_MISION_CUMPLIDA : XP_MISION_FALLADA, fecha]);
    } catch (e) { console.error('cierre de misión', fecha, e.message); }
  }
}

// Días consecutivos con registro, contando desde hoy o desde ayer (a media
// mañana todavía no hay registro de hoy y la racha no debe romperse por eso).
function rachaDeRegistros(fechas) {
  const dias = new Set(fechas.map(f => new Date(f).toISOString().slice(0, 10)));
  const d = new Date(hoyStr() + 'T12:00:00Z');
  const iso = () => d.toISOString().slice(0, 10);
  if (!dias.has(iso())) d.setUTCDate(d.getUTCDate() - 1);
  let racha = 0;
  while (dias.has(iso())) { racha++; d.setUTCDate(d.getUTCDate() - 1); }
  return racha;
}

async function calcularProgreso() {
  await cerrarMisionesPendientes();

  const { rows: logs } = await db(
    'SELECT fecha, sueno, energia, nutricion, entreno_completado, tareas_completadas, notas FROM daily_logs'
  ).catch(() => ({ rows: [] }));

  const xpLogs = logs.reduce((a, l) => a + xpDelDia(l), 0);
  const { rows: [mis] } = await db(
    `SELECT COALESCE(SUM(xp_bonus), 0)                AS xp,
            count(*) FILTER (WHERE resultado = 'fallada')  AS falladas,
            count(*) FILTER (WHERE resultado = 'cumplida') AS cumplidas
       FROM misiones`).catch(() => ({ rows: [{ xp: 0, falladas: 0, cumplidas: 0 }] }));

  // El XP puede bajar: si no, fallar la misión no costaría nada.
  const xp    = Math.max(0, xpLogs + Number(mis.xp));
  const racha = rachaDeRegistros(logs.map(l => l.fecha));
  const rango = rangoDesdeRacha(racha);
  const { nivel, resto, necesita } = nivelDesdeXP(xp);

  const { rows: [prev] } = await db('SELECT * FROM progreso WHERE usuario_id=1');
  const mejor = Math.max(racha, prev?.mejor_racha || 0);

  await db(
    `UPDATE progreso SET xp=$1, nivel=$2, rango=$3, racha=$4, mejor_racha=$5,
            penalizaciones=$6, actualizado=NOW() WHERE usuario_id=1`,
    [xp, nivel, rango, racha, mejor, Number(mis.falladas)]);

  const hoyLog = logs.find(l => String(l.fecha).slice(0, 10) === hoyStr());

  return {
    xp, nivel, rango, racha,
    mejor_racha: mejor,
    xp_en_nivel: resto,
    xp_para_subir: necesita,
    penalizaciones: Number(mis.falladas),
    // Lo devuelve para que la app sepa si hoy arrastra castigo.
    rango_anterior: prev?.rango || 'E',
    // Para la ventana de estado
    siguiente: siguienteRango(racha),
    misiones_cumplidas: Number(mis.cumplidas),
    misiones_falladas:  Number(mis.falladas),
    xp_hoy: desgloseXP(hoyLog),
    xp_hoy_total: hoyLog ? xpDelDia(hoyLog) : 0
  };
}

app.get('/progreso', async (req, res) => {
  try {
    res.json(await calcularProgreso());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ALIENTO ──────────────────────────────────────────────
// El sistema es exigente: la penalización se queda. Pero castigar en seco a
// alguien que ya se ha caído no le devuelve al día siguiente. Al fallar, el
// mensaje recuerda POR QUÉ empezó esto y qué lleva hecho — con sus datos
// reales, no con frases de taza. Nada de "¡tú puedes!": el tono es el mismo
// de siempre, sobrio.
const ALIENTO_FALLO = [
  'Caer no rompe el sistema. No volver, sí.',
  'Un día perdido no borra lo construido.',
  'Empezaste esto para volver a tu mejor versión. Sigue ahí.',
  'El sistema no te abandona por un mal día.',
  'Mañana no hay que empezar de cero: hay que seguir.'
];

const ALIENTO_PARCIAL = [
  'No fue completo, pero fue.',
  'Lo que hiciste sigue contando.',
  'Medio camino también es camino.'
];

const ALIENTO_LOGRO = [
  'El aura sube.',
  'Así se gana el rango.',
  'Otro día que el sistema registra.'
];

// Determinista por fecha: la misma frase todo el día, y rota entre días para
// que no se convierta en ruido de fondo.
const fraseDe = (lista, fecha) =>
  lista[parseInt(String(fecha).replace(/-/g, ''), 10) % lista.length];

async function mensajeDeAliento(m, fecha) {
  const partes = [];
  try {
    const { rows: [p] } = await db('SELECT * FROM progreso WHERE usuario_id=1');

    if (m.completa) {
      partes.push(fraseDe(ALIENTO_LOGRO, fecha));
      if (p?.racha > 1) partes.push(`${p.racha} días seguidos.`);
      return partes.join(' ');
    }

    partes.push(m.cumplidos > 0
      ? `${m.cumplidos} de ${m.total}. ${fraseDe(ALIENTO_PARCIAL, fecha)}`
      : fraseDe(ALIENTO_FALLO, fecha));

    // Lo que ya consiguió: la prueba de que es capaz es su propio historial.
    if (p?.mejor_racha >= 3) partes.push(`Tu mejor racha son ${p.mejor_racha} días: ya lo hiciste una vez.`);
    if (p?.xp > 0)           partes.push(`${p.xp} XP siguen ahí.`);

    // Y hacia dónde va: el proyecto con fin declarado más cerca de su meta.
    const { rows } = await db(
      `SELECT nombre, meta, valor_actual, meta_valor, metrica
         FROM proyectos
        WHERE meta_valor > 0 AND valor_actual < meta_valor AND padre_id IS NULL
        ORDER BY (valor_actual / meta_valor) DESC LIMIT 1`).catch(() => ({ rows: [] }));
    if (rows.length) {
      const r = rows[0];
      partes.push(`${r.nombre}: ${(+r.valor_actual)} de ${(+r.meta_valor)} ${r.metrica || ''}. Ahí es donde vas.`);
    }
  } catch (e) { console.error('aliento:', e.message); }
  return partes.join(' ');
}

app.get('/mision/:fecha?', async (req, res) => {
  try {
    const fecha  = req.params.fecha || hoyStr();
    const mision = await misionDelDia(fecha);
    mision.mensaje = await mensajeDeAliento(mision, fecha);
    res.json(mision);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aceptar y rechazar dejan rastro: es la diferencia con los dos botones que
// hacían lo mismo. Rechazar es una decisión válida —un día de descanso lo
// es— y por eso se registra en vez de esconderse.
app.post('/mision/:fecha/:accion', async (req, res) => {
  const estado = { aceptar: 'aceptada', rechazar: 'rechazada' }[req.params.accion];
  if (!estado) return res.status(400).json({ error: 'Acción no válida' });
  try {
    const fecha = req.params.fecha === 'hoy' ? hoyStr() : req.params.fecha;
    await misionDelDia(fecha);   // se asegura de que existe
    // La condición va como booleano ya resuelto: usar $1 a la vez como valor
    // de una columna VARCHAR y dentro de un CASE hace que Postgres deduzca
    // dos tipos para el mismo parámetro y rechace la consulta.
    await db(
      `UPDATE misiones SET estado=$1,
              aceptada_en = CASE WHEN $2 THEN NOW() ELSE aceptada_en END
        WHERE fecha=$3`, [estado, estado === 'aceptada', fecha]);
    res.json(await misionDelDia(fecha));
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
// Un proyecto ya no es solo una barra de progreso: declara su FIN (una meta
// medible) y puede colgar de otro. De ahí salen las dos reglas de progreso:
//   · con meta_valor > 0 → progreso = valor_actual / meta_valor
//   · si tiene hijos     → progreso = media de sus hijos
// El valor manual solo manda cuando no hay ni meta ni hijos, que es como
// quedaron los proyectos creados antes de la v6.
const PROY_EDITABLE = [
  'nombre', 'objetivo', 'meta', 'metrica', 'meta_valor',
  'valor_actual', 'categoria', 'padre_id', 'progreso', 'ultima_accion', 'fuente', 'url'
];

// De dónde sale el número. Una cifra que hay que acordarse de actualizar deja
// de actualizarse: con estas fuentes el proyecto avanza solo al entrenar o al
// registrar el día, sin teclear nada. 'manual' sigue siendo válido para lo que
// OKIRO no puede saber (clientes cerrados, vídeos publicados).
const FUENTES = {
  manual:          { etiqueta: 'A mano',                       unidad: '' },
  racha_registros: { etiqueta: 'Días seguidos registrando',    unidad: 'días seguidos' },
  entrenos_semana: { etiqueta: 'Entrenos de los últimos 7 días', unidad: 'entrenos/semana' },
  volumen_semana:  { etiqueta: 'Kg levantados en 7 días',      unidad: 'kg/semana' },
  masa_muscular:   { etiqueta: 'Masa muscular (última medida)', unidad: 'kg' },
  grasa_pct:       { etiqueta: 'Grasa corporal (última medida)', unidad: '%' },
  peso:            { etiqueta: 'Peso (última medida)',         unidad: 'kg' },
  // Idiomas: los lee de tutoringles, que corre en el mismo Postgres.
  // `empezadas` va primero a propósito: una palabra tarda semanas en llegar a
  // "dominada", así que medir solo eso deja el proyecto a 0% aunque estudies
  // cada día. Empezadas sube en la misma sesión; dominadas es el fin del C1.
  ingles_empezadas:   { etiqueta: 'Inglés · palabras empezadas',    unidad: 'palabras' },
  ingles_palabras:    { etiqueta: 'Inglés · palabras dominadas',    unidad: 'palabras' },
  ingles_situaciones: { etiqueta: 'Inglés · situaciones superadas', unidad: 'situaciones' },
  ingles_racha:       { etiqueta: 'Inglés · días seguidos estudiando', unidad: 'días seguidos' }
};

// tutoringles vive en el mismo servidor de Postgres, en otra base: misma
// máquina y mismas credenciales, solo cambia el nombre. Se lee y nunca se
// escribe — OKIRO no tiene por qué tocar los datos de estudio.
const TUTOR_URL = process.env.TUTORINGLES_URL ||
  (process.env.DATABASE_URL || '').replace(/\/[^/?]+(\?|$)/, '/tutoringles$1');
const poolTutor = TUTOR_URL ? new Pool({ connectionString: TUTOR_URL }) : null;
if (poolTutor) poolTutor.on('error', e => console.error('DB tutoringles:', e.message));
const dbTutor = (q, p) => poolTutor.query(q, p);

// Días consecutivos hasta hoy (o hasta ayer: a media mañana todavía no hay
// registro y la racha no debe romperse por eso).
function rachaDeDias(fechas) {
  if (!fechas.length) return 0;
  const dia = f => Math.floor(new Date(f).getTime() / 86400000);
  const hoy = Math.floor(Date.now() / 86400000);
  let esperado = dia(fechas[0]);
  if (hoy - esperado > 1) return 0;
  let racha = 0;
  for (const f of fechas) {
    if (dia(f) !== esperado) break;
    racha++; esperado--;
  }
  return racha;
}

async function valoresIngles() {
  const v = {};
  if (!poolTutor) return v;
  try {
    const [pal, sit, ses] = await Promise.all([
      dbTutor(`SELECT count(*) FILTER (WHERE status = 'mastered')  AS dominadas,
                      count(*) FILTER (WHERE status <> 'new')      AS empezadas,
                      count(*)                                     AS total,
                      count(*) FILTER (WHERE next_review_date <= CURRENT_DATE) AS repasos
                 FROM user_words`),
      dbTutor('SELECT count(*) AS n FROM situation_progress WHERE completed'),
      dbTutor('SELECT DISTINCT date FROM study_sessions ORDER BY date DESC LIMIT 400')
    ]);
    const w = pal.rows[0];
    v.ingles_palabras    = Number(w.dominadas);
    v.ingles_empezadas   = Number(w.empezadas);
    v.ingles_total       = Number(w.total);
    v.ingles_repasos_hoy = Number(w.repasos);
    v.ingles_situaciones = Number(sit.rows[0].n);
    v.ingles_racha       = rachaDeDias(ses.rows.map(r => r.date));
  } catch (e) {
    // Si tutoringles está caído, sus proyectos se quedan con el último valor
    // guardado en vez de tumbar la pantalla de proyectos entera.
    console.error('valores de inglés:', e.message);
  }
  return v;
}

// Una sola tanda de consultas para todos los proyectos automáticos: son cuatro
// lecturas pequeñas y evitan una consulta por tarjeta.
async function valoresAutomaticos() {
  const v = {};
  try {
    // Racha: días consecutivos con registro, contando desde hoy o desde ayer
    // (a media mañana aún no hay registro de hoy y la racha no debe romperse).
    const { rows: dias } = await db(
      'SELECT DISTINCT fecha FROM daily_logs ORDER BY fecha DESC LIMIT 400');
    let racha = 0;
    if (dias.length) {
      const dia = f => Math.floor(new Date(f).getTime() / 86400000);
      const hoy = Math.floor(Date.now() / 86400000);
      let esperado = dia(dias[0].fecha);
      if (hoy - esperado <= 1) {
        for (const d of dias) {
          if (dia(d.fecha) !== esperado) break;
          racha++; esperado--;
        }
      }
    }
    v.racha_registros = racha;

    const { rows: [e] } = await db(
      `SELECT count(*) AS n FROM sesiones_gym
        WHERE completada = true AND fecha >= CURRENT_DATE - INTERVAL '7 days'`);
    v.entrenos_semana = Number(e.n);

    const { rows: [vol] } = await db(
      `SELECT COALESCE(SUM(sr.peso * sr.reps), 0) AS kg
         FROM series_realizadas sr
         JOIN sesiones_gym s ON s.id = sr.sesion_id
        WHERE sr.completada = true AND s.fecha >= CURRENT_DATE - INTERVAL '7 days'`);
    v.volumen_semana = Math.round(Number(vol.kg));

    // De cada medida se coge el último valor que exista, no el de la última
    // fila: si te pesas sin apuntar la grasa, la grasa anterior sigue valiendo.
    const { rows: [m] } = await db(
      `SELECT
         (SELECT masa_muscular FROM medidas_corporales WHERE masa_muscular IS NOT NULL ORDER BY fecha DESC LIMIT 1) AS masa,
         (SELECT grasa_pct     FROM medidas_corporales WHERE grasa_pct     IS NOT NULL ORDER BY fecha DESC LIMIT 1) AS grasa,
         (SELECT peso          FROM medidas_corporales WHERE peso          IS NOT NULL ORDER BY fecha DESC LIMIT 1) AS peso`);
    if (m.masa  !== null) v.masa_muscular = Number(m.masa);
    if (m.grasa !== null) v.grasa_pct     = Number(m.grasa);
    if (m.peso  !== null) v.peso          = Number(m.peso);
  } catch (e) {
    // Un proyecto automático sin su tabla todavía no debe tumbar la pantalla.
    console.error('valores automáticos:', e.message);
  }
  Object.assign(v, await valoresIngles());
  return v;
}

function aplicarFuentes(rows, auto) {
  if (!auto) return rows;
  return rows.map(p => (p.fuente && p.fuente !== 'manual' && auto[p.fuente] != null)
    ? { ...p, valor_actual: auto[p.fuente] }
    : p);
}

// El progreso se decide en cascada: manda la cifra si la hay; si no, los
// hitos; y si tampoco, el valor manual. Un trabajo de cliente no tiene cifra
// natural —Salonio no se mide en "unidades de Salonio"— y se mide por lo que
// queda por cerrar.
function progresoHoja(p, tareas) {
  const metaV = Number(p.meta_valor);
  if (metaV > 0) {
    const actual = Number(p.valor_actual) || 0;
    return Math.max(0, Math.min(100, Math.round((actual / metaV) * 100)));
  }
  if (tareas && tareas.total > 0) {
    return Math.round((tareas.hechas / tareas.total) * 100);
  }
  return p.progreso ?? 0;
}

function decorarProyectos(rows, tareasPorProyecto = new Map()) {
  const hijosDe = new Map();
  for (const p of rows) {
    if (!p.padre_id) continue;
    if (!hijosDe.has(p.padre_id)) hijosDe.set(p.padre_id, []);
    hijosDe.get(p.padre_id).push(p);
  }
  const ahora = Date.now();
  const tareasDe = id => tareasPorProyecto.get(id) || { total: 0, hechas: 0 };

  return rows.map(p => {
    const hijos  = hijosDe.get(p.id) || [];
    const tareas = tareasDe(p.id);
    // Un padre con meta propia se mide por SU meta, no por la media de lo que
    // engloba: NeumorStudio va a 5 clientes, y eso no es el promedio de cómo
    // van las webs que firma. Sin meta propia, sí resume a sus hijos.
    const metaPropia = Number(p.meta_valor) > 0;
    return {
      ...p,
      progreso_real: (hijos.length && !metaPropia)
        ? Math.round(hijos.reduce((a, h) => a + progresoHoja(h, tareasDe(h.id)), 0) / hijos.length)
        : progresoHoja(p, tareas),
      es_padre:      hijos.length > 0,
      hijos:         hijos.map(h => h.id),
      tareas_total:  tareas.total,
      tareas_hechas: tareas.hechas,
      dias_inactivo: p.updated_at
        ? Math.floor((ahora - new Date(p.updated_at).getTime()) / 86400000)
        : null,
      // Sin fin declarado no hay forma de saber si el proyecto avanza: el
      // front lo marca para que definirlo sea la primera acción. Tener hitos
      // ya es tener fin, aunque no haya cifra.
      sin_meta: !(Number(p.meta_valor) > 0) && !p.meta && tareas.total === 0
    };
  });
}

// Conteo de hitos de todos los proyectos en una sola consulta.
async function contarTareas() {
  const mapa = new Map();
  try {
    const { rows } = await db(
      `SELECT proyecto_id,
              count(*)                        AS total,
              count(*) FILTER (WHERE hecha)   AS hechas
         FROM proyecto_tareas GROUP BY proyecto_id`);
    for (const r of rows) {
      mapa.set(r.proyecto_id, { total: Number(r.total), hechas: Number(r.hechas) });
    }
  } catch (e) {
    // Sin la tabla todavía, los proyectos siguen midiéndose por cifra.
    console.error('conteo de hitos:', e.message);
  }
  return mapa;
}

// La jerarquía se limita a un nivel (marca → trabajos). Con eso basta para
// agrupar por cliente y no hay que perseguir ciclos en el árbol.
async function padreValido(id, padreId) {
  if (padreId === null || padreId === undefined || padreId === '') return { ok: true };
  const pid = parseInt(padreId, 10);
  if (Number.isNaN(pid))    return { ok: false, error: 'padre_id no es un número' };
  if (pid === parseInt(id, 10)) return { ok: false, error: 'Un proyecto no puede colgar de sí mismo' };

  const { rows } = await db('SELECT id, padre_id FROM proyectos WHERE id=$1', [pid]);
  if (!rows.length) return { ok: false, error: 'El proyecto padre no existe' };
  if (rows[0].padre_id) return { ok: false, error: 'El padre ya cuelga de otro: la jerarquía es de un solo nivel' };

  const { rows: propios } = await db('SELECT id FROM proyectos WHERE padre_id=$1 LIMIT 1', [id]);
  if (propios.length) return { ok: false, error: 'Este proyecto ya tiene hijos: no puede colgar de otro' };

  return { ok: true };
}

app.get('/proyectos', async (req, res) => {
  try {
    const { rows } = await db('SELECT * FROM proyectos ORDER BY id');
    const [auto, tareas] = await Promise.all([valoresAutomaticos(), contarTareas()]);
    res.json(decorarProyectos(aplicarFuentes(rows, auto), tareas));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HITOS ────────────────────────────────────────────────
// Todos de una vez: la pantalla pinta las casillas sin una llamada por
// tarjeta, que en el móvil se nota.
app.get('/tareas', async (req, res) => {
  try {
    const { rows } = await db(
      `SELECT id, proyecto_id, texto, hecha, fecha_limite, orden, completada_en
         FROM proyecto_tareas ORDER BY proyecto_id, hecha, orden, id`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/proyectos/:id/tareas', async (req, res) => {
  try {
    const { rows } = await db(
      `SELECT id, texto, hecha, fecha_limite, orden, completada_en
         FROM proyecto_tareas WHERE proyecto_id=$1
        ORDER BY hecha, orden, id`, [req.params.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/proyectos/:id/tareas', async (req, res) => {
  const texto = (req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ error: 'Escribe el hito' });
  try {
    const { rows: [ult] } = await db(
      'SELECT COALESCE(MAX(orden), 0) AS n FROM proyecto_tareas WHERE proyecto_id=$1',
      [req.params.id]);
    const { rows } = await db(
      `INSERT INTO proyecto_tareas (proyecto_id, texto, fecha_limite, orden)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, texto, req.body?.fecha_limite || null, Number(ult.n) + 1]);
    await db('UPDATE proyectos SET updated_at=NOW() WHERE id=$1', [req.params.id]);
    notionPushDiferido();
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Marcar y desmarcar: el gesto de un toque que mueve el progreso.
app.patch('/tareas/:id', async (req, res) => {
  try {
    const sets = [];
    const vals = [];
    if (req.body?.hecha !== undefined) {
      const hecha = !!req.body.hecha;
      vals.push(hecha);
      sets.push(`hecha=$${vals.length}`);
      // Al desmarcar se borra la fecha: si no, contaría como cerrado ese día.
      vals.push(hecha ? hoyStr() : null);
      sets.push(`completada_en=$${vals.length}`);
    }
    for (const campo of ['texto', 'fecha_limite', 'orden']) {
      if (req.body?.[campo] !== undefined) {
        vals.push(req.body[campo] === '' ? null : req.body[campo]);
        sets.push(`${campo}=$${vals.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

    vals.push(req.params.id);
    const { rows } = await db(
      `UPDATE proyecto_tareas SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Hito no encontrado' });

    await db('UPDATE proyectos SET updated_at=NOW() WHERE id=$1', [rows[0].proyecto_id]);
    await volcarTareasDelDia();
    notionPushDiferido();
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/tareas/:id', async (req, res) => {
  try {
    const { rows } = await db('DELETE FROM proyecto_tareas WHERE id=$1 RETURNING proyecto_id', [req.params.id]);
    if (rows.length) {
      await db('UPDATE proyectos SET updated_at=NOW() WHERE id=$1', [rows[0].proyecto_id]);
      await volcarTareasDelDia();
      notionPushDiferido();
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// El cruce lee `daily_logs.tareas_completadas` y `tareas_total`, que llevaban
// vacías desde siempre. Cada vez que se marca un hito se recalcula el día:
// cerradas HOY frente a lo que sigue abierto, que es la foto del esfuerzo.
async function volcarTareasDelDia() {
  try {
    const hoy = hoyStr();
    const { rows: [c] } = await db(
      `SELECT count(*) FILTER (WHERE hecha AND completada_en = $1) AS hoy_hechas,
              count(*) FILTER (WHERE NOT hecha)                    AS abiertas
         FROM proyecto_tareas`, [hoy]);
    const hechas = Number(c.hoy_hechas);
    const total  = hechas + Number(c.abiertas);

    // UPDATE y si no hay fila, INSERT: la restricción única de daily_logs
    // cambió a (usuario_id, fecha) en la v5 y un ON CONFLICT (fecha) fallaría.
    const upd = await db(
      'UPDATE daily_logs SET tareas_completadas=$2, tareas_total=$3 WHERE fecha=$1',
      [hoy, hechas, total]);
    if (!upd.rowCount) {
      await db(
        'INSERT INTO daily_logs (fecha, tareas_completadas, tareas_total) VALUES ($1,$2,$3)',
        [hoy, hechas, total]);
    }
  } catch (e) { console.error('volcado de hitos al día:', e.message); }
}

// El catálogo lo sirve el backend para que el desplegable de la app y lo que
// el backend sabe calcular no se separen nunca.
app.get('/proyectos/fuentes', async (req, res) => {
  try {
    const auto = await valoresAutomaticos();
    res.json(Object.entries(FUENTES).map(([clave, f]) => ({
      clave, ...f, valor_ahora: clave === 'manual' ? null : (auto[clave] ?? null)
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Historial de un proyecto: lo que `ultima_accion` sobrescribía y se perdía.
app.get('/proyectos/:id/acciones', async (req, res) => {
  try {
    const { rows } = await db(
      `SELECT id, fecha, accion, progreso, valor_actual
         FROM proyecto_acciones WHERE proyecto_id=$1
        ORDER BY fecha DESC, id DESC LIMIT 50`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/proyectos', async (req, res) => {
  // `descripcion` es el nombre que usaba el front antiguo: se acepta como
  // alias para que un service worker con JS cacheado no cree proyectos mudos.
  const b        = req.body || {};
  const nombre   = (b.nombre || '').trim();
  const objetivo = b.objetivo ?? b.descripcion ?? '';
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

  const chk = await padreValido(null, b.padre_id);
  if (!chk.ok) return res.status(400).json({ error: chk.error });

  try {
    const { rows } = await db(
      `INSERT INTO proyectos
         (nombre, objetivo, meta, metrica, meta_valor, valor_actual,
          categoria, padre_id, progreso, ultima_accion, fuente, url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11) RETURNING *`,
      [
        nombre, objetivo,
        b.meta || null, b.metrica || null,
        b.meta_valor != null && b.meta_valor !== '' ? b.meta_valor : null,
        b.valor_actual != null && b.valor_actual !== '' ? b.valor_actual : 0,
        b.categoria || null,
        b.padre_id ? parseInt(b.padre_id, 10) : null,
        'Proyecto creado',
        FUENTES[b.fuente] ? b.fuente : 'manual',
        (b.url || '').trim() || null
      ]
    );
    notionPushDiferido();
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/proyectos/:id', async (req, res) => {
  const b = req.body || {};
  const campos = PROY_EDITABLE.filter(c => b[c] !== undefined);
  if (!campos.length) return res.status(400).json({ error: 'Nada que actualizar' });

  if (campos.includes('padre_id')) {
    const chk = await padreValido(req.params.id, b.padre_id);
    if (!chk.ok) return res.status(400).json({ error: chk.error });
  }

  // Los nombres de columna salen de la lista blanca PROY_EDITABLE, nunca del
  // cuerpo de la petición: los valores siguen yendo parametrizados.
  const sets   = campos.map((c, i) => `${c}=$${i + 1}`);
  const values = campos.map(c => {
    if (b[c] === '' && c !== 'ultima_accion' && c !== 'nombre') return null;
    if (c === 'padre_id') return b[c] ? parseInt(b[c], 10) : null;
    return b[c];
  });
  values.push(req.params.id);

  try {
    const { rows } = await db(
      `UPDATE proyectos SET ${sets.join(', ')}, updated_at=NOW()
        WHERE id=$${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Proyecto no encontrado' });

    // Cada avance con texto queda registrado, no solo el último.
    if (b.ultima_accion && String(b.ultima_accion).trim()) {
      await db(
        `INSERT INTO proyecto_acciones (proyecto_id, fecha, accion, progreso, valor_actual)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.params.id, hoyStr(), String(b.ultima_accion).trim(),
         rows[0].progreso ?? null, rows[0].valor_actual ?? null]
      ).catch(e => console.error('historial proyecto:', e.message));
    }
    notionPushDiferido();
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/proyectos/:id', async (req, res) => {
  try {
    // Los hijos no se borran en cascada: suben a la raíz para no perderlos
    // al eliminar la marca que los agrupaba.
    await db('UPDATE proyectos SET padre_id=NULL WHERE padre_id=$1', [req.params.id]);
    await db('DELETE FROM proyectos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// RUTINAS & GYM
// ════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
// MEDIDAS CORPORALES
// ════════════════════════════════════════════════════════
// OKIRO nació para recuperar la forma perdida y no había dónde apuntar el
// resultado: solo entrenos hechos. Esto es lo que convierte "volver a mi mejor
// versión" en algo con número.
app.get('/medidas', async (req, res) => {
  try {
    const { rows } = await db(
      `SELECT id, fecha, peso, masa_muscular, grasa_pct, notas
         FROM medidas_corporales ORDER BY fecha DESC LIMIT 60`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/medidas', async (req, res) => {
  const b = req.body || {};
  const num = v => (v === '' || v === null || v === undefined ? null : Number(v));
  const peso = num(b.peso), masa = num(b.masa_muscular), grasa = num(b.grasa_pct);
  if (peso === null && masa === null && grasa === null) {
    return res.status(400).json({ error: 'Apunta al menos un dato' });
  }
  try {
    // Una medida por día: pesarse dos veces corrige, no duplica. COALESCE deja
    // que apuntar solo el peso no borre la masa que ya habías metido.
    const { rows } = await db(
      `INSERT INTO medidas_corporales (fecha, peso, masa_muscular, grasa_pct, notas)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (fecha, usuario_id) DO UPDATE SET
         peso          = COALESCE(EXCLUDED.peso,          medidas_corporales.peso),
         masa_muscular = COALESCE(EXCLUDED.masa_muscular, medidas_corporales.masa_muscular),
         grasa_pct     = COALESCE(EXCLUDED.grasa_pct,     medidas_corporales.grasa_pct),
         notas         = COALESCE(EXCLUDED.notas,         medidas_corporales.notas)
       RETURNING *`,
      [b.fecha || hoyStr(), peso, masa, grasa, b.notas || null]);

    // Los proyectos que se miden por composición cambian con esto: que Notion
    // se entere sin esperar al cron.
    notionPushDiferido();
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

app.put('/rutinas/:id', async (req, res) => {
  const { nombre, descripcion, dias } = req.body;
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'La rutina necesita nombre' });
  try {
    const { rows } = await db(
      `UPDATE rutinas SET nombre=$2, descripcion=$3, dias=$4 WHERE id=$1 RETURNING *`,
      [req.params.id, String(nombre).trim(), descripcion || '', JSON.stringify(dias || [])]
    );
    if (!rows.length) return res.status(404).json({ error: 'No existe esa rutina' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Borrar una rutina no puede tirar el historial: sesiones_gym apunta a ella
// sin ON DELETE, así que si tiene sesiones registradas se niega y lo explica.
app.delete('/rutinas/:id', async (req, res) => {
  try {
    const { rows: ses } = await db(
      'SELECT COUNT(*)::int AS n FROM sesiones_gym WHERE rutina_id=$1', [req.params.id]
    );
    if (ses[0].n > 0) {
      return res.status(409).json({
        error: `Esa rutina tiene ${ses[0].n} sesión${ses[0].n === 1 ? '' : 'es'} registrada${ses[0].n === 1 ? '' : 's'}. Bórrala solo si quieres perder ese historial.`
      });
    }
    await db('DELETE FROM rutinas WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Los ejercicios de una rutina, con la referencia de la última vez.
// Sin ese dato hay que acordarse de memoria de con cuánto peso te quedaste,
// que es justo lo que se olvida delante del banco.
app.get('/rutinas/:id/ejercicios', async (req, res) => {
  try {
    const { rows } = await db(
      `SELECT e.*,
              (SELECT json_build_object('peso', sr.peso, 'reps', sr.reps, 'fecha', s.fecha)
                 FROM series_realizadas sr
                 JOIN sesiones_gym s ON s.id = sr.sesion_id
                WHERE sr.ejercicio_id = e.id AND s.fecha < $2::date
                ORDER BY s.fecha DESC, sr.peso DESC NULLS LAST
                LIMIT 1) AS ultima,
              (SELECT MAX(sr.peso) FROM series_realizadas sr
                WHERE sr.ejercicio_id = e.id) AS mejor_peso
         FROM ejercicios e
        WHERE e.rutina_id=$1 AND e.activo
        ORDER BY e.orden, e.id`,
      [req.params.id, hoyStr()]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/ejercicios', async (req, res) => {
  const { rutina_id, nombre, series, reps_objetivo, orden, dataset_id } = req.body;
  if (!rutina_id || !nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'Faltan la rutina o el nombre' });
  }
  try {
    // Si no viene orden, va al final de la rutina
    const pos = orden != null ? orden : (await db(
      'SELECT COALESCE(MAX(orden),0)+1 AS n FROM ejercicios WHERE rutina_id=$1', [rutina_id]
    )).rows[0].n;
    const { rows } = await db(
      `INSERT INTO ejercicios (rutina_id, nombre, series, reps_objetivo, orden, dataset_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [rutina_id, String(nombre).trim(), series || 3, reps_objetivo || '8-12', pos, dataset_id || null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/ejercicios/:id', async (req, res) => {
  const { nombre, series, reps_objetivo, dataset_id } = req.body;
  try {
    // COALESCE: mandar solo el campo que cambia no debe borrar los demás
    const { rows } = await db(
      `UPDATE ejercicios
          SET nombre        = COALESCE($2, nombre),
              series        = COALESCE($3, series),
              reps_objetivo = COALESCE($4, reps_objetivo),
              dataset_id    = COALESCE($5, dataset_id)
        WHERE id=$1 RETURNING *`,
      [req.params.id,
       nombre != null && String(nombre).trim() ? String(nombre).trim() : null,
       series != null ? parseInt(series, 10) : null,
       reps_objetivo != null ? String(reps_objetivo) : null,
       dataset_id != null ? String(dataset_id) : null]
    );
    if (!rows.length) return res.status(404).json({ error: 'No existe ese ejercicio' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Quitar un ejercicio con historial lo archiva en vez de borrarlo: lo que
// levantaste sigue contando para el volumen aunque hoy cambies de rutina.
app.delete('/ejercicios/:id', async (req, res) => {
  try {
    const { rows: s } = await db(
      'SELECT COUNT(*)::int AS n FROM series_realizadas WHERE ejercicio_id=$1', [req.params.id]
    );
    if (s[0].n > 0) {
      await db('UPDATE ejercicios SET activo=false WHERE id=$1', [req.params.id]);
      return res.json({ ok: true, archivado: true, series: s[0].n });
    }
    await db('DELETE FROM ejercicios WHERE id=$1', [req.params.id]);
    res.json({ ok: true, archivado: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reordenar: llega la lista de ids en el orden nuevo
app.put('/rutinas/:id/orden', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids || !ids.length) return res.status(400).json({ error: 'Falta la lista de ids' });
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await cliente.query(
        'UPDATE ejercicios SET orden=$1 WHERE id=$2 AND rutina_id=$3',
        [i + 1, ids[i], req.params.id]
      );
    }
    await cliente.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally { cliente.release(); }
});

// ── Medias del catálogo de ejercicios (GIF de técnica y miniatura) ──
// Se sirven desde aquí y no directamente desde GitHub por tres razones:
// la app funciona aunque el repo de origen mueva las rutas otra vez (ya pasó:
// la app pedía data/gifs/{id}.gif, que no existe), el service worker puede
// cachearlas por ser del mismo origen, y así hay una sola URL para los
// ejercicios sembrados y para los que se añadan desde el catálogo.
const MEDIA_BASE  = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main';
const MEDIA_CACHE = path.join(__dirname, '.cache', 'ejercicios');

app.get('/ejercicios/media/:archivo', async (req, res) => {
  const nombre = req.params.archivo;
  // Nombre estricto ({id}-{media_id}.gif): sin esto, "../../" saldría del caché
  if (!/^\d{4}-[A-Za-z0-9_-]{1,32}\.(gif|jpg)$/.test(nombre)) {
    return res.status(400).json({ error: 'Nombre de archivo no válido' });
  }
  const esGif   = nombre.endsWith('.gif');
  const destino = path.join(MEDIA_CACHE, nombre);
  const tipo    = esGif ? 'image/gif' : 'image/jpeg';

  // El nombre lleva dentro el id del media, así que un archivo nunca cambia
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  try {
    if (fs.existsSync(destino)) return res.type(tipo).send(fs.readFileSync(destino));

    const r = await fetch(`${MEDIA_BASE}/${esGif ? 'videos' : 'images'}/${nombre}`);
    if (!r.ok) return res.status(404).json({ error: 'No está en el catálogo' });
    const buf = Buffer.from(await r.arrayBuffer());

    fs.mkdirSync(MEDIA_CACHE, { recursive: true });
    fs.writeFileSync(destino, buf);
    res.type(tipo).send(buf);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
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
// El sentido del puente es este: los datos se rellenan en OKIRO y Notion
// los enseña. Notion aporta lo que una PWA no da (tablero, timeline,
// agrupaciones); OKIRO aporta lo que Notion no puede (el cruce con sueño,
// entreno y nutrición). Por eso el flujo es de salida: OKIRO → Notion.
const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';

async function cfgGet(claves) {
  const { rows } = await db('SELECT clave, valor FROM config WHERE clave = ANY($1)', [claves]);
  return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
}

async function cfgSet(clave, valor) {
  await db(
    `INSERT INTO config (clave, valor) VALUES ($1,$2)
     ON CONFLICT (clave) DO UPDATE SET valor=$2`, [clave, valor]);
}

async function notionFetch(path, method = 'GET', body = null, token = null) {
  const tk = token || (await cfgGet(['notion_token'])).notion_token;
  if (!tk) throw Object.assign(new Error('Notion no configurado'), { status: 503 });

  const r = await fetch(NOTION_API + path, {
    method,
    headers: {
      Authorization:    `Bearer ${tk}`,
      'Notion-Version': NOTION_VER,
      'Content-Type':   'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw Object.assign(new Error(data.message || `Notion respondió ${r.status}`), { status: r.status });
  }
  return data;
}

// De una URL de Notion (o de un id pelado) al UUID con guiones que pide la API.
function notionId(entrada) {
  const hex = String(entrada || '').replace(/-/g, '').match(/[0-9a-fA-F]{32}/);
  if (!hex) return null;
  const h = hex[0];
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

const rango = pr => (pr <= 20 ? 'D' : pr <= 40 ? 'C' : pr <= 60 ? 'B' : pr <= 80 ? 'A' : 'S');

// Guardar el token es lo que se hace al rotarlo, y entonces la base ya existe:
// por eso esta ruta nunca crea nada. Comprueba el token antes de guardarlo —un
// token muerto guardado en silencio deja el puente roto sin que se note— y de
// paso mira si sigue viendo la base, que es lo único que puede fallar al rotar.
app.post('/notion/config', async (req, res) => {
  const { token, database_id } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requerido' });

  try {
    const yo = await notionFetch('/users/me', 'GET', null, token);

    await cfgSet('notion_token', token);

    // Enlazar una base existente por su URL es la otra forma de no crear otra.
    const nueva = database_id ? notionId(database_id) : null;
    if (database_id && !nueva) return res.status(400).json({ error: 'Ese enlace no lleva a una base de Notion' });
    if (nueva) {
      await notionFetch(`/databases/${nueva}`, 'GET', null, token);
      await cfgSet('notion_db_proyectos', nueva);
      await cfgSet('notion_db_url', '');
    }

    const base = nueva || (await cfgGet(['notion_db_proyectos'])).notion_db_proyectos;
    let base_ok = null;
    if (base) {
      base_ok = await notionFetch(`/databases/${base}`, 'GET', null, token).then(() => true).catch(() => false);
    }

    res.json({ ok: true, integracion: yo.name || yo.bot?.owner?.type || 'integración', base_creada: !!base, base_ok });
  } catch (e) {
    const msg = e.status === 401
      ? 'Notion rechaza ese token. Copia el de notion.so/my-integrations entero, empieza por ntn_'
      : e.message;
    res.status(e.status || 500).json({ error: msg });
  }
});

app.get('/notion/estado', async (req, res) => {
  try {
    const c = await cfgGet(['notion_token', 'notion_db_proyectos', 'notion_ultimo_push', 'notion_db_url']);
    const { rows: [n] } = await db(
      'SELECT count(*) FILTER (WHERE notion_page_id IS NOT NULL) AS enlazados, count(*) AS total FROM proyectos');

    // La URL de la base solo se pide una vez y se guarda: sirve para el botón
    // de abrirla, y no merece una llamada a Notion cada vez que se pinta.
    let url = c.notion_db_url || null;
    if (!url && c.notion_token && c.notion_db_proyectos) {
      url = await notionFetch(`/databases/${c.notion_db_proyectos}`).then(b => b.url).catch(() => null);
      if (url) await cfgSet('notion_db_url', url);
    }

    res.json({
      conectado:    !!c.notion_token,
      base_creada:  !!c.notion_db_proyectos,
      ultimo_push:  c.notion_ultimo_push || null,
      url,
      enlazados:    Number(n.enlazados),
      total:        Number(n.total)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Crea la base en Notion con el esquema correcto, dentro de una página que el
// usuario haya compartido con la integración. Así no hay que montar a mano
// diez propiedades ni acertar con los nombres exactos.
app.post('/notion/setup', async (req, res) => {
  const parent = notionId(req.body?.pagina);
  if (!parent) return res.status(400).json({ error: 'Pega el enlace de la página de Notion donde crear la base' });

  try {
    const base = await notionFetch('/databases', 'POST', {
      parent: { type: 'page_id', page_id: parent },
      title:  [{ type: 'text', text: { content: 'OKIRO · Proyectos' } }],
      properties: {
        'Proyecto':       { title: {} },
        'De qué va':      { rich_text: {} },
        'Meta':           { rich_text: {} },
        // Notion pinta el porcentaje sobre 1, así que se envía progreso/100.
        'Progreso':       { number: { format: 'percent' } },
        'Voy por':        { number: {} },
        'Meta valor':     { number: {} },
        'Unidad':         { rich_text: {} },
        'Categoría':      { select: {} },
        'Cuelga de':      { select: {} },
        'Rango':          { select: { options: [
                              { name: 'D', color: 'gray'   },
                              { name: 'C', color: 'purple' },
                              { name: 'B', color: 'blue'   },
                              { name: 'A', color: 'green'  },
                              { name: 'S', color: 'yellow' }
                            ] } },
        'Última acción':  { rich_text: {} },
        'Días sin tocar': { number: {} },
        'Actualizado':    { date: {} },
        'ID OKIRO':       { number: {} }
      }
    });

    await cfgSet('notion_db_proyectos', base.id);
    await cfgSet('notion_db_url', base.url || '');
    // Una base recién creada no tiene páginas viejas que reutilizar.
    await db('UPDATE proyectos SET notion_page_id = NULL');
    res.json({ ok: true, database_id: base.id, url: base.url });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Vuelca los proyectos a Notion: crea la página la primera vez y la actualiza
// las siguientes. Nunca borra en Notion — si allí sobra algo, se quita a mano.
async function notionPush() {
  const c = await cfgGet(['notion_token', 'notion_db_proyectos']);
  if (!c.notion_token)        throw Object.assign(new Error('Notion no configurado'), { status: 503 });
  if (!c.notion_db_proyectos) throw Object.assign(new Error('Falta crear la base en Notion'), { status: 400 });

  const { rows } = await db('SELECT * FROM proyectos ORDER BY id');
  const proyectos = decorarProyectos(aplicarFuentes(rows, await valoresAutomaticos()), await contarTareas());
  const nombrePorId = new Map(rows.map(p => [p.id, p.nombre]));

  const texto = v => (v ? [{ type: 'text', text: { content: String(v).slice(0, 1900) } }] : []);
  const sel   = v => (v ? { name: String(v).slice(0, 90) } : null);
  const num   = v => (v === null || v === undefined || v === '' ? null : Number(v));

  let creados = 0, actualizados = 0;
  const errores = [];

  for (const p of proyectos) {
    const props = {
      'Proyecto':       { title: texto(p.nombre) },
      'De qué va':      { rich_text: texto(p.objetivo) },
      'Meta':           { rich_text: texto(p.meta) },
      'Progreso':       { number: (p.progreso_real ?? 0) / 100 },
      'Voy por':        { number: num(p.valor_actual) },
      'Meta valor':     { number: num(p.meta_valor) },
      'Unidad':         { rich_text: texto(p.metrica) },
      'Categoría':      { select: sel(p.categoria) },
      'Cuelga de':      { select: sel(p.padre_id ? nombrePorId.get(p.padre_id) : null) },
      'Rango':          { select: sel(rango(p.progreso_real ?? 0)) },
      'Última acción':  { rich_text: texto(p.ultima_accion) },
      'Días sin tocar': { number: num(p.dias_inactivo) },
      'Actualizado':    { date: p.updated_at ? { start: new Date(p.updated_at).toISOString() } : null },
      'ID OKIRO':       { number: p.id }
    };

    try {
      if (p.notion_page_id) {
        await notionFetch(`/pages/${p.notion_page_id}`, 'PATCH', { properties: props }, c.notion_token);
        actualizados++;
      } else {
        const pagina = await notionFetch('/pages', 'POST', {
          parent: { database_id: c.notion_db_proyectos },
          properties: props
        }, c.notion_token);
        await db('UPDATE proyectos SET notion_page_id=$1 WHERE id=$2', [pagina.id, p.id]);
        creados++;
      }
    } catch (e) {
      // Si una página se borró en Notion, se olvida el enlace y la próxima
      // vuelta la recrea en vez de fallar para siempre.
      if (e.status === 404 && p.notion_page_id) {
        await db('UPDATE proyectos SET notion_page_id=NULL WHERE id=$1', [p.id]);
      }
      errores.push(`${p.nombre}: ${e.message}`);
    }
    // Notion limita a ~3 peticiones por segundo.
    await new Promise(r => setTimeout(r, 350));
  }

  await cfgSet('notion_ultimo_push', new Date().toISOString());
  return { creados, actualizados, errores };
}

app.post('/notion/push', async (req, res) => {
  try {
    res.json(await notionPush());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Tras editar un proyecto, Notion se actualiza solo unos segundos después.
// El retardo agrupa varias ediciones seguidas en un único envío y, sobre todo,
// evita que guardar en la app tenga que esperar a la API de Notion.
let _pushTimer = null;
function notionPushDiferido() {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    _pushTimer = null;
    notionPush().catch(e => {
      // Sin Notion configurado esto no es un error: es el estado normal.
      if (e.status !== 503 && e.status !== 400) console.error('Notion push:', e.message);
    });
  }, 5000);
}

app.get('/notion/sync', async (req, res) => {
  try {
    const { rows } = await db("SELECT clave, valor FROM config WHERE clave IN ('notion_token','notion_db','notion_db_proyectos')");
    const cfg = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
    if (!cfg.notion_token) return res.status(503).json({ error: 'Notion no configurado' });
    // `notion_db` es de la versión vieja y nadie la rellena ya: la base buena
    // es la que crea /notion/setup.
    const baseSync = cfg.notion_db || cfg.notion_db_proyectos;
    if (!baseSync) return res.status(400).json({ error: 'Falta crear la base en Notion' });
    const r = await fetch(`https://api.notion.com/v1/databases/${baseSync}/query`, {
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
// ── OBJETIVOS DE MACROS ─────────────────────────────────────
// Vivían en el localStorage del móvil: el servidor no los conocía, así que
// el prompt de la IA y el resumen del día llevaban números escritos a mano
// que no cambiaban al editarlos en la app. Ahora hay una sola fuente y todo
// lee de aquí. Va colgado de /nutricion (y declarado ANTES de /nutricion/:fecha,
// que si no se lo tragaría como si "objetivos" fuera una fecha) para no tener
// que añadir otra ruta al nginx del droplet.
const OBJETIVOS_DEFECTO = { calorias: 2400, proteinas: 180, carbos: 300, grasas: 70 };

async function objetivosDe(usuarioId = 1) {
  const { rows } = await db(
    'SELECT calorias, proteinas, carbos, grasas FROM objetivos_nutricion WHERE usuario_id=$1',
    [usuarioId]
  ).catch(() => ({ rows: [] }));
  return rows[0] || { ...OBJETIVOS_DEFECTO };
}

app.get('/nutricion/objetivos', async (req, res) => {
  try { res.json(await objetivosDe()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/nutricion/objetivos', async (req, res) => {
  const num = (v, min, max) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const o = {
    calorias:  num(req.body?.calorias,  1, 20000),
    proteinas: num(req.body?.proteinas, 0, 2000),
    carbos:    num(req.body?.carbos,    0, 2000),
    grasas:    num(req.body?.grasas,    0, 2000)
  };
  if (Object.values(o).some(v => v === null)) {
    return res.status(400).json({ error: 'Objetivos fuera de rango o no numéricos' });
  }
  try {
    const { rows } = await db(
      `INSERT INTO objetivos_nutricion (usuario_id, calorias, proteinas, carbos, grasas)
       VALUES (1,$1,$2,$3,$4)
       ON CONFLICT (usuario_id) DO UPDATE
         SET calorias=$1, proteinas=$2, carbos=$3, grasas=$4, actualizado=NOW()
       RETURNING calorias, proteinas, carbos, grasas`,
      [o.calorias, o.proteinas, o.carbos, o.grasas]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
  const [logsQ, comidasQ, obj] = await Promise.all([
    db('SELECT * FROM daily_logs ORDER BY fecha DESC LIMIT 30'),
    db('SELECT * FROM comidas WHERE fecha=$1', [fecha]),
    objetivosDe()
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

MACROS HOY (objetivos fijados por el atleta, no genéricos):
- Calorías: ${tot.calorias} / ${obj.calorias} kcal objetivo
- Proteínas: ${tot.proteinas}g / ${obj.proteinas}g objetivo
- Carbos: ${tot.carbos}g / ${obj.carbos}g objetivo
- Grasas: ${tot.grasas}g / ${obj.grasas}g objetivo

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
    // Los objetivos salen de la tabla, no de números escritos aquí: esta pantalla
    // decía 2200/160 mientras la de nutrición decía 2400/180, y ninguna de las dos
    // hacía caso a lo que él hubiera editado en la app.
    const objDia = await objetivosDe();
    const calorias_objetivo  = objDia.calorias;
    const proteinas_objetivo = objDia.proteinas;

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
    // El prioritario sale siempre de las hojas: un proyecto padre solo resume
    // a sus hijos, así que proponerlo como tarea del día no diría qué hacer.
    // Y antes que lo más atrasado va lo que ni siquiera tiene fin declarado:
    // sin meta no hay forma de saber si eso avanza.
    const { rows: proyRows } = await db('SELECT * FROM proyectos').catch(() => ({ rows: [] }));
    const hojas = decorarProyectos(aplicarFuentes(proyRows, await valoresAutomaticos()), await contarTareas())
      .filter(p => !p.es_padre && p.progreso_real < 100)
      .sort((a, b) => (a.sin_meta === b.sin_meta)
        ? a.progreso_real - b.progreso_real
        : (a.sin_meta ? -1 : 1));
    const proyectos_activos    = hojas.length;
    const proyectos_sin_meta   = hojas.filter(p => p.sin_meta).length;
    const proyecto_prioritario = hojas[0]?.nombre || null;

    // ── 6a. Misión del día ───────────────────────────────
    // Solo para hoy: pedir el resumen de una fecha pasada no debe crear
    // misiones retroactivas que nunca se ofrecieron.
    const mision = fecha === hoyStr()
      ? await misionDelDia(fecha).catch(e => { console.error('misión:', e.message); return null; })
      : null;
    if (mision) mision.mensaje = await mensajeDeAliento(mision, fecha);

    // ── 6b. Inglés ───────────────────────────────────────
    // OKIRO no enseña idiomas: mide y recuerda. La tarjeta de HOY dice si
    // quedan repasos y lleva a tutoringles, que es donde se estudia.
    const ing = await valoresIngles();
    const proyIngles = proyRows.find(p => (p.fuente || '').startsWith('ingles'));
    const ingles = ing.ingles_total != null ? {
      repasos_hoy: ing.ingles_repasos_hoy,
      empezadas:   ing.ingles_empezadas,
      dominadas:   ing.ingles_palabras,
      total:       ing.ingles_total,
      racha:       ing.ingles_racha,
      // El enlace sale del proyecto, no está escrito en el código: si cambia
      // el dominio se cambia en la app y la tarjeta lo sigue.
      url:         proyIngles?.url || null,
      nombre:      proyIngles?.nombre || 'Inglés'
    } : null;

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
      proyectos_sin_meta,
      proyecto_prioritario,
      ingles,
      mision
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
  console.log(`OKIRO Backend v4.2 · :${PORT}`);
  console.log(`· Auth:  ${APP_TOKEN ? 'ACTIVADA (APP_TOKEN)' : 'DESACTIVADA — define APP_TOKEN en producción'}`);
  if (APP_TOKEN && APP_TOKEN.length < 24) {
    console.warn(`· ⚠ CLAVE DÉBIL: ${APP_TOKEN.length} caracteres. Detrás de esta clave están tu base de datos`);
    console.warn(`  y tu clave de Anthropic. Rótala:  openssl rand -base64 32 > ${SECRETS_DIR}/app_token`);
  }
  console.log(`· IA:    ${ANTHROPIC_KEY ? `activa · modelo ${AI_MODEL} · límite ${AI_DAILY_LIMIT}/día` : 'sin ANTHROPIC_API_KEY'}`);
  console.log(`· Push:  ${PUSH_READY ? 'activo' : 'sin claves VAPID — genera con: npx web-push generate-vapid-keys'}`);
});
