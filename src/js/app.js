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

/* "2026-08-01" → "1 AGO". Para decir de qué día es un dato prestado. */
const diaCorto = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d) ? '' : d.toLocaleDateString('es', { day: 'numeric', month: 'short' }).toUpperCase();
};

/* ── ICONOS DE MARCA (SVG en línea, sin emojis) ─────────────────────
   Trazos finos en currentColor: heredan el color del contexto y se ven
   nítidos a cualquier tamaño, cosa que un emoji o un PNG no hacen. */
const _ok = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const OKICON = {
  dumbbell: _ok('<path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/>'),
  bowl:     _ok('<path d="M4 13h16a8 8 0 0 1-16 0Z"/><path d="M9 8c0-1.5 1-2 1-3.5M14 8c0-1.5 1-2 1-3.5"/>'),
  moon:     _ok('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>'),
  folder:   _ok('<path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
  pull:     _ok('<path d="M4 5h16M8 5v6a4 4 0 0 0 8 0V5"/>'),
  legs:     _ok('<path d="M5 6h14M9 6v5l-2.5 7M15 6v5l2.5 7"/>'),
  check:    _ok('<path d="M4 12.5 9 17.5 20 6.5"/>'),
  cross:    _ok('<path d="M6 6l12 12M18 6L6 18"/>'),
  circle:   _ok('<circle cx="12" cy="12" r="7"/>'),
  alert:    _ok('<path d="M12 7v6M12 17h.01"/><circle cx="12" cy="12" r="9"/>'),
  gear:     _ok('<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.6 7.5l1.7 1M17.7 15.5l1.7 1M4.6 16.5l1.7-1M17.7 8.5l1.7-1"/>'),
  idioma:   _ok('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/>'),
  play:     _ok('<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5Z"/>')
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
  if (n === 'log')     { loadL(); loadCruce(); }

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
    /* Solo se ofrece el registro rápido si el dato es de hoy y aún no existe.
       El servidor marca como 'heredado' el sueño que viene de otro día, así
       que ya no se confunde con uno propio: antes ese préstamo escondía el
       botón y te dejaba sin poder registrar el sueño de verdad. */
    renderSuenoQuick(fecha !== hoyISO() || (d.sueno_horas > 0 && d.sueno_fuente === 'manual'));

    if (notaEl) notaEl.value = d.nota || '';

  } catch {
    if (ringEl) ringEl.innerHTML = '<div class="hoy-loading">Sin datos para este día</div>';
    renderSuenoQuick(fecha !== hoyISO());
  }
}

