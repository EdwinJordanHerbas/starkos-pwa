// OkiroSport — Init, API, Reloj, Navegación, Estado Global

/* ── 1. CONSTANTES ──────────────────────────────────────────────── */
const A          = '';
const DIAS       = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const DIAS_LABEL = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
let currentViewDate = new Date();
const currentViewISO = () => {
  const d = currentViewDate;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

/* ── 2. API ─────────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const token = localStorage.getItem('okiro_token');
  opts.headers = Object.assign({}, opts.headers || {});
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(A + path, opts);
  if (res.status === 401) {
    showLock();
    throw new Error('401');
  }
  return res;
}

/* ── 3. PANTALLA DE ACCESO ──────────────────────────────────────── */
function showLock() {
  const lock = document.getElementById('lock');
  if (lock) lock.style.display = 'flex';
}

function hideLock() {
  const lock = document.getElementById('lock');
  if (lock) lock.style.display = 'none';
}

async function unlock() {
  const input = document.getElementById('lock-input');
  const err   = document.getElementById('lock-err');
  const val   = input?.value?.trim() || '';
  if (!val) return;
  localStorage.setItem('okiro_token', val);
  try {
    const res = await api('/auth/check');
    if (res.ok) {
      hideLock();
      if (err) err.textContent = '';
      initData();
      return;
    }
  } catch {}
  if (err) err.textContent = 'Clave incorrecta';
}

async function checkAccess() {
  try {
    const res = await api('/auth/check');
    return res.ok;
  } catch (e) {
    if (e.message === '401') return false;
    return true;
  }
}

/* ── 4. TOASTS ──────────────────────────────────────────────────── */
function toast(msg, tipo = 'ok') {
  const wrap = document.getElementById('toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }, 2600);
}

/* ── 5. RELOJ ───────────────────────────────────────────────────── */
function updateClock() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  const dia = DIAS[now.getDay()].toUpperCase();
  const dd  = String(now.getDate()).padStart(2, '0');
  const mes = now.toLocaleString('es', { month: 'short' }).toUpperCase();

  const clk = document.getElementById('clk');
  const fh  = document.getElementById('fh');
  if (clk) clk.textContent = `${hh}:${mm}`;
  if (fh)  fh.textContent  = `${dia} · ${dd} ${mes}`;
}

/* ── 6. TYPEWRITER ──────────────────────────────────────────────── */
function typewriterEffect(el, text, speed = 30, onDone) {
  if (!el) return;
  el.textContent = '';
  let i = 0;
  const tick = () => {
    if (i < text.length) {
      el.textContent += text[i++];
      setTimeout(tick, speed);
    } else if (typeof onDone === 'function') {
      onDone();
    }
  };
  tick();
}

/* ── 6b. INDICADOR OFFLINE ──────────────────────────────────────── */
function setupOfflineIndicator() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  const update = () => {
    if (!navigator.onLine) banner.classList.add('visible');
    else banner.classList.remove('visible');
  };
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

/* ── 7. NAVEGACIÓN ──────────────────────────────────────────────── */
function ss(n, btn) {
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));

  const sec = document.getElementById('sec-' + n);
  if (sec) sec.classList.add('active');
  if (btn) btn.classList.add('active');

  if (n === 'hoy'       && typeof loadResumenDia === 'function') loadResumenDia(currentViewISO());
  if (n === 'gym'       && typeof loadGym        === 'function') loadGym();
  if (n === 'nutri'     && typeof loadNutri      === 'function') loadNutri();
  if (n === 'proyectos' && typeof loadP          === 'function') loadP();
  if (n === 'log')       loadL();

  if (typeof window.positionNavLens === 'function') window.positionNavLens();
}

