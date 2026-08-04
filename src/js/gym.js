// OKIRO — Gym: sesiones, técnica y rutinas propias
//
// La técnica se veía mal por dos motivos que venían del principio:
// la app pedía el GIF a data/gifs/{id}.gif, una carpeta que NO existe en el
// repo del dataset (la buena es videos/{id}-{media_id}.gif), y emparejaba
// cada ejercicio con el catálogo por su nombre en español contra una lista
// de 20 traducciones a mano — así que ningún ejercicio nuevo tenía técnica y
// varias de esas traducciones apuntaban a nombres inexistentes. Resultado:
// el GIF no salió nunca, siempre caía al icono de repuesto.
//
// Ahora el vínculo es `dataset_id`, guardado en la base, y el catálogo va
// precocinado en assets/ (nombres ya en español, 234 KB en vez de 17 MB).
// La técnica se ve de un toque: miniatura en la tarjeta, visor con la
// animación y los pasos en español al pulsarla.

/* ── ESTADO ─────────────────────────────────────────────────────── */
let gymRutinas        = [];
let gymSesion         = null;
let gymEj             = [];
let gymSeriesMap      = {};
let gymOpenForm       = null;
let gymHistoryVisible = false;
let gymEditando       = null;   // id de la rutina en edición, o null

/* ══════════════════════════════════════════════════════════════════
   CATÁLOGO DE EJERCICIOS
   ══════════════════════════════════════════════════════════════════ */
const GYM_MEDIA = 'ejercicios/media/';   // el backend lo sirve y lo cachea

let _cat = null, _catIdx = null, _catProm = null;
let _tec = null, _tecProm = null;

/** Índice de 1.324 ejercicios con nombre en español. ~234 KB, una sola vez. */
function cargarCatalogo() {
  if (_catIdx) return Promise.resolve(_catIdx);
  if (_catProm) return _catProm;
  _catProm = fetch('assets/ejercicios.json')
    .then(r => (r.ok ? r.json() : []))
    .then(arr => {
      _cat = arr;
      _catIdx = new Map(arr.map(e => [e.id, e]));
      return _catIdx;
    })
    .catch(() => { _cat = []; _catIdx = new Map(); return _catIdx; });
  return _catProm;
}

/** Pasos en español. Pesa más, así que se pide solo al abrir el visor. */
function cargarTecnica() {
  if (_tec) return Promise.resolve(_tec);
  if (_tecProm) return _tecProm;
  _tecProm = fetch('assets/ejercicios-tecnica.json')
    .then(r => (r.ok ? r.json() : {}))
    .then(o => { _tec = o; return _tec; })
    .catch(() => { _tec = {}; return _tec; });
  return _tecProm;
}

const gifDe  = c => c ? `${GYM_MEDIA}${c.id}-${c.m}.gif` : '';
const mp4De  = c => c ? `${GYM_MEDIA}${c.id}-${c.m}.mp4` : '';
const miniDe = c => c ? `${GYM_MEDIA}${c.id}-${c.m}.jpg` : '';

function gesc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Normaliza para comparar: sin acentos, sin signos, en minúsculas. */
function norm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')   // fuera acentos
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Sugerencia de catálogo para un ejercicio que aún no tiene dataset_id. */
function sugerirDelCatalogo(nombre) {
  if (!_cat || !_cat.length) return null;
  const pal = norm(nombre).split(' ').filter(p => p.length > 2);
  if (!pal.length) return null;
  let mejor = null, mejorPunt = 0;
  for (const c of _cat) {
    const texto = norm(c.n) + ' ' + norm(c.en);
    let punt = 0;
    for (const p of pal) if (texto.includes(p)) punt++;
    // Empate: gana el nombre más corto, que suele ser el ejercicio base
    if (punt > mejorPunt || (punt === mejorPunt && punt > 0 && mejor && c.n.length < mejor.n.length)) {
      mejor = c; mejorPunt = punt;
    }
  }
  return mejorPunt >= Math.min(2, pal.length) ? mejor : null;
}

/* ══════════════════════════════════════════════════════════════════
   1. CARGAR
   ══════════════════════════════════════════════════════════════════ */
async function loadGym() {
  cargarCatalogo();   // en paralelo: para cuando se pinten las tarjetas ya está

  try {
    const [rutiRes, sesRes] = await Promise.all([
      api('/rutinas'),
      api('/sesiones/hoy')
    ]);

    gymRutinas = rutiRes.ok ? await rutiRes.json() : [];
    gymSesion  = sesRes.ok  ? await sesRes.json()  : null;

    if (gymSesion && gymSesion.rutina_id != null) {
      const ejRes = await api(`/rutinas/${gymSesion.rutina_id}/ejercicios`);
      gymEj = ejRes.ok ? await ejRes.json() : [];

      gymSeriesMap = {};
      if (Array.isArray(gymSesion.series)) {
        gymSesion.series.forEach(s => {
          if (!gymSeriesMap[s.ejercicio_id]) gymSeriesMap[s.ejercicio_id] = [];
          gymSeriesMap[s.ejercicio_id].push(s);
        });
      }
    } else {
      gymSesion    = null;
      gymEj        = [];
      gymSeriesMap = {};
    }
  } catch {
    gymRutinas = [];
    gymSesion  = null;
  }

  await cargarCatalogo();
  renderGym();
}

/* ══════════════════════════════════════════════════════════════════
   2. RENDER PRINCIPAL
   ══════════════════════════════════════════════════════════════════ */
function renderGym() {
  if (gymEditando !== null) {
    renderEditorRutina();
    return;
  }
  if (gymSesion && gymSesion.completada === true) {
    renderSesionDone();
  } else if (gymSesion) {
    renderSesionActiva();
  } else {
    renderRutinaSelect();
  }

  /* Botón historial — solo cuando no hay sesión activa */
  if (!gymSesion || gymSesion.completada) {
    const gc = document.getElementById('gym-content');
    if (!gc) return;
    renderMedidas();
    gc.insertAdjacentHTML('beforeend', `
      <div id="gym-hist-wrap" style="margin-top:14px">
        <button class="bu" id="gym-hist-btn" onclick="toggleGymHistory()"
                style="width:100%;height:40px;font-size:11px;letter-spacing:1.5px">
          ${gymHistoryVisible ? '▲ OCULTAR HISTORIAL' : '▼ VER HISTORIAL'}
        </button>
        <div id="gym-history-section" style="display:${gymHistoryVisible ? 'block' : 'none'}"></div>
      </div>`);
    if (gymHistoryVisible) loadGymHistory();
  }
}

