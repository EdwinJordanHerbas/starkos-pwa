// OkiroSport — Init, API, Reloj, Navegación, Estado Global

/* ── 1. CONSTANTES ──────────────────────────────────────────────── */
const A          = '';
const DIAS       = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const DIAS_LABEL = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
let tdCount = 0;

const hoyISO = () => new Date().toISOString().split('T')[0];

/* ── 2. API (añade la clave de acceso a cada petición) ──────────── */
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

/* Comprueba acceso al arrancar. Si el servidor exige clave y no la
   tenemos, muestra la pantalla de acceso; si no, arranca normal. */
async function checkAccess() {
  try {
    const res = await api('/auth/check');
    return res.ok;
  } catch (e) {
    if (e.message === '401') return false; // lock ya visible
    return true; // backend caído o dev sin mock: dejamos entrar, cada sección mostrará su error
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

/* ── 7. NAVEGACIÓN ──────────────────────────────────────────────── */
function ss(n, btn) {
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));

  const sec = document.getElementById('sec-' + n);
  if (sec) sec.classList.add('active');
  if (btn) btn.classList.add('active');

  if (n === 'gym'       && typeof loadGym   === 'function') loadGym();
  if (n === 'nutri'     && typeof loadNutri === 'function') loadNutri();
  if (n === 'proyectos' && typeof loadP     === 'function') loadP();
  if (n === 'log')       loadL();

  if (typeof window.positionNavLens === 'function') window.positionNavLens();
}

/* ── 7b. NAV DESLIZANTE (lente que sigue el dedo, estilo iOS) ────── */
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
    nav.classList.remove('dragging');   // vuelve la transición muelle
    setHover(null);
    const btn = btnAtX(e.clientX);
    if (btn && !btn.classList.contains('active')) {
      ss(btn.dataset.sec, btn);         // ss() reposiciona la lente
    } else {
      window.positionNavLens();         // asienta la lente en el activo
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

/* ── 7c. BLOQUEAR ZOOM (pinch) — comportamiento de app ──────────── */
/* El doble-tap-zoom lo mata `touch-action: manipulation` (CSS, en body),
   y el zoom por pellizco lo bloquean estos gestos + user-scalable=no. */
function blockZoom() {
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev =>
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
  );
}

/* ── 8. CONTADOR DE TAREAS ──────────────────────────────────────── */
function ct(d) {
  tdCount = Math.max(0, Math.min(5, tdCount + d));

  const tdEl   = document.getElementById('td');
  const numEl  = document.getElementById('td-num');
  const fillEl = document.getElementById('td-fill');

  if (tdEl)   tdEl.textContent   = tdCount;
  if (numEl)  numEl.textContent  = `${tdCount} / 5 TAREAS`;
  if (fillEl) fillEl.style.width = `${(tdCount / 5) * 100}%`;
}

/* ── 9. PREFILL: carga el log de hoy en el formulario ───────────── */
function aplicarLogHoy(log) {
  const set = (id, v) => { const el = document.getElementById(id); if (el && v !== null && v !== undefined) el.value = v; };
  set('is',  log.sueno);
  set('ie',  log.energia);
  set('in',  log.nutricion);
  set('itt', log.tipo_entreno || 'gym');
  set('in2', log.notas || '');

  const ev = document.getElementById('ev');
  const nv = document.getElementById('nv');
  if (ev && log.energia   != null) ev.textContent = log.energia;
  if (nv && log.nutricion != null) nv.textContent = log.nutricion;

  const iet = document.getElementById('iet');
  if (iet) iet.checked = !!log.entreno_completado;

  tdCount = parseInt(log.tareas_completadas) || 0;
  ct(0);
}