/* ── 7b. NAV DESLIZANTE ─────────────────────────────────────────── */
function setupNav() {
  const nav  = document.getElementById('nav');
  const lens = document.getElementById('nav-lens');
  if (!nav || !lens) return;
  const btns = Array.from(nav.querySelectorAll('.nb'));
  if (!btns.length) return;

  const lensTo = (btn) => {
    if (!btn) return;
    lens.style.width     = btn.offsetWidth + 'px';
    lens.style.transform = `translateX(${btn.offsetLeft}px)`;
  };
  const currentBtn = () => nav.querySelector('.nb.active') || btns[0];
  window.positionNavLens = () => lensTo(currentBtn());

  const btnAtX = (clientX) => {
    const r = nav.getBoundingClientRect();
    const x = clientX - r.left;
    for (const b of btns) {
      if (x >= b.offsetLeft && x <= b.offsetLeft + b.offsetWidth) return b;
    }
    return x <= btns[0].offsetLeft ? btns[0] : btns[btns.length - 1];
  };
  const followX = (clientX) => {
    const r = nav.getBoundingClientRect();
    const w = lens.offsetWidth || btns[0].offsetWidth;
    const min = btns[0].offsetLeft;
    const max = btns[btns.length - 1].offsetLeft;
    let left = clientX - r.left - w / 2;
    left = Math.max(min, Math.min(max, left));
    lens.style.transform = `translateX(${left}px)`;
  };
  const setHover = (btn) => btns.forEach(b => b.classList.toggle('drag-hover', b === btn));

  let dragging = false;
  nav.addEventListener('pointerdown', (e) => {
    dragging = true;
    nav.classList.add('dragging');
    try { nav.setPointerCapture(e.pointerId); } catch {}
    followX(e.clientX);
    setHover(btnAtX(e.clientX));
  });
  nav.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    followX(e.clientX);
    setHover(btnAtX(e.clientX));
  });
  const finish = (e) => {
    if (!dragging) return;
    dragging = false;
    nav.classList.remove('dragging');
    setHover(null);
    const btn = btnAtX(e.clientX);
    if (btn && !btn.classList.contains('active')) {
      ss(btn.dataset.sec, btn);
    } else {
      window.positionNavLens();
    }
  };
  nav.addEventListener('pointerup', finish);
  nav.addEventListener('pointercancel', () => {
    dragging = false;
    nav.classList.remove('dragging');
    setHover(null);
    window.positionNavLens();
  });

  window.addEventListener('resize', () => window.positionNavLens());
  requestAnimationFrame(() => window.positionNavLens());
}

/* ── 7c. BLOQUEAR ZOOM ──────────────────────────────────────────── */
function blockZoom() {
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev =>
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
  );
}

/* ── 8. NAVEGADOR DE FECHA (HOY) ────────────────────────────────── */
function navigateDay(delta) {
  currentViewDate = new Date(currentViewDate);
  currentViewDate.setDate(currentViewDate.getDate() + delta);
  updateDateNavUI();
  loadResumenDia(currentViewISO());
}

function updateDateNavUI() {
  const labelEl = document.getElementById('date-nav-label');
  const badgeEl = document.getElementById('date-nav-badge');

  const todayStr = hoyISO();
  const viewStr  = currentViewISO();

  const dia = DIAS_LABEL[currentViewDate.getDay()];
  const dd  = String(currentViewDate.getDate()).padStart(2, '0');
  const mes = currentViewDate.toLocaleString('es', { month: 'short' }).toUpperCase();

  if (labelEl) labelEl.textContent = `${dia} · ${dd} ${mes}`;

  const isToday = viewStr === todayStr;
  if (badgeEl) {
    badgeEl.textContent = isToday ? 'HOY' : (viewStr < todayStr ? 'PASADO' : 'FUTURO');
    badgeEl.className   = 'date-nav-badge' + (isToday ? ' today' : '');
  }
}

/* ── 9. HOY — DASHBOARD DE SOLO LECTURA ────────────────────────── */