/* ══════════════════════════════════════════════════════════════════
   3. SELECCIÓN DE RUTINA + OBJETIVOS
   ══════════════════════════════════════════════════════════════════ */
function renderRutinaSelect() {
  const gc = document.getElementById('gym-content');
  if (!gc) return;

  if (!gymRutinas.length) {
    gc.innerHTML = `
      <div class="empty-state">Todavía no hay ninguna rutina.</div>
      <button class="bs" style="margin-top:12px" onclick="nuevaRutina()">+ CREAR RUTINA</button>`;
    return;
  }

  gc.innerHTML =
    '<div id="gym-objectives-wrap"><div class="gym-obj-loading">Calculando progreso…</div></div>' +
    '<div class="stl" style="margin:16px 0 10px">ELIGE RUTINA DE HOY</div>' +
    gymRutinas.map(r => {
      // Banner de fondo por rutina (assets/gym-*.webp) — degradado para legibilidad del texto
      const img = GYM_BANNERS[(r.nombre || '').toUpperCase()];
      const bg  = img ? ` style="background:linear-gradient(90deg, rgba(10,6,18,.97) 32%, rgba(10,6,18,.55)), url('${img}') right center / cover no-repeat"` : '';
      return `
      <div class="rc"${bg}>
        <div class="rc-main" onclick="iniciarSesion(${r.id})">
          <div class="rn">${gesc(r.nombre || '')}</div>
          <div class="rd">${gesc(r.descripcion || '')}</div>
        </div>
        <button class="rc-edit" onclick="editarRutina(${r.id})" title="Editar rutina"
                aria-label="Editar ${gesc(r.nombre || '')}">${OKICON.gear}</button>
      </div>`;
    }).join('') +
    `<button class="bu gym-nueva-rutina" onclick="nuevaRutina()">+ NUEVA RUTINA</button>`;

  renderGymObjectives();
}

const GYM_ICONS = { 'PUSH': OKICON.dumbbell, 'PULL': OKICON.pull, 'LEGS': OKICON.legs };
// En WebP y no en PNG: son los mismos 1376×768, pero 27 KB en vez de 1.017.
// Los tres banners juntos bajan de 2,6 MB a 77 KB, que en el gimnasio con dos
// rayas de cobertura es la diferencia entre verlos y no verlos. El PNG sigue
// en assets/ como original: de ahí salen los WebP si hay que regenerarlos.
const GYM_BANNERS = { 'PUSH': 'assets/gym-push.webp', 'PULL': 'assets/gym-pull.webp', 'LEGS': 'assets/gym-legs.webp' };

async function renderGymObjectives() {
  const wrap = document.getElementById('gym-objectives-wrap');
  if (!wrap) return;

  try {
    const res      = await api('/sesiones');
    const sessions = res.ok ? await res.json() : [];

    const cutoff  = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const countMap = {};
    gymRutinas.forEach(r => { countMap[r.id] = 0; });

    sessions.forEach(s => {
      if (!s.completada) return;
      if (new Date(s.fecha).getTime() >= cutoff && countMap[s.rutina_id] !== undefined) {
        countMap[s.rutina_id]++;
      }
    });

    const cards = gymRutinas.map(r => {
      const diasLen     = Array.isArray(r.dias) ? r.dias.length : 2;
      const weeklyGoal  = Math.max(1, diasLen);
      const monthlyGoal = Math.max(4, Math.round(weeklyGoal * 4.3));
      const done        = countMap[r.id] || 0;
      const pct         = Math.min(100, Math.round((done / monthlyGoal) * 100));
      const icon        = GYM_ICONS[(r.nombre || '').toUpperCase()] || OKICON.dumbbell;

      return `
        <div class="gym-obj-card">
          <div class="gym-obj-header">
            <span class="gym-obj-icon">${icon}</span>
            <div class="gym-obj-info">
              <div class="gym-obj-name">${gesc(r.nombre)}</div>
              <div class="gym-obj-goal">${done} / ${monthlyGoal} sesiones</div>
            </div>
            <div class="gym-obj-pct">${pct}%</div>
          </div>
          <div class="gym-obj-bar">
            <div class="gym-obj-fill" style="width:0%" data-target="${pct}%"></div>
          </div>
        </div>`;
    }).join('');

    wrap.innerHTML = `
      <div class="gym-objectives-section">
        <div class="gym-obj-title">MIS OBJETIVOS · ÚLTIMOS 30 DÍAS</div>
        ${cards}
      </div>`;

    /* Animar barras con delay para que la transición sea visible */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      wrap.querySelectorAll('.gym-obj-fill').forEach(el => {
        el.style.width = el.dataset.target;
      });
    }));

  } catch {
    wrap.innerHTML = '';
  }
}

/* ══════════════════════════════════════════════════════════════════
   4. INICIAR SESIÓN
   ══════════════════════════════════════════════════════════════════ */
async function iniciarSesion(rutina_id) {
  try {
    const sesRes = await api('/sesiones', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ rutina_id })
    });
    if (!sesRes.ok) throw new Error(sesRes.status);
    gymSesion = await sesRes.json();

    const ejRes = await api(`/rutinas/${rutina_id}/ejercicios`);
    gymEj = ejRes.ok ? await ejRes.json() : [];

    gymSeriesMap = {};
    gymOpenForm  = null;
    await cargarCatalogo();
    renderGym();
    toast('Sesión iniciada.');
  } catch {
    toast('Error al iniciar sesión', 'error');
  }
}

/* ══════════════════════════════════════════════════════════════════
   5. RENDER SESIÓN ACTIVA
   ══════════════════════════════════════════════════════════════════ */
function renderSesionActiva() {
  const gc = document.getElementById('gym-content');
  if (!gc) return;

  const rutinaNombre = gymSesion?.rutina_nombre
    || gymRutinas.find(r => r.id === gymSesion?.rutina_id)?.nombre
    || 'SESIÓN ACTIVA';

  const header = `
    <div class="stl">${gesc(rutinaNombre)}</div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="bs" style="flex:1" onclick="completarSesion()">COMPLETAR SESIÓN</button>
      <button class="rb" style="flex:0 0 auto;padding:0 14px;height:48px;cursor:pointer;font-family:var(--font-sans);font-size:11px" onclick="cancelarSesion()">CANCELAR</button>
    </div>`;

  const cards = gymEj.length
    ? gymEj.map(e => renderEjercicioCard(e)).join('')
    : `<div class="empty-state">Esta rutina no tiene ejercicios.<br>
         <button class="bu" style="margin-top:10px" onclick="editarRutina(${gymSesion.rutina_id})">AÑADIR EJERCICIOS</button>
       </div>`;
  gc.innerHTML = header + cards;
}