function renderEnergyRing(d) {
  const el = document.getElementById('hoy-energy-ring');
  if (!el) return;

  const score = d.energia_score || 0;
  // Escala de aura, no semáforo: la energía enciende el violeta, no lo cambia de color.
  const color = score >= 85 ? '#E4C4FF'
              : score >= 65 ? '#A472FF'
              : score >= 40 ? '#8B4DFF'
              :               '#4B4557';
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

  /* Sueño. Un dato heredado de otro día se dice que lo es y no cuenta como
     bueno: antes se pintaba en verde como si hubieras dormido eso anoche. */
  const sueno       = d.sueno_horas || 0;
  const suenoViejo  = d.sueno_fuente === 'heredado';
  const suenoClass  = suenoViejo ? 'warning'
                    : sueno >= 7 ? 'done' : sueno >= 5 ? 'warning' : 'danger';
  const suenoIcon   = suenoViejo ? OKICON.alert
                    : sueno >= 7 ? OKICON.check : sueno >= 5 ? OKICON.alert : OKICON.cross;
  const suenoSub    = sueno > 0
    ? `${sueno}h${suenoViejo ? ` · del ${diaCorto(d.sueno_fecha)}, no de hoy` : ''}`
    : 'Sin datos';

  /* Proyectos */
  const projClass = d.proyectos_activos === 0 ? 'done' : 'warning';
  const projSub   = d.proyectos_activos > 0
    ? `${d.proyectos_activos} activo${d.proyectos_activos !== 1 ? 's' : ''}${d.proyecto_prioritario ? ' · ' + d.proyecto_prioritario : ''}`
    : 'Todo completado';

  /* Misión del día — la primera tarjeta, porque es el compromiso de hoy.
     Los objetivos se marcan solos: aquí solo se ve cómo va. */
  let misionHTML = '';
  if (d.mision && d.mision.total) {
    const m     = d.mision;
    const clase = m.completa ? 'done' : m.estado === 'rechazada' ? '' : 'warning';
    const sub   = m.estado === 'rechazada'
      ? 'Rechazada hoy'
      : m.objetivos.filter(o => !o.cumplido).map(o => o.texto).join(' · ') || 'Todo cumplido';
    misionHTML = `
    <div class="hoy-check-card ${clase}">
      <div class="hoy-card-icon">${OKICON.alert}</div>
      <div class="hoy-card-body">
        <div class="hoy-card-title">Misión${m.recuperacion ? ' · recuperación' : m.estado === 'aceptada' ? ' · aceptada' : ''}</div>
        <div class="hoy-card-sub">${sub}</div>
        ${m.mensaje ? `<div class="hoy-mision-aliento">${m.mensaje}</div>` : ''}
      </div>
      <div class="hoy-card-status">${m.cumplidos}/${m.total}</div>
    </div>`;
  }

  /* Inglés — OKIRO no enseña idiomas: dice si quedan repasos y lleva a
     tutoringles, que es donde se estudia. Si no hay datos, no pinta nada. */
  let inglesHTML = '';
  if (d.ingles) {
    const g       = d.ingles;
    const pend    = g.repasos_hoy || 0;
    const clase   = pend > 0 ? 'warning' : 'done';
    const sub     = pend > 0
      ? `${pend} repaso${pend !== 1 ? 's' : ''} te espera${pend !== 1 ? 'n' : ''}`
      : `al día · ${g.empezadas} de ${g.total} palabras`;
    const racha   = g.racha > 0 ? ` · racha ${g.racha}d` : '';
    const abrible = /^https?:\/\//i.test(g.url || '');
    // La tarjeta entera es el enlace: un toque desde HOY y estás estudiando.
    const tag     = abrible ? 'a' : 'div';
    const attrs   = abrible ? ` href="${g.url}" target="_blank" rel="noopener noreferrer"` : '';
    inglesHTML = `
    <${tag} class="hoy-check-card ${clase}"${attrs}>
      <div class="hoy-card-icon">${OKICON.idioma}</div>
      <div class="hoy-card-body">
        <div class="hoy-card-title">Inglés</div>
        <div class="hoy-card-sub">${sub}${racha}</div>
      </div>
      <div class="hoy-card-status">${pend > 0 ? pend : OKICON.check}</div>
    </${tag}>`;
  }

  el.innerHTML = `
    ${misionHTML}
    <div class="hoy-check-card ${gymClass}">
      <div class="hoy-card-icon">${OKICON.dumbbell}</div>
      <div class="hoy-card-body">
        <div class="hoy-card-title">Entrenamiento</div>
        <div class="hoy-card-sub">${d.rutina_hoy || 'Descanso'}</div>
      </div>
      <div class="hoy-card-status">${gymDone ? OKICON.check : OKICON.circle}</div>
    </div>
    <div class="hoy-check-card ${nutriClass}">
      <div class="hoy-card-icon">${OKICON.bowl}</div>
      <div class="hoy-card-body">
        <div class="hoy-card-title">Nutrición</div>
        <div class="hoy-card-sub">${d.proteinas_consumidas}g prot · ${d.calorias_consumidas} kcal</div>
        <div class="hoy-nutri-bar"><div class="hoy-nutri-fill" style="width:${pctNutri}%"></div></div>
      </div>
      <div class="hoy-card-status">${pctNutri}%</div>
    </div>
    <div class="hoy-check-card ${suenoClass}">
      <div class="hoy-card-icon">${OKICON.moon}</div>
      <div class="hoy-card-body">
        <div class="hoy-card-title">Sueño</div>
        <div class="hoy-card-sub">${suenoSub}</div>
      </div>
      <div class="hoy-card-status">${suenoIcon}</div>
    </div>
    <div class="hoy-check-card ${projClass}">
      <div class="hoy-card-icon">${OKICON.folder}</div>
      <div class="hoy-card-body">
        <div class="hoy-card-title">Proyectos</div>
        <div class="hoy-card-sub">${projSub}</div>
      </div>
      <div class="hoy-card-status">${d.proyectos_activos}</div>
    </div>
    ${inglesHTML}`;
}