async function loadResumenDia(fecha) {
  const ringEl  = document.getElementById('hoy-energy-ring');
  const checkEl = document.getElementById('hoy-checklist');
  const notaEl  = document.getElementById('nota-dia');

  if (ringEl)  ringEl.innerHTML  = '<div class="hoy-loading">Cargando...</div>';
  if (checkEl) checkEl.innerHTML = '';

  try {
    const res = await api('/resumen/' + fecha);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();

    renderEnergyRing(d);
    renderChecklist(d);
    renderStreakInfo();

    if (notaEl) notaEl.value = d.nota || '';

  } catch {
    if (ringEl) ringEl.innerHTML = '<div class="hoy-loading">Sin datos para este día</div>';
  }
}

function renderEnergyRing(d) {
  const el = document.getElementById('hoy-energy-ring');
  if (!el) return;

  const score = d.energia_score || 0;
  const color = score >= 85 ? '#00D9FF'
              : score >= 65 ? '#34D399'
              : score >= 40 ? '#FBBF24'
              :               '#F87171';
  const label = score >= 85 ? 'En forma'
              : score >= 65 ? 'Bueno'
              : score >= 40 ? 'Regular'
              :               'Agotado';

  const r     = 52;
  const circ  = +(2 * Math.PI * r).toFixed(1);
  const dash  = +((score / 100) * circ).toFixed(1);
  const offset = +((circ * 0.25)).toFixed(1);

  el.innerHTML = `
    <div class="ring-wrap">
      <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="Score de energía: ${score}">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="10"/>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="10"
          stroke-dasharray="${dash} ${circ}"
          stroke-dashoffset="${offset}"
          stroke-linecap="round"
          style="filter:drop-shadow(0 0 8px ${color}88);transition:stroke-dasharray 0.8s ease"/>
        <text x="60" y="57" text-anchor="middle" fill="${color}"
          font-family="Inter,sans-serif" font-size="24" font-weight="700">${score}</text>
        <text x="60" y="72" text-anchor="middle" fill="rgba(255,255,255,0.35)"
          font-family="Inter,sans-serif" font-size="8" letter-spacing="1">ENERGÍA</text>
      </svg>
      <div class="ring-label" style="color:${color}">${label.toUpperCase()}</div>
    </div>`;
}

function renderChecklist(d) {
  const el = document.getElementById('hoy-checklist');
  if (!el) return;

  /* Entrenamiento */
  const gymDone  = d.sesion_gym_hoy;
  const gymClass = gymDone ? 'done' : 'warning';

  /* Nutrición */
  const nutriRatio = d.calorias_objetivo > 0
    ? d.calorias_consumidas / d.calorias_objetivo : 0;
  const nutriDone  = nutriRatio >= 0.8;
  const nutriClass = nutriDone ? 'done' : 'warning';
  const pctNutri   = Math.min(100, Math.round(nutriRatio * 100));

  /* Sueño */
  const sueno      = d.sueno_horas || 0;
  const suenoClass = sueno >= 7 ? 'done' : sueno >= 5 ? 'warning' : 'danger';
  const suenoIcon  = sueno >= 7 ? '✓' : sueno >= 5 ? '⚠' : '✗';
  const suenoSub   = sueno > 0
    ? `${sueno}h${d.sueno_fuente !== 'strava' && d.fecha !== hoyISO() ? ' · último registrado' : ''}`
    : 'Sin datos';

  /* Proyectos */
  const projClass = d.proyectos_activos === 0 ? 'done' : 'warning';
  const projSub   = d.proyectos_activos > 0
    ? `${d.proyectos_activos} activo${d.proyectos_activos !== 1 ? 's' : ''}${d.proyecto_prioritario ? ' · ' + d.proyecto_prioritario : ''}`
    : 'Todo completado';

  el.innerHTML = `
    <div class="hoy-check-card ${gymClass}">
      <div class="hoy-card-icon">💪</div>
      <div class="hoy-card-body">
        <div class="hoy-card-title">Entrenamiento</div>
        <div class="hoy-card-sub">${d.rutina_hoy || 'Descanso'}</div>
      </div>
      <div class="hoy-card-status">${gymDone ? '✓' : '○'}</div>
    </div>
    <div class="hoy-check-card ${nutriClass}">
      <div class="hoy-card-icon">🥗</div>
      <div class="hoy-card-body">
        <div class="hoy-card-title">Nutrición</div>
        <div class="hoy-card-sub">${d.proteinas_consumidas}g prot · ${d.calorias_consumidas} kcal</div>
        <div class="hoy-nutri-bar"><div class="hoy-nutri-fill" style="width:${pctNutri}%"></div></div>
      </div>
      <div class="hoy-card-status">${pctNutri}%</div>
    </div>
    <div class="hoy-check-card ${suenoClass}">
      <div class="hoy-card-icon">😴</div>
      <div class="hoy-card-body">
        <div class="hoy-card-title">Sueño</div>
        <div class="hoy-card-sub">${suenoSub}</div>
      </div>
      <div class="hoy-card-status">${suenoIcon}</div>
    </div>
    <div class="hoy-check-card ${projClass}">
      <div class="hoy-card-icon">📋</div>
      <div class="hoy-card-body">
        <div class="hoy-card-title">Proyectos</div>
        <div class="hoy-card-sub">${projSub}</div>
      </div>
      <div class="hoy-card-status">${d.proyectos_activos}</div>
    </div>`;
}