/* ══════════════════════════════════════════════════════════════════
   6. CARD DE EJERCICIO — con la técnica a la vista
   ══════════════════════════════════════════════════════════════════ */
function renderEjercicioCard(e) {
  const series = gymSeriesMap[e.id] || [];
  const cat    = e.dataset_id && _catIdx ? _catIdx.get(e.dataset_id) : null;

  const filas = series.map((s, i) => `
    <div class="set-row${s.completada ? ' completed' : ''}">
      <span class="set-num">${i + 1}</span>
      <span class="set-val">${s.peso} kg</span>
      <span class="set-val">${s.reps} reps</span>
      <span class="set-chk">${OKICON.check}</span>
    </div>`
  ).join('');

  /* La referencia que se olvida delante del banco: con cuánto te quedaste.
     Postgres devuelve los NUMERIC como texto ("60.00"), así que hay que
     pasarlos por Number o la tarjeta diría "60.00 kg". */
  const kg  = v => Number(v).toLocaleString('es-ES', { maximumFractionDigits: 1 });
  const ult = e.ultima;
  const refHTML = ult && ult.peso != null
    ? `<div class="ej-ultima">última vez · <strong>${kg(ult.peso)} kg × ${ult.reps}</strong>${
        e.mejor_peso && Number(e.mejor_peso) > Number(ult.peso)
          ? ` <span class="ej-record">récord ${kg(e.mejor_peso)} kg</span>` : ''}</div>`
    : '<div class="ej-ultima ej-ultima-vacia">primera vez con este ejercicio</div>';

  /* Miniatura: es el acceso a la técnica. Si no hay vínculo con el catálogo,
     el hueco invita a elegirlo en vez de quedarse en un icono muerto. */
  const previewHTML = cat
    ? `<button class="ej-prev" onclick="verTecnica(${e.id})" aria-label="Ver técnica de ${gesc(e.nombre)}">
         <img src="${miniDe(cat)}" alt="" loading="lazy" onerror="this.classList.add('err')">
         <span class="ej-prev-play">▶</span>
       </button>`
    : `<button class="ej-prev ej-prev-vacio" onclick="elegirEjercicioCatalogo(${e.id})"
               aria-label="Enlazar ${gesc(e.nombre)} con el catálogo">
         ${OKICON.dumbbell}<span class="ej-prev-lbl">técnica</span>
       </button>`;

  const musculos = cat
    ? `<div class="ej-musc">
         <span class="muscle-badge primary">${gesc(cat.t)}</span>
         ${cat.s.slice(0, 2).map(m => `<span class="muscle-badge secondary">${gesc(m)}</span>`).join('')}
       </div>`
    : '';

  return `
    <div class="ec" id="ec-${e.id}">
      <div class="ej-head">
        ${previewHTML}
        <div class="ej-info">
          <div class="en">${gesc(e.nombre || '')}</div>
          <div class="er2">${e.series || '?'}×${e.reps_objetivo || '?'}</div>
          ${refHTML}
          ${musculos}
        </div>
      </div>

      <div class="sets-list">${filas}</div>

      <div style="display:flex;justify-content:flex-end;margin-top:8px">
        <button class="add-set-btn" onclick="toggleForm(${e.id})">+ SERIE</button>
      </div>

      <div class="add-set-form" id="form-${e.id}" style="display:none">
        <div class="lbl">PESO KG</div>
        <input type="number" id="peso-${e.id}" placeholder="${ult?.peso != null ? kg(ult.peso) : 'Peso kg'}" min="0" step="0.5" inputmode="decimal">
        <div class="lbl" style="margin-top:6px">REPS</div>
        <input type="number" id="reps-${e.id}" placeholder="${ult?.reps ?? 'Reps'}" min="0" step="1" inputmode="numeric">
        <button class="save-set-btn" style="margin-top:8px;width:100%"
                onclick="guardarSerie(${e.id})">GUARDAR</button>
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   7. VISOR DE TÉCNICA — animación y pasos en español
   ══════════════════════════════════════════════════════════════════ */
async function verTecnica(ejId) {
  const ej  = gymEj.find(e => e.id === ejId);
  if (!ej) return;
  await cargarCatalogo();
  const cat = ej.dataset_id ? _catIdx.get(ej.dataset_id) : null;
  if (!cat) return elegirEjercicioCatalogo(ejId);
  // El vídeo de persona real es del ejercicio, no del catálogo: se pasa aparte
  abrirVisorTecnica(cat, ej.nombre, { slug: ej.video_slug, aprox: ej.video_aprox });
}

/** Abre el visor para una ficha del catálogo. `titulo` es el nombre propio.
    `video` es el clip de persona real, si ese ejercicio tiene uno mapeado. */
async function abrirVisorTecnica(cat, titulo, video = null) {
  const ov   = document.getElementById('tecnica-overlay');
  const body = document.getElementById('tecnica-body');
  if (!ov || !body) return;

  _tecVideo   = video?.slug ? video : null;   // lo lee alternarVistaTecnica()
  _tecCat     = cat;
  _tecEnVideo = false;                        // siempre se abre por la animación

  ov.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  body.innerHTML = `
    <div class="tec-cab">
      <div>
        <h3 class="tec-titulo">${gesc(titulo || cat.n)}</h3>
        <p class="tec-sub">${gesc(cat.n)}${cat.eq ? ' · ' + gesc(cat.eq) : ''}</p>
      </div>
      <button class="tec-cerrar" onclick="cerrarVisorTecnica()" aria-label="Cerrar">${OKICON.cross}</button>
    </div>
    <div class="tec-gif-wrap" id="tec-medio">${vistaAnimacion(cat)}</div>
    ${video?.slug ? `
      <button class="tec-cambiar" id="tec-cambiar" onclick="alternarVistaTecnica()">
        ${OKICON.play} VER EN VÍDEO
      </button>` : ''}
    <div class="tech-muscles">
      <span class="muscle-badge primary">${gesc(cat.t)}</span>
      ${cat.s.map(m => `<span class="muscle-badge secondary">${gesc(m)}</span>`).join('')}
    </div>
    <div class="tec-pasos" id="tec-pasos"><div class="tech-loading">Cargando la técnica…</div></div>`;

  const tec   = await cargarTecnica();
  const pasos = tec[cat.id] || [];
  const cont  = document.getElementById('tec-pasos');
  if (!cont) return;   // se cerró mientras cargaba

  cont.innerHTML = pasos.length
    ? `<div class="tec-pasos-tit">CÓMO SE HACE</div>
       <ol class="tech-instructions">${pasos.map(p => `<li>${gesc(p)}</li>`).join('')}</ol>`
    : '<div class="tech-loading">Este ejercicio no trae instrucciones.</div>';
}

/* ── Las dos vistas del visor ────────────────────────────────────────
   La animación es la de casa: 85 KB, arranca sola y se queda en bucle
   corto, que es lo que se mira de reojo entre series. El vídeo de una
   persona son 330 KB en Full HD y solo se descarga si lo pides: en el
   gimnasio la cobertura es mala y no se gasta en lo que no has pedido. */
let _tecVideo = null, _tecCat = null, _tecEnVideo = false;

function vistaAnimacion(cat) {
  return `<video class="tec-gif" src="${mp4De(cat)}" poster="${miniDe(cat)}"
                 autoplay loop muted playsinline disablepictureinpicture
                 aria-label="Animación de ${gesc(cat.n)}"
                 onerror="tecnicaSinVideo(this, '${gifDe(cat)}', '${gesc(cat.n)}')"></video>`;
}

function vistaVideoReal(v) {
  const base = `ejercicios/video/${v.slug}`;
  return `<video class="tec-gif tec-real" src="${base}.mp4" poster="${base}.jpg"
                 autoplay loop muted playsinline controls
                 aria-label="Vídeo de una persona haciendo el ejercicio"
                 onerror="tecnicaVideoNoCarga(this)"></video>
          ${v.aprox ? `<p class="tec-aviso">Es la variante filmada más parecida, no
             exactamente tu ejercicio. Para el recorrido exacto, mira la animación.</p>` : ''}`;
}

function alternarVistaTecnica() {
  const cont = document.getElementById('tec-medio');
  const btn  = document.getElementById('tec-cambiar');
  if (!cont || !_tecCat) return;
  _tecEnVideo = !_tecEnVideo;
  cont.innerHTML = _tecEnVideo ? vistaVideoReal(_tecVideo) : vistaAnimacion(_tecCat);
  cont.classList.toggle('con-video', _tecEnVideo);
  if (btn) btn.innerHTML = _tecEnVideo
    ? `${OKICON.dumbbell} VER LA ANIMACIÓN`
    : `${OKICON.play} VER EN VÍDEO`;
}

/** El clip pesa 330 KB: con mala cobertura puede no llegar. Se dice y se
    vuelve a la animación, que a esas alturas ya está cacheada. */
function tecnicaVideoNoCarga(el) {
  const cont = document.getElementById('tec-medio');
  if (!cont) return;
  toast('No se pudo cargar el vídeo. Vuelvo a la animación.', 'error');
  _tecEnVideo = false;
  cont.innerHTML = vistaAnimacion(_tecCat);
  const btn = document.getElementById('tec-cambiar');
  if (btn) btn.innerHTML = `${OKICON.play} VER EN VÍDEO`;
}

/** Sin MP4 (servidor sin ffmpeg, o formato no soportado) se cae al GIF, que
    ya viene con la cadencia arreglada. La técnica se ve igual, solo pesa más. */
function tecnicaSinVideo(video, gif, nombre) {
  const wrap = video.parentElement;
  if (!wrap) return;
  wrap.innerHTML =
    `<img class="tec-gif" src="${gif}" alt="Animación de ${nombre}" onerror="gifNoCarga(this)">`;
}

/** El GIF viene del catálogo por la red: si falla, se dice, no se deja el hueco. */
function gifNoCarga(img) {
  if (img.parentElement) {
    img.parentElement.innerHTML =
      '<div class="tech-gif-err">No se pudo cargar la animación.<br>Vuelve a intentarlo con conexión.</div>';
  }
}

function cerrarVisorTecnica() {
  const ov = document.getElementById('tecnica-overlay');
  if (ov) ov.style.display = 'none';
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════════════════════════════════
   8. TOGGLE FORMULARIO DE SERIE
   ══════════════════════════════════════════════════════════════════ */
function toggleForm(ejId) {
  if (gymOpenForm !== null && gymOpenForm !== ejId) {
    const prev = document.getElementById(`form-${gymOpenForm}`);
    if (prev) prev.style.display = 'none';
  }

  const form = document.getElementById(`form-${ejId}`);
  if (!form) return;

  const isOpen = form.style.display !== 'none';
  form.style.display = isOpen ? 'none' : 'block';
  gymOpenForm = isOpen ? null : ejId;

  if (!isOpen) {
    const pesoInput = document.getElementById(`peso-${ejId}`);
    if (pesoInput) pesoInput.focus();
  }
}

/* ══════════════════════════════════════════════════════════════════
   9. GUARDAR SERIE
   ══════════════════════════════════════════════════════════════════ */
async function guardarSerie(ejId) {
  const pesoEl = document.getElementById(`peso-${ejId}`);
  const repsEl = document.getElementById(`reps-${ejId}`);
  const ej     = gymEj.find(e => e.id === ejId);

  // Dejarlo en blanco repite lo de la última vez, que es lo que se hace
  // casi siempre: el placeholder ya enseña qué valor se va a guardar.
  const conDefecto = (valor, porDefecto) =>
    String(valor ?? '').trim() === '' ? Number(porDefecto) : Number(valor);

  const peso = conDefecto(pesoEl?.value, ej?.ultima?.peso);
  const reps = conDefecto(repsEl?.value, ej?.ultima?.reps);

  if (!peso || peso <= 0 || !reps || reps <= 0) {
    toast('Introduce peso y repeticiones', 'error');
    return;
  }

  const serie_num = (gymSeriesMap[ejId]?.length || 0) + 1;

  try {
    const res = await api(`/sesiones/${gymSesion.id}/series`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ejercicio_id: ejId, serie_num, peso, reps, completada: true })
    });
    if (!res.ok) throw new Error(res.status);
    const nueva = await res.json();

    if (!gymSeriesMap[ejId]) gymSeriesMap[ejId] = [];
    gymSeriesMap[ejId].push(nueva);

    if (pesoEl) pesoEl.value = '';
    if (repsEl) repsEl.value = '';
    gymOpenForm = null;

    /* Actualizar solo la lista de series (preserva la técnica y el scroll) */
    const card = document.getElementById(`ec-${ejId}`);
    if (card) {
      const setsEl = card.querySelector('.sets-list');
      if (setsEl) {
        setsEl.innerHTML = gymSeriesMap[ejId].map((s, i) => `
          <div class="set-row${s.completada ? ' completed' : ''}">
            <span class="set-num">${i + 1}</span>
            <span class="set-val">${s.peso} kg</span>
            <span class="set-val">${s.reps} reps</span>
            <span class="set-chk">${OKICON.check}</span>
          </div>`
        ).join('');
      }
      const formEl = document.getElementById(`form-${ejId}`);
      if (formEl) formEl.style.display = 'none';
    }

    toast(`Serie ${serie_num} guardada.`);
  } catch {
    toast('Error al guardar serie', 'error');
  }
}

/* ══════════════════════════════════════════════════════════════════
   10. COMPLETAR / CANCELAR SESIÓN
   ══════════════════════════════════════════════════════════════════ */
async function completarSesion() {
  if (!confirm('¿Completar sesión de hoy?')) return;

  try {
    const res = await api(`/sesiones/${gymSesion.id}/completar`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({})
    });
    if (!res.ok) throw new Error(res.status);
    gymSesion.completada = true;

    const iet = document.getElementById('iet');
    if (iet) iet.checked = true;

    renderGym();
    toast('DUNGEON CLEARED. Sesión completa.');
  } catch {
    toast('Error al completar sesión', 'error');
  }
}

function cancelarSesion() {
  if (!confirm('¿Cancelar sesión? Los datos guardados se mantienen.')) return;
  gymSesion    = null;
  gymEj        = [];
  gymSeriesMap = {};
  gymOpenForm  = null;
  renderGym();
}

/* ══════════════════════════════════════════════════════════════════
   11. EDITOR DE RUTINAS
   Las rutinas y sus ejercicios venían sembrados por SQL: la app tenía
   los endpoints pero ninguna pantalla, así que cambiar una serie
   obligaba a entrar en la base de datos.
   ══════════════════════════════════════════════════════════════════ */
async function editarRutina(id) {
  gymEditando = id;
  await cargarCatalogo();
  try {
    const res = await api(`/rutinas/${id}/ejercicios`);
    gymEj = res.ok ? await res.json() : [];
  } catch { gymEj = []; }
  renderGym();
}

function salirEditor() {
  gymEditando = null;
  loadGym();
}

const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function renderEditorRutina() {
  const gc = document.getElementById('gym-content');
  if (!gc) return;
  const r = gymRutinas.find(x => x.id === gymEditando);
  if (!r) { salirEditor(); return; }

  const dias = Array.isArray(r.dias) ? r.dias.map(d => String(d).toLowerCase()) : [];

  const filas = gymEj.map((e, i) => {
    const cat = e.dataset_id && _catIdx ? _catIdx.get(e.dataset_id) : null;
    return `
    <div class="ed-ej" id="ed-ej-${e.id}">
      <div class="ed-ej-orden">
        <button onclick="moverEjercicio(${e.id}, -1)" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
        <button onclick="moverEjercicio(${e.id}, 1)" ${i === gymEj.length - 1 ? 'disabled' : ''} aria-label="Bajar">▼</button>
      </div>
      ${cat
        ? `<img class="ed-ej-mini" src="${miniDe(cat)}" alt="" loading="lazy">`
        : `<div class="ed-ej-mini ed-ej-mini-vacia">${OKICON.dumbbell}</div>`}
      <div class="ed-ej-datos">
        <input class="ed-ej-nombre" value="${gesc(e.nombre)}" id="ed-nom-${e.id}"
               onchange="guardarEjercicio(${e.id})" aria-label="Nombre">
        <div class="ed-ej-num">
          <input type="number" id="ed-ser-${e.id}" value="${e.series || 3}" min="1" max="20"
                 inputmode="numeric" onchange="guardarEjercicio(${e.id})" aria-label="Series">
          <span>×</span>
          <input type="text" id="ed-rep-${e.id}" value="${gesc(e.reps_objetivo || '8-12')}"
                 onchange="guardarEjercicio(${e.id})" aria-label="Repeticiones">
          <button class="ed-ej-tec" onclick="elegirEjercicioCatalogo(${e.id})">
            ${cat ? 'CAMBIAR TÉCNICA' : 'SIN TÉCNICA · ELEGIR'}
          </button>
        </div>
      </div>
      <button class="ed-ej-del" onclick="borrarEjercicio(${e.id})" aria-label="Quitar">${OKICON.cross}</button>
    </div>`;
  }).join('');

  gc.innerHTML = `
    <div class="ed-cab">
      <button class="ed-volver" onclick="salirEditor()">← VOLVER</button>
      <button class="ed-borrar-rut" onclick="borrarRutina(${r.id})">BORRAR RUTINA</button>
    </div>

    <div class="card glass-strong ed-ficha">
      <div class="form-field" style="margin-bottom:10px">
        <label>Nombre de la rutina</label>
        <input type="text" id="ed-rut-nombre" value="${gesc(r.nombre)}" onchange="guardarRutina()">
      </div>
      <div class="form-field" style="margin-bottom:10px">
        <label>¿De qué va?</label>
        <input type="text" id="ed-rut-desc" value="${gesc(r.descripcion || '')}"
               placeholder="Pecho · Hombros · Tríceps" onchange="guardarRutina()">
      </div>
      <div class="form-field">
        <label>Días <span class="lbl-hint">marcan qué toca hoy en la misión diaria</span></label>
        <div class="ed-dias">
          ${DIAS_SEMANA.map(d => `
            <button class="ed-dia${dias.includes(d) ? ' on' : ''}" data-dia="${d}"
                    onclick="toggleDia(this)">${d.slice(0, 1).toUpperCase()}${d.slice(1, 3)}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="stl" style="margin:18px 0 10px">EJERCICIOS</div>
    ${filas || '<div class="empty-state">Esta rutina aún no tiene ejercicios.</div>'}
    <button class="bs" style="margin-top:12px" onclick="abrirBuscador()">+ AÑADIR EJERCICIO</button>`;
}

function toggleDia(btn) {
  btn.classList.toggle('on');
  guardarRutina();
}

async function guardarRutina() {
  const r = gymRutinas.find(x => x.id === gymEditando);
  if (!r) return;
  const nombre = document.getElementById('ed-rut-nombre')?.value.trim();
  const desc   = document.getElementById('ed-rut-desc')?.value.trim();
  const dias   = [...document.querySelectorAll('.ed-dia.on')].map(b => b.dataset.dia);
  if (!nombre) { toast('La rutina necesita nombre', 'error'); return; }

  try {
    const res = await api(`/rutinas/${r.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, descripcion: desc, dias })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error guardando');
    }
    Object.assign(r, await res.json());
    toast('Rutina guardada');
  } catch (e) {
    toast(e.message || 'No se pudo guardar', 'error');
  }
}

async function nuevaRutina() {
  const nombre = prompt('Nombre de la rutina (PUSH, PIERNA, CARDIO…):');
  if (!nombre || !nombre.trim()) return;
  try {
    const res = await api('/rutinas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: nombre.trim(), descripcion: '', dias: [] })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Error');
    const r = await res.json();
    gymRutinas.push(r);
    toast('Rutina creada');
    editarRutina(r.id);
  } catch (e) {
    toast(e.message?.includes('duplicate') ? 'Ya existe una rutina con ese nombre' : 'No se pudo crear', 'error');
  }
}

async function borrarRutina(id) {
  const r = gymRutinas.find(x => x.id === id);
  if (!confirm(`¿Borrar la rutina ${r?.nombre || ''} y sus ejercicios?`)) return;
  try {
    const res = await api(`/rutinas/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'No se pudo borrar');
    }
    gymRutinas = gymRutinas.filter(x => x.id !== id);
    toast('Rutina borrada');
    salirEditor();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function guardarEjercicio(id) {
  const nombre = document.getElementById(`ed-nom-${id}`)?.value.trim();
  const series = document.getElementById(`ed-ser-${id}`)?.value;
  const reps   = document.getElementById(`ed-rep-${id}`)?.value.trim();
  if (!nombre) { toast('El ejercicio necesita nombre', 'error'); return; }

  try {
    const res = await api(`/ejercicios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, series, reps_objetivo: reps })
    });
    if (!res.ok) throw new Error('Error');
    const act = await res.json();
    const i = gymEj.findIndex(e => e.id === id);
    if (i >= 0) gymEj[i] = { ...gymEj[i], ...act };
    toast('Guardado');
  } catch {
    toast('No se pudo guardar', 'error');
  }
}

async function borrarEjercicio(id) {
  const e = gymEj.find(x => x.id === id);
  if (!confirm(`¿Quitar ${e?.nombre || 'el ejercicio'} de la rutina?`)) return;
  try {
    const res = await api(`/ejercicios/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error');
    const r = await res.json();
    gymEj = gymEj.filter(x => x.id !== id);
    renderGym();
    toast(r.archivado
      ? `Quitado. Sus ${r.series} series siguen contando en el historial.`
      : 'Ejercicio quitado');
  } catch {
    toast('No se pudo quitar', 'error');
  }
}

async function moverEjercicio(id, delta) {
  const i = gymEj.findIndex(e => e.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= gymEj.length) return;
  [gymEj[i], gymEj[j]] = [gymEj[j], gymEj[i]];
  renderGym();
  try {
    await api(`/rutinas/${gymEditando}/orden`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: gymEj.map(e => e.id) })
    });
  } catch {
    toast('El orden no se guardó', 'error');
  }
}

/* ══════════════════════════════════════════════════════════════════
   12. BUSCADOR DEL CATÁLOGO
   1.324 ejercicios con nombre en español, animación y músculos.
   ══════════════════════════════════════════════════════════════════ */
let _buscadorDestino = null;   // {modo:'añadir'|'vincular', ejId?}

async function abrirBuscador() {
  _buscadorDestino = { modo: 'anadir' };
  await mostrarBuscador('Añadir ejercicio a la rutina');
}

async function elegirEjercicioCatalogo(ejId) {
  _buscadorDestino = { modo: 'vincular', ejId };
  const ej = gymEj.find(e => e.id === ejId);
  await mostrarBuscador('Elegir la técnica', ej?.nombre || '');
}

async function mostrarBuscador(titulo, textoInicial = '') {
  const ov   = document.getElementById('buscador-overlay');
  const body = document.getElementById('buscador-body');
  if (!ov || !body) return;

  ov.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  body.innerHTML = `
    <div class="tec-cab">
      <h3 class="tec-titulo">${gesc(titulo)}</h3>
      <button class="tec-cerrar" onclick="cerrarBuscador()" aria-label="Cerrar">${OKICON.cross}</button>
    </div>
    <input type="search" id="busc-input" class="busc-input" placeholder="press banca, dominada, sentadilla…"
           autocomplete="off" oninput="buscarEjercicios(this.value)">
    <div class="busc-res" id="busc-res"></div>`;

  await cargarCatalogo();
  const input = document.getElementById('busc-input');
  if (input) {
    input.value = textoInicial;
    setTimeout(() => input.focus(), 80);
  }
  buscarEjercicios(textoInicial);
}

function cerrarBuscador() {
  const ov = document.getElementById('buscador-overlay');
  if (ov) ov.style.display = 'none';
  document.body.style.overflow = '';
  _buscadorDestino = null;
}

function buscarEjercicios(q) {
  const cont = document.getElementById('busc-res');
  if (!cont || !_cat) return;

  const term = norm(q);
  let lista;
  if (!term) {
    // Sin escribir nada: los básicos. Por orden del catálogo salían cosas
    // como "3/4 abdominal" o "air bike", que no es por donde empieza nadie.
    lista = _cat.filter(c => c.b);
  } else {
    const pal = term.split(' ').filter(Boolean);
    lista = _cat
      .map(c => {
        const es = norm(c.n), en = norm(c.en), alias = c.k ? norm(c.k) : '';
        let punt = 0;
        for (const p of pal) {
          if (es.startsWith(p)) punt += 4;
          else if (es.includes(p)) punt += 3;
          else if (alias.includes(p)) punt += 3;   // "face pull", "hip thrust"…
          else if (en.includes(p)) punt += 2;
          else return null;          // toda palabra tiene que aparecer
        }
        if (c.b) punt += 1.5;                      // a igualdad, gana el básico
        return { c, punt: punt - c.n.length * 0.01 };   // y luego el nombre más corto
      })
      .filter(Boolean)
      .sort((a, b) => b.punt - a.punt)
      .slice(0, 60)
      .map(x => x.c);
  }

  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state">Ningún ejercicio con ese nombre.</div>';
    return;
  }

  cont.innerHTML = lista.map(c => `
    <div class="busc-item">
      <img class="busc-mini" src="${miniDe(c)}" alt="" loading="lazy">
      <div class="busc-datos" onclick="verTecnicaCatalogo('${c.id}')">
        <div class="busc-nom">${gesc(c.n)}</div>
        <div class="busc-meta">${gesc(c.t)}${c.eq ? ' · ' + gesc(c.eq) : ''}</div>
      </div>
      <button class="busc-add" onclick="elegirDelCatalogo('${c.id}')">${
        _buscadorDestino?.modo === 'vincular' ? 'ELEGIR' : '+'
      }</button>
    </div>`).join('');
}