function renderStreakInfo() {
  const el = document.getElementById('hoy-streak-info');
  if (!el) return;
  const lvl    = localStorage.getItem('okiro_lvl') || '1';
  const xp     = parseInt(localStorage.getItem('okiro_xp') || '0', 10);
  const streak = parseInt(localStorage.getItem('okiro_streak') || '0', 10);
  const rank   = localStorage.getItem('okiro_rank') || 'E';
  el.innerHTML = `
    <span style="color:${AURA_COLOR[rank] || '#8B4DFF'}">RACHA ${streak} ${streak === 1 ? 'DÍA' : 'DÍAS'}</span>
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
    updatePlayer();

    if (!Array.isArray(logs) || !logs.length) {
      hl.innerHTML = '<div class="empty-state">Sin registros todavía.</div>';
      return;
    }

    hl.innerHTML = logs.slice(0, 30).map(l => {
      const d     = new Date(l.fecha);
      const fecha = d.toLocaleDateString('es', { day: '2-digit', month: 'short' }).toUpperCase();
      const parts = [];
      if (l.entreno_completado) parts.push('ENTRENO');
      if (l.sueno)              parts.push(`${l.sueno}h`);
      if (l.energia)            parts.push(`E${l.energia}`);
      if (l.nutricion)          parts.push(`N${l.nutricion}`);
      if (l.tareas_completadas) parts.push(`${l.tareas_completadas}/5 tareas`);

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

/* Racha: días seguidos con registro, contando hacia atrás desde hoy.
   Si hoy aún no has registrado, la racha de ayer sigue viva (no se rompe
   hasta que el día termina sin registro). */
function currentStreak(logs) {
  if (!Array.isArray(logs) || !logs.length) return 0;
  const days = new Set(logs.map(l => String(l.fecha).slice(0, 10)));
  const iso  = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const d = new Date();
  if (!days.has(iso(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(iso(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

/* El rango mide constancia, no fuerza: días seguidos levantándote y
   registrando (kit de marca). El nivel/XP sigue midiendo volumen aparte. */
function rankForStreak(n) {
  if (n >= 60) return ['S', 'rank-s'];
  if (n >= 30) return ['A', 'rank-a'];
  if (n >= 14) return ['B', 'rank-b'];
  if (n >= 7)  return ['C', 'rank-c'];
  if (n >= 3)  return ['D', 'rank-d'];
  return ['E', 'rank-e'];   // donde empieza todo el mundo
}

/* El aura del símbolo de cabecera sube y se enciende con el rango */
/* La escala vieja no se leía: de C a S el círculo solo subía 10 unidades de
   100 y los tres tonos altos eran casi el mismo violeta. Ahora el recorrido
   es amplio y regular (saltos de 8), los extremos se separan y el brillo
   crece con el rango: en E el aura casi no asoma, en S sale entera. */
const AURA_COLOR = { E: '#3A3545', D: '#6D5A9E', C: '#8B4DFF', B: '#A472FF', A: '#D2AEFF', S: '#F3E3FF' };
const AURA_CY    = { E: 84, D: 76, C: 68, B: 60, A: 52, S: 44 };
const AURA_GLOW  = { E: 0,  D: 1,  C: 2,  B: 3,  A: 4,  S: 6  };
function setHdrAura(label) {
  const mark  = document.getElementById('hdr-mark');
  const aura  = document.getElementById('hdr-aura');
  const faint = document.getElementById('hdr-faint');
  const cy    = AURA_CY[label] ?? 62;
  const color = AURA_COLOR[label] || '#8B4DFF';
  if (aura) {
    aura.setAttribute('cy', cy);
    aura.setAttribute('stroke', color);
  }
  if (faint) faint.setAttribute('cy', cy);
  // El halo es la segunda señal: el color solo no basta para leer el rango.
  if (mark) {
    const g = AURA_GLOW[label] ?? 0;
    mark.style.filter = g ? `drop-shadow(0 0 ${g}px ${color})` : 'none';
  }
}

/* El progreso ya no se calcula aquí: lo manda el servidor. Antes vivía en
   localStorage, así que se perdía al cambiar de móvil y una penalización se
   esquivaba vaciando la caché. localStorage se queda solo como espejo de lo
   último pintado, para no parpadear ni perder el aviso de cambio de rango. */
async function updatePlayer() {
  let p = null;
  try {
    const res = await api('/progreso');
    p = res.ok ? await res.json() : null;
  } catch { /* sin conexión: se mantiene lo último pintado */ }
  if (!p) { renderStreakInfo(); return; }

  const lvlEl  = document.getElementById('lvl-label');
  const fillEl = document.getElementById('xp-fill');
  const xpEl   = document.getElementById('xp-text');
  const chip   = document.getElementById('rank-chip');

  /* Previsualización de diseño: okirosport.es/?aura=S pinta ese rango para ver
     cómo queda el aura, sin tocar la base de datos ni inflar la racha. Solo
     afecta a lo que se dibuja; al quitar el parámetro vuelve el rango real. */
  const preview = new URLSearchParams(location.search).get('aura');
  const rango   = (preview && 'EDCBAS'.includes(preview.toUpperCase()))
    ? preview.toUpperCase()
    : p.rango;

  if (lvlEl)  lvlEl.textContent  = 'LVL ' + p.nivel;
  if (fillEl) fillEl.style.width = Math.min(100, Math.round((p.xp_en_nivel / p.xp_para_subir) * 100)) + '%';
  if (xpEl)   xpEl.textContent   = p.xp_en_nivel + ' / ' + p.xp_para_subir + ' XP';
  if (chip) {
    chip.textContent = rango;
    chip.className   = 'rank-badge rank-' + rango.toLowerCase();
  }
  setHdrAura(rango);

  // En previsualización no se guarda nada ni se lanzan avisos de cambio de
  // rango: solo se está mirando cómo queda.
  if (preview) { renderStreakInfo(); return; }

  /* Avisos de cambio: ahora el rango también puede BAJAR */
  const ORDER    = 'EDCBAS';
  const prevRank = localStorage.getItem('okiro_rank') || '';
  const prevLvl  = parseInt(localStorage.getItem('okiro_lvl') || '0', 10) || 0;
  if (prevRank && typeof toast === 'function') {
    if (ORDER.indexOf(p.rango) > ORDER.indexOf(prevRank)) {
      toast(`RANGO ${p.rango}. El aura sube.`, 'ok');
    } else if (ORDER.indexOf(p.rango) < ORDER.indexOf(prevRank)) {
      toast(`RANGO ${p.rango}. El aura baja.`, 'error');
    }
  }
  if (prevLvl && p.nivel > prevLvl && typeof toast === 'function') toast(`NIVEL ${p.nivel}.`, 'ok');

  localStorage.setItem('okiro_rank',   p.rango);
  localStorage.setItem('okiro_streak', String(p.racha));
  localStorage.setItem('okiro_lvl',    String(p.nivel));
  localStorage.setItem('okiro_xp',     String(p.xp));

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
/* ── VENTANA DE ESTADO ──────────────────────────────────────────── */
/* La cabecera pedía ser pulsada y no hacía nada. Ahora el aura y la barra de
   XP abren el estado: qué falta para el siguiente rango, de dónde sale el XP
   de hoy y cómo va el historial de misiones. Todo sale de /progreso. */
async function abrirEstado() {
  const overlay = document.getElementById('estado-overlay');
  const body    = document.getElementById('estado-body');
  if (!overlay || !body) return;

  overlay.style.display = 'flex';
  body.innerHTML = '<p class="mm-no-data">Cargando...</p>';

  let p = null;
  try {
    const res = await api('/progreso');
    p = res.ok ? await res.json() : null;
  } catch {}
  if (!p) { body.innerHTML = '<p class="mm-no-data">Sin conexión con el sistema</p>'; return; }

  const fila = (k, v, resalta) =>
    `<div class="est-fila"><span class="est-k">${k}</span><span class="est-v${resalta ? ' est-alto' : ''}">${v}</span></div>`;

  const dias = n => `${n} ${n === 1 ? 'día' : 'días'}`;

  body.innerHTML = `
    <div class="est-cabecera">
      <div class="est-rango rank-badge rank-${p.rango.toLowerCase()}">${p.rango}</div>
      <div class="est-lvl">LVL ${p.nivel}<span>${p.xp} XP</span></div>
    </div>

    <div class="est-sep">CONSTANCIA</div>
    ${fila('Racha actual', dias(p.racha), p.racha > 0)}
    ${p.siguiente
      ? fila(`Para rango ${p.siguiente.rango}`, dias(p.siguiente.dias) + ' más')
      : fila('Rango', 'máximo alcanzado', true)}
    ${fila('Mejor racha', dias(p.mejor_racha))}

    <div class="est-sep">NIVEL</div>
    ${fila('Para subir', `${p.xp_para_subir - p.xp_en_nivel} XP`)}
    ${fila('XP de hoy', `${p.xp_hoy_total}`, p.xp_hoy_total > 0)}
    ${p.xp_hoy.length
      ? `<ul class="est-xp">${p.xp_hoy.map(x => `<li><span>${x.que}</span><span>+${x.xp}</span></li>`).join('')}</ul>`
      : '<p class="est-vacio">Hoy aún no has sumado. Entrena, registra el sueño o cierra un hito.</p>'}

    <div class="est-sep">MISIONES</div>
    ${fila('Cumplidas', p.misiones_cumplidas, p.misiones_cumplidas > 0)}
    ${fila('Falladas', p.misiones_falladas)}`;
}

function cerrarEstado() {
  const overlay = document.getElementById('estado-overlay');
  if (overlay) overlay.style.display = 'none';
}

/* Reabrir la misión del día: una vez cerrada no había forma de volver a verla. */
function verMisionHoy() {
  cerrarEstado();
  showMissionModal(true);
}

/* El reloj devuelve al día de hoy desde cualquier fecha que estuvieras viendo. */
function volverAHoy() {
  if (typeof currentViewDate !== 'undefined') currentViewDate = new Date();
  const btn = document.querySelector('.nb[data-sec=hoy]');
  ss('hoy', btn);
  if (typeof loadResumenDia === 'function') loadResumenDia(hoyISO());
}

/* La misión del día: objetivos de todos los ámbitos, no solo del gym, y que
   se cumplen solos al vivir el día. ACEPTAR y RECHAZAR hacen cosas distintas
   y quedan registrados — antes los dos botones llamaban a la misma función.
   Con `forzar` se reabre desde la ventana de estado aunque ya esté decidida. */
async function showMissionModal(forzar = false) {
  const todayStr = hoyISO();

  const overlay  = document.getElementById('mission-overlay');
  const bodyEl   = document.getElementById('mission-body');
  const typerEl  = document.getElementById('mm-typewriter');
  const acceptEl = document.getElementById('mm-accept');
  const skipEl   = document.querySelector('.mm-btn-skip');
  if (!overlay) return;

  let m = null;
  try {
    const res = await api('/mision');
    m = res.ok ? await res.json() : null;
  } catch { /* sin conexión: se decide abajo */ }

  // Ya decidida hoy: no se vuelve a preguntar sola. Si aún está ofrecida, se
  // pregunta aunque hayas abierto la app antes — la decisión es el punto.
  // Al reabrirla a mano desde el estado, se muestra siempre.
  if (!forzar) {
    if (m && m.estado !== 'ofrecida') return;
    if (!m && localStorage.getItem('missionShown') === todayStr) return;
  }

  overlay.style.display = 'flex';
  // Si ayer se falló, hoy la misión viene con castigo: más exigente y avisando.
  if (typerEl) typewriterEffect(typerEl, m?.recuperacion ? 'MISIÓN DE RECUPERACIÓN' : 'MISIÓN DIARIA', 35);

  if (!m || !m.total) {
    if (bodyEl) bodyEl.innerHTML = '<p class="mm-no-data">Sin objetivos para hoy</p>';
  } else if (bodyEl) {
    bodyEl.innerHTML = `
      <ul class="mm-objetivos">
        ${m.objetivos.map(o => `<li class="mm-obj${o.cumplido ? ' mm-obj-ok' : ''}">
          <span class="mm-obj-box">${o.cumplido ? '✓' : ''}</span>
          <span class="mm-obj-txt">${o.texto}</span>
        </li>`).join('')}
      </ul>
      ${m.recuperacion ? '<p class="mm-nota mm-castigo">Ayer falló. Hoy se pide el doble.</p>' : ''}
      ${m.mensaje ? `<p class="mm-aliento">${m.mensaje}</p>` : ''}
      <p class="mm-nota">Se cumplen solos: entrena, come, registra, cierra un hito o repasa.
        Cumplirla suma 50 XP; fallarla resta 25.</p>`;
  }

  localStorage.setItem('missionShown', todayStr);

  const decidir = async accion => {
    try {
      await api(`/mision/hoy/${accion}`, { method: 'POST' });
      toast(accion === 'aceptar' ? 'Misión aceptada' : 'Misión rechazada');
    } catch {
      toast('No se pudo registrar la decisión', 'error');
    }
    closeMissionModal();
    loadResumenDia(hoyISO());   // la tarjeta de misión refleja la decisión
  };

  if (acceptEl) {
    acceptEl.textContent = 'ACEPTAR MISIÓN';
    acceptEl.onclick = () => decidir('aceptar');
  }
  if (skipEl) {
    skipEl.textContent = 'RECHAZAR';
    skipEl.onclick = () => decidir('rechazar');
  }
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
    updatePlayer();
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

/* ── 15b. CRUCE DE DATOS ────────────────────────────────────────── */
/* El diferencial del producto: cuerpo, descanso y trabajo sobre el mismo eje.
   Se dibuja en SVG en vez de canvas para que escale nítido y respete el tema. */

let _cruceDias = 14;

/* Cuatro series en la misma gama violeta se confunden entre sí. Como el kit
   prohíbe un segundo acento, se distinguen por luminosidad Y por trazo: dos
   codificaciones redundantes, que además funciona para daltonismo. */
const CRUCE_SERIES = [
  { clave: 'sueno',     etiqueta: 'Sueño',     color: '#E4C4FF', dash: '',      max: 10,  unidad: 'h'   },
  { clave: 'energia',   etiqueta: 'Energía',   color: '#8B4DFF', dash: '',      max: 10,  unidad: '/10' },
  { clave: 'nutricion', etiqueta: 'Nutrición', color: '#C08BFF', dash: '5 3',   max: 10,  unidad: '/10' },
  { clave: 'tareas',    etiqueta: 'Tareas',    color: '#6D5A9E', dash: '1.5 3', max: 100, unidad: '%'   }
];

function setRangoCruce(dias, btn) {
  _cruceDias = dias;
  document.querySelectorAll('.cruce-btn').forEach(b => b.classList.toggle('active', b === btn));
  loadCruce();
}

function textoCorrelacion(valor, a, b) {
  if (valor == null) return null;
  const fuerza = Math.abs(valor);
  if (fuerza < 0.3) return null;                    // por debajo de 0.3 no dice nada
  const signo = valor > 0 ? 'sube con' : 'baja cuando sube';
  const grado = fuerza >= 0.6 ? 'Clara' : 'Leve';
  return `${grado}: ${a} ${signo} ${b} (${valor > 0 ? '+' : ''}${valor})`;
}

async function loadCruce() {
  const el = document.getElementById('cruce');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">Cargando...</div>';

  try {
    const res = await api('/cruce/' + _cruceDias);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();

    /* Un gráfico con dos puntos miente más que informa */
    if (d.dias_registrados < 3) {
      el.innerHTML = `
        <div class="empty-state">
          ${d.dias_registrados} ${d.dias_registrados === 1 ? 'día registrado' : 'días registrados'} de ${d.dias}.<br>
          <span style="color:var(--text-4)">El cruce necesita al menos 3 para decir algo.</span>
        </div>`;
      return;
    }

    const W = 320, H = 132, PL = 4, PR = 4, PT = 8, PB = 16;
    const n = d.serie.length;
    const x = i => PL + (i * (W - PL - PR)) / Math.max(1, n - 1);
    const y = (v, max) => PT + (1 - v / max) * (H - PT - PB);

    /* Una línea por serie; los huecos parten el trazo en vez de inventar continuidad */
    const lineas = CRUCE_SERIES.map(s => {
      const tramos = [];
      let actual = [];
      d.serie.forEach((p, i) => {
        const v = p[s.clave];
        if (v == null) { if (actual.length > 1) tramos.push(actual); actual = []; return; }
        actual.push(`${x(i).toFixed(1)},${y(v, s.max).toFixed(1)}`);
      });
      if (actual.length > 1) tramos.push(actual);
      if (!tramos.length) return '';
      return tramos.map(t =>
        `<polyline points="${t.join(' ')}" fill="none" stroke="${s.color}"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                   ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`
      ).join('');
    }).join('');

    /* Franjas verticales en los días sin registro: los huecos también son dato */
    const huecos = d.serie.map((p, i) => p.registrado ? '' :
      `<rect x="${(x(i) - 1.5).toFixed(1)}" y="${PT}" width="3" height="${H - PT - PB}"
             fill="var(--text-4)" opacity="0.18"/>`).join('');

    /* Marcas de entreno en la base */
    const entrenos = d.serie.map((p, i) => !p.entreno ? '' :
      `<circle cx="${x(i).toFixed(1)}" cy="${H - PB + 6}" r="2.5" fill="var(--brand)"/>`).join('');

    /* La leyenda repite el trazo real de cada serie, no solo el color */
    const leyenda = CRUCE_SERIES.map(s => `
      <span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--text-3)">
        <svg width="14" height="4" aria-hidden="true"><line x1="0" y1="2" x2="14" y2="2"
             stroke="${s.color}" stroke-width="2" stroke-linecap="round"
             ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/></svg>
        ${s.etiqueta}
      </span>`).join('');

    const hallazgos = [
      textoCorrelacion(d.correlaciones.sueno_energia,     'la energía', 'el sueño'),
      textoCorrelacion(d.correlaciones.sueno_tareas,      'las tareas', 'el sueño'),
      textoCorrelacion(d.correlaciones.energia_tareas,    'las tareas', 'la energía'),
      textoCorrelacion(d.correlaciones.nutricion_energia, 'la energía', 'la nutrición')
    ].filter(Boolean);

    const bloqueHallazgos = hallazgos.length
      ? `<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">
           ${hallazgos.map(h => `
             <div style="font-size:11px;color:var(--text-2);display:flex;gap:7px;align-items:flex-start">
               <span style="color:var(--brand);flex-shrink:0">—</span><span>${h}</span>
             </div>`).join('')}
         </div>`
      : `<div style="margin-top:12px;font-size:11px;color:var(--text-4)">
           Todavía no hay patrones claros. Aparecen solos según acumules días.
         </div>`;

    el.innerHTML = `
      <div class="card glass">
        <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">
          ${huecos}
          <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}"
                stroke="var(--text-4)" stroke-width="1" opacity="0.35"/>
          ${lineas}
          ${entrenos}
        </svg>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">${leyenda}</div>
        <div style="font-size:10px;color:var(--text-4);margin-top:8px">
          ${d.dias_registrados} de ${d.dias} días con registro · los puntos de abajo son entrenos
        </div>
        ${bloqueHallazgos}
      </div>`;

  } catch {
    el.innerHTML = '<div class="empty-state">No se pudo cargar el cruce</div>';
  }
}

/* ── 16a. SUEÑO EN DOS TOQUES ───────────────────────────────────── */
/* El sueño automático no existe en una PWA: Health Connect y HealthKit son APIs
   nativas. Si va a ser manual, que sea instantáneo — un toque en una franja,
   no un formulario con teclado numérico. */
const SUENO_OPCIONES = [
  { h: 5,   etiqueta: '<5h'  },
  { h: 6,   etiqueta: '6h'   },
  { h: 7,   etiqueta: '7h'   },
  { h: 7.5, etiqueta: '7½h'  },
  { h: 8,   etiqueta: '8h'   },
  { h: 9,   etiqueta: '9h+'  }
];

async function registrarSueno(horas) {
  const fecha = currentViewISO();
  try {
    const res = await api('/logs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fecha, sueno: horas })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    toast(`Sueño: ${horas}h.`);
    loadResumenDia(fecha);
  } catch {
    toast('No se pudo guardar', 'error');
  }
}

function renderSuenoQuick(yaRegistrado) {
  const el = document.getElementById('sueno-quick');
  if (!el) return;
  /* Ya hay dato: la card de arriba lo muestra, aquí sobra */
  if (yaRegistrado) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `
    <div class="ct">¿CUÁNTO DORMISTE?</div>
    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
      ${SUENO_OPCIONES.map(o => `
        <button class="bu" style="flex:1;min-width:52px;height:40px;font-size:12px;letter-spacing:0"
                onclick="registrarSueno(${o.h})">${o.etiqueta}</button>`).join('')}
    </div>`;
}

/* ── 16b. MISIÓN DIARIA (push) ──────────────────────────────────── */
/* El navegador exige un gesto del usuario para pedir permiso, así que esto
   solo se dispara desde el botón — nunca automáticamente al cargar. */

function b64ToUint8(base64) {
  const pad  = '='.repeat((4 - base64.length % 4) % 4);
  const raw  = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function pushDisponible() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function estadoMision() {
  if (!(await pushDisponible())) return 'no-soportado';
  if (Notification.permission === 'denied') return 'bloqueado';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'activa' : 'inactiva';
}

async function activarMision() {
  if (!(await pushDisponible())) {
    toast('Este navegador no admite avisos', 'error');
    return;
  }
  try {
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') {
      toast('Permiso denegado', 'error');
      return renderMisionCard();
    }

    const res = await api('/push/clave');
    const { clave, activo } = await res.json();
    if (!activo || !clave) {
      toast('El servidor aún no tiene claves de aviso', 'error');
      return renderMisionCard();
    }

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToUint8(clave)
    });

    const r = await api('/push/suscribir', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        ...sub.toJSON(),
        hora_aviso:  parseInt(localStorage.getItem('okiro_hora_aviso')  || '8',  10),
        hora_cierre: parseInt(localStorage.getItem('okiro_hora_cierre') || '22', 10)
      })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);

    toast('Misión diaria activada.');
  } catch (e) {
    toast('No se pudo activar: ' + (e.message || e), 'error');
  }
  renderMisionCard();
}

async function desactivarMision() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('/push/baja', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ endpoint: sub.endpoint })
      }).catch(() => {});
      await sub.unsubscribe();
    }
    toast('Avisos desactivados.');
  } catch { toast('No se pudo desactivar', 'error'); }
  renderMisionCard();
}

async function cambiarHoraAviso(valor) {
  localStorage.setItem('okiro_hora_aviso', valor);
  if (await estadoMision() === 'activa') await activarMision();  // re-suscribe con la hora nueva
}

async function renderMisionCard() {
  const el = document.getElementById('mision-card');
  if (!el) return;
  const estado = await estadoMision();
  const hora   = localStorage.getItem('okiro_hora_aviso') || '8';

  if (estado === 'no-soportado') { el.style.display = 'none'; return; }
  el.style.display = '';

  if (estado === 'bloqueado') {
    el.innerHTML = `
      <div class="ct">MISIÓN DIARIA</div>
      <div style="font-size:11px;color:var(--text-3);margin-top:4px">
        Avisos bloqueados en los ajustes del navegador. Actívalos ahí para recibirlos.
      </div>`;
    return;
  }

  if (estado === 'activa') {
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <div class="ct">MISIÓN DIARIA</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">
            Aviso a las ${String(hora).padStart(2, '0')}:00 si el día sigue en blanco
          </div>
        </div>
        <button class="bu" style="width:auto;height:34px;padding:0 14px;font-size:11px"
                onclick="desactivarMision()">DESACTIVAR</button>
      </div>
      <div style="margin-top:10px;display:flex;align-items:center;gap:10px">
        <span style="font-size:10px;color:var(--text-3);letter-spacing:1px">HORA</span>
        <input type="range" min="5" max="12" value="${hora}" style="flex:1"
               oninput="document.getElementById('mision-hora').textContent=this.value.padStart(2,'0')+':00'"
               onchange="cambiarHoraAviso(this.value)">
        <span id="mision-hora" class="hoy-streak-xp">${String(hora).padStart(2, '0')}:00</span>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div>
        <div class="ct">MISIÓN DIARIA</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:2px">
          Que el sistema te avise si el día acaba sin registro
        </div>
      </div>
      <button class="bs" style="width:auto;height:34px;padding:0 16px;font-size:11px"
              onclick="activarMision()">ACTIVAR</button>
    </div>`;
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

  /* Card de misión diaria (no pide permiso: solo pinta el estado) */
  renderMisionCard();

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
