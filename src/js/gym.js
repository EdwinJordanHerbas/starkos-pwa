// OkiroSport — Lógica de Gym y Entrenamientos (v2 Enhanced)

/* ── ESTADO ─────────────────────────────────────────────────────── */
let gymRutinas        = [];
let gymSesion         = null;
let gymEj             = [];
let gymSeriesMap      = {};
let gymOpenForm       = null;
let gymHistoryVisible = false;
const gymTechLoaded   = {};   // ejId → true si ya se cargó la técnica

/* ══════════════════════════════════════════════════════════════════
   DATASET DE EJERCICIOS (hasaneyldrm/exercises-dataset)
   ══════════════════════════════════════════════════════════════════ */
const GYM_GIF_BASE = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/gifs/';
const GYM_JSON_URL = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json';

/** Mapeo: nombre español (lowercase) → término de búsqueda en inglés */
const GYM_ES_EN = {
  'press banca plano':          'barbell bench press',
  'press inclinado mancuerna':  'incline dumbbell press',
  'fondos en paralelas':        'chest dip',
  'press militar barra':        'barbell overhead press',
  'elevaciones laterales':      'dumbbell lateral raise',
  'extensión tríceps polea':    'cable triceps pushdown',
  'extension triceps polea':    'cable triceps pushdown',
  'dominadas':                  'pull-up',
  'remo con barra':             'barbell bent over row',
  'remo en polea baja':         'seated cable row',
  'face pulls':                 'cable face pull',
  'curl bíceps barra':          'barbell curl',
  'curl biceps barra':          'barbell curl',
  'curl martillo':              'dumbbell hammer curl',
  'sentadilla libre':           'barbell squat',
  'prensa de piernas':          'leg press',
  'zancadas mancuernas':        'dumbbell lunge',
  'curl femoral':               'lying leg curl',
  'hip thrust':                 'barbell hip thrust',
  'gemelos en máquina':         'calf press',
  'gemelos en maquina':         'calf press',
};

let _gymDs        = null;   // { name_lower → exercise }
let _gymDsPromise = null;

/** Carga el dataset una sola vez y construye el índice por nombre. */
async function loadGymDataset() {
  if (_gymDs)        return _gymDs;
  if (_gymDsPromise) return _gymDsPromise;

  _gymDsPromise = fetch(GYM_JSON_URL)
    .then(r => (r.ok ? r.json() : []))
    .then(arr => {
      _gymDs = {};
      arr.forEach(ex => { _gymDs[ex.name.toLowerCase()] = ex; });
      return _gymDs;
    })
    .catch(() => { _gymDs = {}; return _gymDs; });

  return _gymDsPromise;
}

/** Busca un ejercicio en el dataset por nombre español. */
function findDatasetEx(nombreES) {
  if (!_gymDs) return null;
  const en = GYM_ES_EN[nombreES.toLowerCase()];
  if (!en) return null;

  // Coincidencia exacta
  if (_gymDs[en]) return _gymDs[en];

  // Coincidencia parcial
  const enL = en.toLowerCase();
  for (const [k, v] of Object.entries(_gymDs)) {
    if (k.includes(enL) || enL.includes(k)) return v;
  }
  return null;
}

/** Extrae músculo objetivo — admite distintos nombres de campo. */
function dsTarget(ex) {
  return ex.target_muscle || ex.target || ex.body_part || ex.category || '';
}

/** Extrae músculos secundarios como array. */
function dsSecondary(ex) {
  const s = ex.secondary_muscles || ex.secondaryMuscles || ex.secondary || [];
  return Array.isArray(s) ? s : [];
}

/** Extrae pasos de instrucciones (array de strings). */
function dsSteps(ex) {
  const st = ex.instruction_steps?.en || ex.instructions_steps?.en;
  if (Array.isArray(st) && st.length) return st;
  const instr = ex.instructions;
  if (Array.isArray(instr)) return instr;
  if (instr && typeof instr === 'object' && instr.en) return [instr.en];
  return [];
}

/** Callback de error en img del GIF. */
function gymGifError(img, nombre) {
  if (img.parentElement) {
    img.parentElement.innerHTML =
      `<div class="tech-gif-err">🏋️<br><small>${nombre}</small></div>`;
  }
}

/* ══════════════════════════════════════════════════════════════════
   1. CARGAR
   ══════════════════════════════════════════════════════════════════ */
async function loadGym() {
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

  renderGym();
}

/* ══════════════════════════════════════════════════════════════════
   2. RENDER PRINCIPAL
   ══════════════════════════════════════════════════════════════════ */