function renderStreakInfo() {
  const el = document.getElementById('hoy-streak-info');
  if (!el) return;
  const lvl = localStorage.getItem('okiro_lvl') || '1';
  const xp  = parseInt(localStorage.getItem('okiro_xp') || '0', 10);
  el.innerHTML = `
    <span class="hoy-streak-fire">🔥</span>
    <span>LVL ${lvl}</span>
    <span class="hoy-streak-xp">${xp.toLocaleString('es')} XP</span>`;
}

/* ── 10. HISTORIAL — cargar ─────────────────────────────────────── */
async function loadL() {
  const hl = document.getElementById('hl');
  if (!hl) return;
  hl.innerHTML = '<div class="empty-state">Cargando...</div>';

  try {
    const res  = await api('/logs');
    const logs = await res.json();

    updateStreakBar(logs);
    updatePlayer(logs);

    if (!Array.isArray(logs) || !logs.length) {
      hl.innerHTML = '<div class="empty-state">Sin registros todavía.</div>';
      return;
    }

    hl.innerHTML = logs.slice(0, 30).map(l => {
      const d     = new Date(l.fecha);
      const fecha = d.toLocaleDateString('es', { day: '2-digit', month: 'short' }).toUpperCase();
      const parts = [];
      if (l.entreno_completado) parts.push('🏋️ ENTRENO');
      if (l.sueno)              parts.push(`💤 ${l.sueno}h`);
      if (l.energia)            parts.push(`⚡ E${l.energia}`);
      if (l.nutricion)          parts.push(`🥗 N${l.nutricion}`);
      if (l.tareas_completadas) parts.push(`☑ ${l.tareas_completadas}/5`);

      return `<div class="li">
  <span class="li-date">${fecha}</span>
  <div class="li-content">
    ${parts.join(' · ')}${l.notas ? `<br><span style="color:var(--text-3)">${l.notas}</span>` : ''}
  </div>
</div>`;
    }).join('');

  } catch {
    hl.innerHTML = '<div class="empty-state">Error cargando historial</div>';
  }
}