/* ── 10. GUARDAR DÍA ────────────────────────────────────────────── */
async function saveLog() {
  const isEl  = document.getElementById('is');
  const ieEl  = document.getElementById('ie');
  const ietEl = document.getElementById('iet');
  const ittEl = document.getElementById('itt');
  const inEl  = document.getElementById('in');
  const in2El = document.getElementById('in2');
  const bsv   = document.getElementById('bsv');

  const payload = {
    fecha:               hoyISO(),
    sueno:               parseFloat(isEl?.value)    || 0,
    energia:             parseInt(ieEl?.value)       || 0,
    entreno_completado:  ietEl?.checked              || false,
    tipo_entreno:        ittEl?.value?.trim()         || '',
    nutricion:           parseInt(inEl?.value)        || 0,
    tareas_completadas:  tdCount,
    tareas_total:        5,
    notas:               in2El?.value?.trim()         || ''
  };

  if (bsv) { bsv.disabled = true; bsv.textContent = 'GUARDANDO...'; }

  try {
    const res = await api('/logs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(res.status);

    if (bsv) {
      bsv.textContent = '✓ GUARDADO';
      bsv.style.background = 'var(--success)';
      bsv.style.color      = '#000';
    }
    toast('Día guardado');
    setTimeout(() => {
      if (bsv) {
        bsv.disabled         = false;
        bsv.textContent      = 'GUARDAR DÍA';
        bsv.style.background = '';
        bsv.style.color      = '';
      }
    }, 2000);

    const logsRes = await api('/logs');
    const logs    = logsRes.ok ? await logsRes.json() : [];
    updateStreakBar(logs);
    updatePlayer(logs);

  } catch {
    if (bsv) {
      bsv.disabled    = false;
      bsv.textContent = 'ERROR — REINTENTAR';
    }
    toast('No se pudo guardar', 'error');
  }
}

/* ── 11. HISTORIAL — cargar ─────────────────────────────────────── */
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
      hl.innerHTML = '<div class="empty-state">Sin registros todavía. Guarda tu primer día en HOY.</div>';
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

/* ── 12. NIVEL + XP (HUD del jugador, estilo "System") ──────────── */

/* XP de un día según lo cumplido */
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

/* Rango según nivel (D → S) */
function rankForLevel(lvl) {
  if (lvl >= 26) return ['S', 'rank-s'];
  if (lvl >= 17) return ['A', 'rank-a'];
  if (lvl >= 10) return ['B', 'rank-b'];
  if (lvl >= 5)  return ['C', 'rank-c'];
  return ['D', 'rank-d'];
}

function updatePlayer(logs) {
  const windowed = Array.isArray(logs) ? logs.reduce((a, l) => a + dayXP(l), 0) : 0;

  /* XP monotónica: nunca baja aunque un día salga de la ventana de 30 */
  const prev = parseInt(localStorage.getItem('okiro_xp') || '0', 10) || 0;
  const totalXP = Math.max(prev, windowed);
  localStorage.setItem('okiro_xp', String(totalXP));

  /* Curva: nivel L→L+1 requiere 80 + (L-1)·40 XP */
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

  /* Aviso de subida de nivel */
  if (prevLvl && lvl > prevLvl && typeof toast === 'function') {
    toast(`⬆ NIVEL ${lvl} — RANGO ${rankForLevel(lvl)[0]}`, 'ok');
  }
  localStorage.setItem('okiro_lvl', String(lvl));
}

/* ── 13. STREAK BAR ─────────────────────────────────────────────── */
function updateStreakBar(logs) {
  const days = document.querySelectorAll('.streak-day');
  if (!days.length) return;

  /* data-day usa L M X J V S D (lunes=L … domingo=D) */
  const dayMap = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 0 };

  const today   = new Date();
  const todayDow = today.getDay(); /* 0=dom */

  const done = new Set();
  if (Array.isArray(logs)) {
    logs.forEach(l => {
      if (l.entreno_completado) {
        done.add(new Date(l.fecha).toDateString());
      }
    });
  }

  days.forEach(el => {
    const key = el.dataset.day;
    const dow  = dayMap[key];
    if (dow === undefined) return;

    /* Fecha de ese día en la semana actual (lun–dom), siempre hacia atrás */
    let diff = dow - todayDow;
    if (dow === 0 && todayDow !== 0) diff = 7 - todayDow; /* domingo al final */
    else if (diff > 0) diff -= 7;
    const date = new Date(today);
    date.setDate(today.getDate() + diff);

    const isToday = date.toDateString() === today.toDateString();
    const isDone  = done.has(date.toDateString());
    const isFuture = date > today;

    el.classList.toggle('done',  isDone && !isFuture);
    el.classList.toggle('today', isToday);
  });
}

/* ── 14. CERRAR MODAL ───────────────────────────────────────────── */
function closeMissionModal() {
  const modal   = document.getElementById('mission-modal');
  const overlay = document.getElementById('mission-overlay');
  if (modal) modal.classList.add('hiding');
  setTimeout(() => {
    if (overlay) overlay.style.display = 'none';
    if (modal)   modal.classList.remove('hiding');
  }, 300);
}

/* ── 15. MODAL DE MISIÓN DIARIA ─────────────────────────────────── */
async function showMissionModal() {
  const todayStr = hoyISO();
  if (localStorage.getItem('missionShown') === todayStr) return;

  const overlay  = document.getElementById('mission-overlay');
  const bodyEl   = document.getElementById('mission-body');
  const typerEl  = document.getElementById('mm-typewriter');
  const acceptEl = document.getElementById('mm-accept');

  if (!overlay) return;
  overlay.style.display = 'flex';

  if (typerEl) {
    typewriterEffect(typerEl, 'SISTEMA DE MISIONES ACTIVADO', 35);
  }

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

    const ayer      = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const ayerStr   = ayer.toISOString().split('T')[0];
    const logAyer   = logs.find(l => l.fecha && String(l.fecha).startsWith(ayerStr));

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
        AYER — 💤${logAyer.sueno || '?'}h · ⚡${logAyer.energia || '?'} ·
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

/* ── 16. CARGA INICIAL DE DATOS ─────────────────────────────────── */
async function initData() {
  /* Prefill de HOY + racha + día */
  try {
    const res  = await api('/logs');
    const logs = res.ok ? await res.json() : [];
    updateStreakBar(logs);
    updatePlayer(logs);
    const log = Array.isArray(logs)
      ? logs.find(l => l.fecha && String(l.fecha).startsWith(hoyISO()) || (l.fecha?.toISOString?.() || '').startsWith(hoyISO()))
      : null;
    if (log) aplicarLogHoy(log);
  } catch {}

  /* Modal de misión */
  setTimeout(showMissionModal, 800);
}

/* ── 17. INIT ───────────────────────────────────────────────────── */
window.onload = async () => {
  /* Reloj */
  updateClock();
  setInterval(updateClock, 1000);

  /* Espejos de sliders */
  const ieEl = document.getElementById('ie');
  const evEl = document.getElementById('ev');
  if (ieEl && evEl) {
    ieEl.addEventListener('input', () => { evEl.textContent = ieEl.value; });
  }
  const inEl = document.getElementById('in');
  const nvEl = document.getElementById('nv');
  if (inEl && nvEl) {
    inEl.addEventListener('input', () => { nvEl.textContent = inEl.value; });
  }

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

  /* Nav deslizante + bloqueo de zoom */
  setupNav();
  blockZoom();

  /* Acceso + datos */
  const ok = await checkAccess();
  if (ok) initData();

  /* Service worker (PWA offline + instalable) */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
};
