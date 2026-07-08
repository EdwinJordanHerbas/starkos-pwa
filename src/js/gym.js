// OkiroSport — Lógica de Gym y Entrenamientos

/* ── ESTADO ─────────────────────────────────────────────────────── */
let gymRutinas   = [];
let gymSesion    = null;
let gymEj        = [];
let gymSeriesMap = {};
let gymOpenForm  = null;

/* ── 1. CARGAR ──────────────────────────────────────────────────── */
async function loadGym() {
  try {
    const [rutiRes, sesRes] = await Promise.all([
      api('/rutinas'),
      api('/sesiones/hoy')
    ]);

    gymRutinas = rutiRes.ok ? await rutiRes.json() : [];
    gymSesion  = sesRes.ok  ? await sesRes.json()  : null;

    /* Sin sesión hoy → selector de rutinas */
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

/* ── 2. RENDER PRINCIPAL ────────────────────────────────────────── */
function renderGym() {
  if (gymSesion && gymSesion.completada === true) {
    renderSesionDone();
  } else if (gymSesion) {
    renderSesionActiva();
  } else {
    renderRutinaSelect();
  }
}

/* ── 3. SELECCIÓN DE RUTINA ─────────────────────────────────────── */
function renderRutinaSelect() {
  const gc = document.getElementById('gym-content');
  if (!gc) return;

  if (!gymRutinas.length) {
    gc.innerHTML = '<div class="empty-state">No hay rutinas configuradas.<br>Ejecuta la migración de la base de datos.</div>';
    return;
  }

  gc.innerHTML = '<div class="stl" style="margin-bottom:10px">ELIGE RUTINA DE HOY</div>' +
    gymRutinas.map(r => `
    <div class="rc" onclick="iniciarSesion(${r.id})">
      <div class="rn">${r.nombre || ''}</div>
      <div class="rd">${r.descripcion || ''}</div>
    </div>`
  ).join('');
}

/* ── 4. INICIAR SESIÓN ──────────────────────────────────────────── */
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
  } catch {
    toast('Error al iniciar sesión', 'error');
  }
}

/* ── 5. RENDER SESIÓN ACTIVA ────────────────────────────────────── */
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
}

/* ── 6. CARD DE EJERCICIO ───────────────────────────────────────── */
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
      <div class="sets-list">${filas}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px">
        <button class="add-set-btn" onclick="toggleForm(${e.id})">+ SERIE</button>
      </div>
      <div class="add-set-form" id="form-${e.id}" style="display:none">
        <div class="lbl">PESO KG</div>
        <input type="number" id="peso-${e.id}" placeholder="Peso kg" min="0" step="0.5" inputmode="decimal">
        <div class="lbl" style="margin-top:6px">REPS</div>
        <input type="number" id="reps-${e.id}" placeholder="Reps" min="0" step="1" inputmode="numeric">
        <button class="save-set-btn" style="margin-top:8px;width:100%" onclick="guardarSerie(${e.id})">GUARDAR</button>
      </div>
    </div>`;
}

/* ── 7. TOGGLE FORMULARIO ───────────────────────────────────────── */
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

/* ── 8. GUARDAR SERIE ───────────────────────────────────────────── */
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

    const ejercicio = gymEj.find(e => e.id === ejId);
    if (ejercicio) {
      const oldCard = document.getElementById(`ec-${ejId}`);
      if (oldCard) {
        oldCard.outerHTML = renderEjercicioCard(ejercicio);
      }
    }
  } catch {
    toast('Error al guardar serie', 'error');
  }
}

/* ── 9. COMPLETAR SESIÓN ────────────────────────────────────────── */
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

    /* Marca también el entreno en HOY */
    const iet = document.getElementById('iet');
    if (iet) iet.checked = true;

    renderGym();
    toast('Dungeon cleared 🏆');
  } catch {
    toast('Error al completar sesión', 'error');
  }
}

/* ── 10. CANCELAR SESIÓN ────────────────────────────────────────── */
function cancelarSesion() {
  if (!confirm('¿Cancelar sesión? Los datos guardados se mantienen.')) return;
  gymSesion    = null;
  gymEj        = [];
  gymSeriesMap = {};
  gymOpenForm  = null;
  renderGym();
}

/* ── 11. RENDER SESIÓN COMPLETADA ───────────────────────────────── */
function renderSesionDone() {
  const gc = document.getElementById('gym-content');
  if (!gc) return;

  const totalSeries   = Object.values(gymSeriesMap).reduce((acc, arr) => acc + arr.length, 0);
  const totalEjercicios = Object.keys(gymSeriesMap).length;

  const fecha = gymSesion?.fecha
    ? new Date(gymSesion.fecha).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
    : '';

  gc.innerHTML = `
    <div class="gym-done-card">
      <div class="dungeon-cleared">DUNGEON CLEARED</div>
      <p style="font-family:var(--font-sans);color:var(--success);margin-top:12px">
        SESIÓN COMPLETADA · ${fecha}
      </p>
      <p style="font-family:var(--font-sans);color:var(--text-3);font-size:11px;margin-top:8px">
        ${totalSeries} SERIES · ${totalEjercicios} EJERCICIOS
      </p>
    </div>`;
}