/* ── 11. NIVEL + XP ─────────────────────────────────────────────── */
function dayXP(l) {
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

function rankForLevel(lvl) {
  if (lvl >= 26) return ['S', 'rank-s'];
  if (lvl >= 17) return ['A', 'rank-a'];
  if (lvl >= 10) return ['B', 'rank-b'];
  if (lvl >= 5)  return ['C', 'rank-c'];
  return ['D', 'rank-d'];
}

function updatePlayer(logs) {
  const windowed = Array.isArray(logs) ? logs.reduce((a, l) => a + dayXP(l), 0) : 0;
  const prev     = parseInt(localStorage.getItem('okiro_xp') || '0', 10) || 0;
  const totalXP  = Math.max(prev, windowed);
  localStorage.setItem('okiro_xp', String(totalXP));

  let lvl = 1, rem = totalXP, need = 80;
  while (rem >= need) { rem -= need; lvl++; need = 80 + (lvl - 1) * 40; }

  const lvlEl  = document.getElementById('lvl-label');
  const fillEl = document.getElementById('xp-fill');
  const xpEl   = document.getElementById('xp-text');
  const chip   = document.getElementById('rank-chip');
  const prevLvl = parseInt(localStorage.getItem('okiro_lvl') || '0', 10) || 0;

  if (lvlEl)  lvlEl.textContent  = 'LVL ' + lvl;
  if (fillEl) fillEl.style.width = Math.min(100, Math.round((rem / need) * 100)) + '%';
  if (xpEl)   xpEl.textContent   = rem + ' / ' + need + ' XP';
  if (chip) {
    const [label, cls] = rankForLevel(lvl);
    chip.textContent = label;
    chip.className    = 'rank-badge ' + cls;
  }

  if (prevLvl && lvl > prevLvl && typeof toast === 'function') {
    toast(`⬆ NIVEL ${lvl} — RANGO ${rankForLevel(lvl)[0]}`, 'ok');
  }
  localStorage.setItem('okiro_lvl', String(lvl));

  /* Actualiza la línea HOY después de que el player esté computado */
  renderStreakInfo();
}

/* ── 12. STREAK BAR ─────────────────────────────────────────────── */
function updateStreakBar(logs) {
  const days = document.querySelectorAll('.streak-day');
  if (!days.length) return;

  const dayMap = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 0 };
  const today    = new Date();
  const todayDow = today.getDay();

  const done = new Set();
  if (Array.isArray(logs)) {
    logs.forEach(l => {
      if (l.entreno_completado) done.add(new Date(l.fecha).toDateString());
    });
  }

  days.forEach(el => {
    const key = el.dataset.day;
    const dow  = dayMap[key];
    if (dow === undefined) return;

    let diff = dow - todayDow;
    if (dow === 0 && todayDow !== 0) diff = 7 - todayDow;
    else if (diff > 0) diff -= 7;
    const date = new Date(today);
    date.setDate(today.getDate() + diff);

    const isToday  = date.toDateString() === today.toDateString();
    const isDone   = done.has(date.toDateString());
    const isFuture = date > today;

    el.classList.toggle('done',  isDone && !isFuture);
    el.classList.toggle('today', isToday);
  });
}

/* ── 13. CERRAR MODAL ───────────────────────────────────────────── */
function closeMissionModal() {
  const modal   = document.getElementById('mission-modal');
  const overlay = document.getElementById('mission-overlay');
  if (modal) modal.classList.add('hiding');
  setTimeout(() => {
    if (overlay) overlay.style.display = 'none';
    if (modal)   modal.classList.remove('hiding');
  }, 300);
}