function renderGym() {
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
    gc.innerHTML = '<div class="empty-state">No hay rutinas configuradas.<br>Ejecuta la migración de la base de datos.</div>';
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
      <div class="rc"${bg} onclick="iniciarSesion(${r.id})">
        <div class="rn">${r.nombre || ''}</div>
        <div class="rd">${r.descripcion || ''}</div>
      </div>`;
    }).join('');

  renderGymObjectives();
}

const GYM_ICONS = { 'PUSH': '💪', 'PULL': '🔄', 'LEGS': '🦵' };
const GYM_BANNERS = { 'PUSH': 'assets/gym-push.png', 'PULL': 'assets/gym-pull.png', 'LEGS': 'assets/gym-legs.png' };

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
      const icon        = GYM_ICONS[(r.nombre || '').toUpperCase()] || '🏋️';

      return `
        <div class="gym-obj-card">
          <div class="gym-obj-header">
            <span class="gym-obj-icon">${icon}</span>
            <div class="gym-obj-info">
              <div class="gym-obj-name">${r.nombre}</div>
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
    renderGym();
    toast('Sesión iniciada — a por ello 💪');

    /* Pre-cargar dataset en background */
    loadGymDataset();
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
    <div class="stl">${rutinaNombre}</div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="bs" style="flex:1" onclick="completarSesion()">COMPLETAR SESIÓN</button>
      <button class="rb" style="flex:0 0 auto;padding:0 14px;height:48px;cursor:pointer;font-family:var(--font-sans);font-size:11px" onclick="cancelarSesion()">CANCELAR</button>
    </div>`;

  const cards = gymEj.map(e => renderEjercicioCard(e)).join('');
  gc.innerHTML = header + cards;

  /* Pre-cargar dataset silently para tener GIFs listos */
  loadGymDataset();
}

/* ══════════════════════════════════════════════════════════════════
   6. CARD DE EJERCICIO
   ══════════════════════════════════════════════════════════════════ */
function renderEjercicioCard(e) {
  const series = gymSeriesMap[e.id] || [];

  const filas = series.map((s, i) => `
    <div class="set-row${s.completada ? ' completed' : ''}">
      <span class="set-num">${i + 1}</span>
      <span class="set-val">${s.peso} kg</span>
      <span class="set-val">${s.reps} reps</span>
      <span class="set-chk">✓</span>
    </div>`
  ).join('');

  return `
    <div class="ec" id="ec-${e.id}">
      <div class="en">${e.nombre || ''}</div>
      <div class="er2">${e.series || '?'}×${e.reps_objetivo || '?'}</div>

      <!-- ── SECCIÓN TÉCNICA ────────────────────────────────── -->
      <div class="ej-technique">
        <button class="tech-toggle-btn" id="tech-btn-${e.id}"
                onclick="toggleTechnique(${e.id})">▶ VER TÉCNICA</button>
        <div class="tech-detail" id="tech-detail-${e.id}" style="display:none"></div>
      </div>

      <div class="sets-list">${filas}</div>

      <div style="display:flex;justify-content:flex-end;margin-top:8px">
        <button class="add-set-btn" onclick="toggleForm(${e.id})">+ SERIE</button>
      </div>

      <div class="add-set-form" id="form-${e.id}" style="display:none">
        <div class="lbl">PESO KG</div>
        <input type="number" id="peso-${e.id}" placeholder="Peso kg" min="0" step="0.5" inputmode="decimal">
        <div class="lbl" style="margin-top:6px">REPS</div>
        <input type="number" id="reps-${e.id}" placeholder="Reps" min="0" step="1" inputmode="numeric">
        <button class="save-set-btn" style="margin-top:8px;width:100%"
                onclick="guardarSerie(${e.id})">GUARDAR</button>
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   7. TÉCNICA: TOGGLE
   ══════════════════════════════════════════════════════════════════ */
function toggleTechnique(ejId) {
  const detail = document.getElementById(`tech-detail-${ejId}`);
  const btn    = document.getElementById(`tech-btn-${ejId}`);
  if (!detail) return;

  const wasOpen = detail.style.display !== 'none';
  detail.style.display = wasOpen ? 'none' : 'block';

  if (btn) {
    btn.textContent = wasOpen ? '▶ VER TÉCNICA' : '▼ OCULTAR TÉCNICA';
    btn.classList.toggle('open', !wasOpen);
  }

  /* Cargar contenido la primera vez que se abre */
  if (!wasOpen && !gymTechLoaded[ejId]) {
    gymTechLoaded[ejId] = true;
    const ej = gymEj.find(e => e.id === ejId);
    if (ej) injectTechniqueContent(ejId, ej.nombre);
  }
}

/* ══════════════════════════════════════════════════════════════════
   8. TÉCNICA: INYECTAR CONTENIDO
   ══════════════════════════════════════════════════════════════════ */
async function injectTechniqueContent(ejId, nombreES) {
  const detail = document.getElementById(`tech-detail-${ejId}`);
  if (!detail) return;

  detail.innerHTML = '<div class="tech-loading">Buscando ejercicio…</div>';

  await loadGymDataset();
  const ex = findDatasetEx(nombreES);

  if (!ex) {
    detail.innerHTML = `
      <div class="tech-placeholder">
        <div class="tech-placeholder-icon">🏋️</div>
        <div class="tech-placeholder-text">${nombreES}</div>
      </div>`;
    return;
  }

  const target    = dsTarget(ex);
  const secondary = dsSecondary(ex);
  const steps     = dsSteps(ex);

  const badgesHTML = [
    target ? `<span class="muscle-badge primary">${target}</span>` : '',
    ...secondary.slice(0, 4).map(m => `<span class="muscle-badge secondary">${m}</span>`)
  ].join('');

  const instrHTML = steps.length
    ? `<button class="tech-instr-btn" id="tech-instr-btn-${ejId}"
               onclick="toggleTechInstr(${ejId})">📋 VER INSTRUCCIONES</button>
       <ol class="tech-instructions" id="tech-instr-${ejId}" style="display:none">
         ${steps.map(s => `<li>${s}</li>`).join('')}
       </ol>`
    : '';

  const escapedNombre = nombreES.replace(/'/g, "\\'");

  detail.innerHTML = `
    <div class="tech-gif-wrap">
      <img class="tech-gif"
           src="${GYM_GIF_BASE}${ex.id}.gif"
           alt="${nombreES}"
           loading="lazy"
           onerror="gymGifError(this, '${escapedNombre}')">
    </div>
    ${badgesHTML ? `<div class="tech-muscles">${badgesHTML}</div>` : ''}
    ${instrHTML}`;
}

/* ══════════════════════════════════════════════════════════════════
   9. TÉCNICA: TOGGLE INSTRUCCIONES
   ══════════════════════════════════════════════════════════════════ */
function toggleTechInstr(ejId) {
  const el  = document.getElementById(`tech-instr-${ejId}`);
  const btn = document.getElementById(`tech-instr-btn-${ejId}`);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? '📋 VER INSTRUCCIONES' : '📋 OCULTAR INSTRUCCIONES';
}

/* ══════════════════════════════════════════════════════════════════
   10. TOGGLE FORMULARIO DE SERIE
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
   11. GUARDAR SERIE
   ══════════════════════════════════════════════════════════════════ */
async function guardarSerie(ejId) {
  const pesoEl = document.getElementById(`peso-${ejId}`);
  const repsEl = document.getElementById(`reps-${ejId}`);

  const peso = parseFloat(pesoEl?.value);
  const reps = parseInt(repsEl?.value);

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

    /* Actualizar solo la lista de series (preserva la sección de técnica abierta) */
    const card = document.getElementById(`ec-${ejId}`);
    if (card) {
      const setsEl = card.querySelector('.sets-list');
      if (setsEl) {
        setsEl.innerHTML = gymSeriesMap[ejId].map((s, i) => `
          <div class="set-row${s.completada ? ' completed' : ''}">
            <span class="set-num">${i + 1}</span>
            <span class="set-val">${s.peso} kg</span>
            <span class="set-val">${s.reps} reps</span>
            <span class="set-chk">✓</span>
          </div>`
        ).join('');
      }
      const formEl = document.getElementById(`form-${ejId}`);
      if (formEl) formEl.style.display = 'none';
    }

    toast(`Serie ${serie_num} guardada ✓`);
  } catch {
    toast('Error al guardar serie', 'error');
  }
}

/* ══════════════════════════════════════════════════════════════════
   12. COMPLETAR SESIÓN
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
    toast('Dungeon cleared 🏆');
  } catch {
    toast('Error al completar sesión', 'error');
  }
}

/* ══════════════════════════════════════════════════════════════════
   13. CANCELAR SESIÓN
   ══════════════════════════════════════════════════════════════════ */
function cancelarSesion() {
  if (!confirm('¿Cancelar sesión? Los datos guardados se mantienen.')) return;
  gymSesion    = null;
  gymEj        = [];
  gymSeriesMap = {};
  gymOpenForm  = null;
  renderGym();
}

/* ══════════════════════════════════════════════════════════════════
   14. RENDER SESIÓN COMPLETADA — DUNGEON CLEARED ENHANCED
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
        <div class="done-ej-name">${e.nombre}</div>
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
                <div class="done-bar-label">${label}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`
    : '';

  gc.innerHTML = `
    <div class="gym-done-card">
      <div class="dungeon-cleared">DUNGEON CLEARED</div>
      <p class="done-sub">${rutinaNombre ? rutinaNombre + ' · ' : ''}${fecha}</p>
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
   15. HISTORIAL GYM
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
            <span class="gh-ej-name">${ej.nombre}</span>
            <span class="gh-ej-sets">${ej.sets.join(' · ')}</span>
          </div>`).join('');
      }

      return `<div class="gh-item" onclick="this.querySelector('.gh-detail').classList.toggle('open')">
  <div class="gh-row">
    <span class="gh-date">${fecha}</span>
    <span class="gh-rutina">${rutinaNombre}</span>
    <span class="gh-series">${totalSeries} SERIES</span>
  </div>
  <div class="gh-detail">${detailHTML || '<span style="color:var(--text-4);font-size:11px">Sin detalle disponible</span>'}</div>
</div>`;
    }).join('');

  } catch {
    sec.innerHTML = '<div class="empty-state" style="padding:16px 0">Error cargando historial</div>';
  }
}