function verTecnicaCatalogo(id) {
  const c = _catIdx?.get(id);
  if (c) abrirVisorTecnica(c, c.n);
}

async function elegirDelCatalogo(datasetId) {
  const c = _catIdx?.get(datasetId);
  if (!c || !_buscadorDestino) return;

  try {
    if (_buscadorDestino.modo === 'vincular') {
      const res = await api(`/ejercicios/${_buscadorDestino.ejId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: datasetId })
      });
      if (!res.ok) throw new Error('Error');
      const act = await res.json();
      const i = gymEj.findIndex(e => e.id === _buscadorDestino.ejId);
      if (i >= 0) gymEj[i] = { ...gymEj[i], ...act };
      toast('Técnica enlazada');
    } else {
      const res = await api('/ejercicios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rutina_id: gymEditando,
          nombre: c.n,
          series: 3,
          reps_objetivo: '8-12',
          dataset_id: datasetId
        })
      });
      if (!res.ok) throw new Error('Error');
      gymEj.push(await res.json());
      toast(`${c.n} añadido`);
    }
    cerrarBuscador();
    renderGym();
  } catch {
    toast('No se pudo guardar', 'error');
  }
}

/* ══════════════════════════════════════════════════════════════════
   13. RENDER SESIÓN COMPLETADA — DUNGEON CLEARED
   ══════════════════════════════════════════════════════════════════ */
function renderSesionDone() {
  const gc = document.getElementById('gym-content');
  if (!gc) return;

  /* Calcular estadísticas */
  let totalVol = 0;
  const ejStats = gymEj
    .map(e => {
      const series = gymSeriesMap[e.id] || [];
      const vol    = series.reduce((acc, s) => acc + (s.peso || 0) * (s.reps || 0), 0);
      totalVol += vol;
      return { ...e, series, vol };
    })
    .filter(e => e.series.length > 0);

  const totalSeries     = ejStats.reduce((a, e) => a + e.series.length, 0);
  const totalEjercicios = ejStats.length;

  const fecha = gymSesion?.fecha
    ? new Date(gymSesion.fecha)
        .toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
        .toUpperCase()
    : '';

  const rutinaNombre = gymSesion?.rutina_nombre
    || gymRutinas.find(r => r.id === gymSesion?.rutina_id)?.nombre
    || '';

  /* ── Stat de volumen ── */
  const volLabel = totalVol >= 1000
    ? `${(totalVol / 1000).toFixed(1)}T`
    : `${totalVol.toFixed(0)}kg`;

  /* ── Cards de ejercicios ── */
  const summaryHTML = ejStats.map(e => {
    const pills = e.series.map(s =>
      `<span class="done-set-pill">${s.peso}kg×${s.reps}</span>`
    ).join('');
    const volStr = e.vol > 0
      ? `<div class="done-ej-vol">${e.vol.toFixed(0)} kg vol.</div>`
      : '';
    return `
      <div class="done-ej-card">
        <div class="done-ej-name">${gesc(e.nombre)}</div>
        <div class="done-ej-sets">${pills}</div>
        ${volStr}
      </div>`;
  }).join('');

  /* ── Gráfico de barras CSS ── */
  const maxSeries = Math.max(...ejStats.map(e => e.series.length), 1);
  const barsHTML  = ejStats.length
    ? `<div class="done-chart">
        <div class="done-chart-title">SERIES POR EJERCICIO</div>
        <div class="done-bars">
          ${ejStats.map(e => {
            const h     = Math.round((e.series.length / maxSeries) * 100);
            const label = (e.nombre || '').split(' ').slice(0, 2).join(' ');
            return `
              <div class="done-bar-col">
                <div class="done-bar-val">${e.series.length}</div>
                <div class="done-bar-track">
                  <div class="done-bar-fill" style="height:0%" data-h="${h}%"></div>
                </div>
                <div class="done-bar-label">${gesc(label)}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`
    : '';

  gc.innerHTML = `
    <div class="gym-done-card">
      <div class="dungeon-cleared">DUNGEON CLEARED</div>
      <p class="done-sub">${gesc(rutinaNombre ? rutinaNombre + ' · ' : '')}${fecha}</p>
      <div class="done-stats-row">
        <div class="done-stat">
          <div class="done-stat-val">${totalSeries}</div>
          <div class="done-stat-lbl">SERIES</div>
        </div>
        <div class="done-stat">
          <div class="done-stat-val">${totalEjercicios}</div>
          <div class="done-stat-lbl">EJERCICIOS</div>
        </div>
        ${totalVol > 0 ? `
        <div class="done-stat">
          <div class="done-stat-val">${volLabel}</div>
          <div class="done-stat-lbl">VOLUMEN</div>
        </div>` : ''}
      </div>
    </div>

    ${ejStats.length ? `
    <div class="done-exercises-wrap">
      <div class="done-section-title">RESUMEN DE EJERCICIOS</div>
      ${summaryHTML}
    </div>` : ''}

    ${barsHTML}`;

  /* Animar barras tras el paint */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    gc.querySelectorAll('.done-bar-fill').forEach(el => {
      el.style.height = el.dataset.h;
    });
  }));
}

/* ══════════════════════════════════════════════════════════════════
   14. HISTORIAL GYM
   ══════════════════════════════════════════════════════════════════ */
function toggleGymHistory() {
  gymHistoryVisible = !gymHistoryVisible;
  const btn = document.getElementById('gym-hist-btn');
  const sec = document.getElementById('gym-history-section');
  if (btn) btn.textContent = gymHistoryVisible ? '▲ OCULTAR HISTORIAL' : '▼ VER HISTORIAL';
  if (sec) {
    sec.style.display = gymHistoryVisible ? 'block' : 'none';
    if (gymHistoryVisible) loadGymHistory();
  }
}

async function loadGymHistory() {
  const sec = document.getElementById('gym-history-section');
  if (!sec) return;
  sec.innerHTML = '<div class="empty-state" style="padding:16px 0">Cargando...</div>';

  try {
    const res      = await api('/sesiones');
    const sessions = res.ok ? await res.json() : [];

    if (!Array.isArray(sessions) || !sessions.length) {
      sec.innerHTML = '<div class="empty-state" style="padding:16px 0">Sin sesiones registradas</div>';
      return;
    }

    sec.innerHTML = sessions.slice(0, 20).map(s => {
      const fecha = s.fecha
        ? new Date(s.fecha)
            .toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
            .toUpperCase()
        : '—';
      const rutinaNombre = s.rutina_nombre || `Rutina #${s.rutina_id || '?'}`;
      const series       = Array.isArray(s.series) ? s.series : [];
      const totalSeries  = series.length || s.total_series || '?';

      let detailHTML = '';
      if (series.length) {
        const byEj = {};
        series.forEach(sr => {
          const key = sr.ejercicio_id;
          if (!byEj[key]) byEj[key] = { nombre: sr.ejercicio_nombre || `Ej. ${key}`, sets: [] };
          byEj[key].sets.push(`${sr.peso}kg×${sr.reps}`);
        });
        detailHTML = Object.values(byEj).map(ej => `
          <div class="gh-exercise">
            <span class="gh-ej-name">${gesc(ej.nombre)}</span>
            <span class="gh-ej-sets">${gesc(ej.sets.join(' · '))}</span>
          </div>`).join('');
      }

      return `<div class="gh-item" onclick="this.querySelector('.gh-detail').classList.toggle('open')">
  <div class="gh-row">
    <span class="gh-date">${fecha}</span>
    <span class="gh-rutina">${gesc(rutinaNombre)}</span>
    <span class="gh-series">${totalSeries} SERIES</span>
  </div>
  <div class="gh-detail">${detailHTML || '<span style="color:var(--text-4);font-size:11px">Sin detalle disponible</span>'}</div>
</div>`;
    }).join('');

  } catch {
    sec.innerHTML = '<div class="empty-state" style="padding:16px 0">Error cargando historial</div>';
  }
}

/* ══════════════════════════════════════════════════════════════════
   15. COMPOSICIÓN CORPORAL
   ══════════════════════════════════════════════════════════════════
   Entrenar no es progresar. Hasta aquí OKIRO sabía si habías ido al
   gimnasio, pero no si estabas recuperando la masa que perdiste, que es
   el motivo por el que existe. Los proyectos con fuente de composición
   leen de estas medidas.                                             */
let _medidasAbierto = false;

function _delta(actual, previo, unidad, masEsMejor = true) {
  if (actual == null || previo == null) return '';
  const d = Number(actual) - Number(previo);
  if (Math.abs(d) < 0.05) return '<span class="mc-igual">igual</span>';
  const bueno = masEsMejor ? d > 0 : d < 0;
  const signo = d > 0 ? '+' : '';
  return `<span class="${bueno ? 'mc-sube' : 'mc-baja'}">${signo}${d.toFixed(1)}${unidad}</span>`;
}

async function renderMedidas() {
  const gc = document.getElementById('gym-content');
  if (!gc) return;

  let ultima = null, previa = null;
  try {
    const res  = await api('/medidas');
    const data = res.ok ? await res.json() : [];
    ultima = data[0] || null;
    previa = data[1] || null;
  } catch { /* sin medidas todavía: la tarjeta sale vacía, no rota */ }

  const dato = (val, unidad, etiqueta, prev, masEsMejor) => `
    <div class="mc-dato">
      <div class="mc-val">${val != null ? Number(val).toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '—'}<span class="mc-un">${val != null ? unidad : ''}</span></div>
      <div class="mc-lbl">${etiqueta} ${_delta(val, prev, unidad, masEsMejor)}</div>
    </div>`;

  const fecha = ultima
    ? new Date(ultima.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
    : null;

  // Pedir las medidas tarda, y para entonces el historial ya se ha insertado:
  // se coloca antes de él, y nunca dos veces si se vuelve a la pestaña.
  gc.querySelectorAll('.mc-wrap').forEach(el => el.remove());
  const hist  = document.getElementById('gym-hist-wrap');
  const donde = hist ? [hist, 'beforebegin'] : [gc, 'beforeend'];

  donde[0].insertAdjacentHTML(donde[1], `
<div class="mc-wrap">
  <div class="stl" style="margin:18px 0 10px">CUERPO</div>
  <div class="card glass-strong mc-card">
    ${ultima ? `
    <div class="mc-datos">
      ${dato(ultima.masa_muscular, ' kg', 'músculo', previa?.masa_muscular, true)}
      ${dato(ultima.grasa_pct,     '%',   'grasa',   previa?.grasa_pct,     false)}
      ${dato(ultima.peso,          ' kg', 'peso',    previa?.peso,          true)}
    </div>
    <div class="mc-fecha">última medida: ${fecha}</div>`
    : '<div class="mc-vacio">Sin medidas todavía. Sin esto, "volver a mi mejor versión" no tiene número.</div>'}
    <div id="mc-form" class="mc-form${_medidasAbierto ? ' open' : ''}">
      <div class="form-row">
        <div class="form-field"><label>Músculo (kg)</label><input id="mc-masa" type="number" step="0.1" inputmode="decimal" placeholder="${ultima?.masa_muscular ?? '0'}"></div>
        <div class="form-field"><label>Grasa (%)</label><input id="mc-grasa" type="number" step="0.1" inputmode="decimal" placeholder="${ultima?.grasa_pct ?? '0'}"></div>
      </div>
      <div class="form-field" style="margin-bottom:10px"><label>Peso (kg)</label><input id="mc-peso" type="number" step="0.1" inputmode="decimal" placeholder="${ultima?.peso ?? '0'}"></div>
      <button class="bs" onclick="guardarMedida()">GUARDAR MEDIDA</button>
    </div>
    <button class="bu mc-btn" onclick="toggleMedidaForm()">${_medidasAbierto ? 'CANCELAR' : 'APUNTAR MEDIDA'}</button>
  </div>
</div>`);
}

function toggleMedidaForm() {
  _medidasAbierto = !_medidasAbierto;
  document.getElementById('mc-form')?.classList.toggle('open', _medidasAbierto);
  const btn = document.querySelector('.mc-btn');
  if (btn) btn.textContent = _medidasAbierto ? 'CANCELAR' : 'APUNTAR MEDIDA';
  if (_medidasAbierto) setTimeout(() => document.getElementById('mc-masa')?.focus(), 60);
}

async function guardarMedida() {
  const val = id => document.getElementById(id)?.value.trim() || '';
  const body = { masa_muscular: val('mc-masa'), grasa_pct: val('mc-grasa'), peso: val('mc-peso') };
  if (!body.masa_muscular && !body.grasa_pct && !body.peso) {
    toast('Apunta al menos un dato', 'error');
    return;
  }
  try {
    const res = await api('/medidas', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error guardando');
    }
    _medidasAbierto = false;
    toast('Medida guardada');
    // Los proyectos que se miden por composición cambian con esto.
    document.querySelector('.mc-wrap')?.remove();
    renderMedidas();
  } catch (e) {
    toast(e.message || 'Error guardando la medida', 'error');
  }
}