/* ── 14. MODAL DE MISIÓN DIARIA ─────────────────────────────────── */
async function showMissionModal() {
  const todayStr = hoyISO();
  if (localStorage.getItem('missionShown') === todayStr) return;

  const overlay  = document.getElementById('mission-overlay');
  const bodyEl   = document.getElementById('mission-body');
  const typerEl  = document.getElementById('mm-typewriter');
  const acceptEl = document.getElementById('mm-accept');

  if (!overlay) return;
  overlay.style.display = 'flex';

  if (typerEl) typewriterEffect(typerEl, 'SISTEMA DE MISIONES ACTIVADO', 35);

  try {
    const [rutiRes, logRes] = await Promise.all([
      api('/rutinas'),
      api('/logs')
    ]);

    const rutinas = rutiRes.ok ? await rutiRes.json() : [];
    const logs    = logRes.ok  ? await logRes.json()  : [];

    const dow      = new Date().getDay();
    const diaLabel = DIAS[dow];

    const rutHoy = rutinas.find(r =>
      Array.isArray(r.dias) && r.dias.map(d => d.toLowerCase()).includes(diaLabel)
    );

    const ayer    = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const ayerStr = ayer.toISOString().split('T')[0];
    const logAyer = logs.find(l => l.fecha && String(l.fecha).startsWith(ayerStr));

    let html = '';
    if (rutHoy) {
      html += `<p style="margin-bottom:8px">
        <span style="color:var(--text-3);font-size:10px">RUTINA HOY</span><br>
        <strong>${rutHoy.nombre}</strong>
      </p>`;
    } else {
      html += `<p style="color:var(--text-3);margin-bottom:8px">Sin rutina asignada hoy — descanso o cardio</p>`;
    }

    if (logAyer) {
      html += `<p style="font-size:11px;color:var(--text-3);margin-top:8px">
        AYER — 💤${logAyer.sueno || '?'}h ·
        ${logAyer.entreno_completado ? '🏋️ ENTRENO ✓' : '🛌 DESCANSO'}
      </p>`;
    }

    if (!html) html = '<p class="mm-no-data">SIN DATOS</p>';
    if (bodyEl) bodyEl.innerHTML = html;

  } catch {
    if (bodyEl) bodyEl.innerHTML = '<p class="mm-no-data">Sin conexión con el sistema</p>';
  }

  localStorage.setItem('missionShown', todayStr);
  if (acceptEl) acceptEl.onclick = closeMissionModal;
}

/* ── 15. CARGA INICIAL DE DATOS ─────────────────────────────────── */
async function initData() {
  currentViewDate = new Date();
  updateDateNavUI();

  /* Racha + XP global */
  try {
    const res  = await api('/logs');
    const logs = res.ok ? await res.json() : [];
    updateStreakBar(logs);
    updatePlayer(logs);
  } catch {}

  /* Dashboard de HOY */
  loadResumenDia(hoyISO());

  /* Modal de misión */
  setTimeout(showMissionModal, 800);
}

/* ── 16. DEBOUNCE NOTA DEL DÍA ──────────────────────────────────── */
let _notaTimer = null;
function setupNotaDebounce() {
  const notaEl = document.getElementById('nota-dia');
  if (!notaEl) return;
  notaEl.addEventListener('input', () => {
    clearTimeout(_notaTimer);
    _notaTimer = setTimeout(async () => {
      const fecha = currentViewISO();
      try {
        await api('/logs/' + fecha + '/nota', {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ notas: notaEl.value })
        });
      } catch {}
    }, 1200);
  });
}

/* ── 17. INIT ───────────────────────────────────────────────────── */
window.onload = async () => {
  /* Reloj */
  updateClock();
  setInterval(updateClock, 1000);

  /* Enter en la pantalla de acceso */
  const lockInput = document.getElementById('lock-input');
  if (lockInput) {
    lockInput.addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
  }

  /* Splash */
  const splash = document.getElementById('splash');
  if (splash) {
    setTimeout(() => {
      splash.style.opacity    = '0';
      splash.style.transition = 'opacity 0.6s ease';
      setTimeout(() => { splash.style.display = 'none'; }, 650);
    }, 1400);
  }

  /* Sección inicial */
  ss('hoy', document.querySelector('.nb'));

  /* Fecha inicial */
  updateDateNavUI();

  /* Nav deslizante + bloqueo de zoom */
  setupNav();
  blockZoom();

  /* Indicador de conexión */
  setupOfflineIndicator();

  /* Nota del día con debounce */
  setupNotaDebounce();

  /* Acceso + datos */
  const ok = await checkAccess();
  if (ok) initData();

  /* Service Worker */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js')
      .then(reg => { reg.update(); })
      .catch(() => {});
  }
};
