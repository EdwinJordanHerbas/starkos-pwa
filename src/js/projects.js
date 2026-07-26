// OkiroSport — Lógica de Proyectos

/* ── ESTADO ─────────────────────────────────────────────────────── */
let _editProjId = null;

/* ── 1. RANGO ───────────────────────────────────────────────────── */
function getRank(progreso) {
  if (progreso <= 20) return ['D', 'rank-d'];
  if (progreso <= 40) return ['C', 'rank-c'];
  if (progreso <= 60) return ['B', 'rank-b'];
  if (progreso <= 80) return ['A', 'rank-a'];
  return ['S', 'rank-s'];
}

/* ── 2. CARGAR ──────────────────────────────────────────────────── */
async function loadP() {
  const pl = document.getElementById('pl');
  if (!pl) return;
  pl.innerHTML = '<div class="empty-state">Cargando...</div>';

  /* Formulario de nuevo proyecto (siempre presente) */
  const formHTML = `
<button class="bs np-toggle-btn" onclick="toggleNewProjForm()">+ NUEVO PROYECTO</button>
<div id="new-proj-form" class="np-form">
  <div class="ct" style="margin-bottom:12px">NUEVO PROYECTO</div>
  <div class="form-field" style="margin-bottom:8px">
    <label>Nombre</label>
    <input type="text" id="np-nombre" placeholder="Nombre del proyecto...">
  </div>
  <div class="form-field" style="margin-bottom:12px">
    <label>Descripción (opcional)</label>
    <textarea id="np-desc" placeholder="¿De qué va?" style="min-height:56px"></textarea>
  </div>
  <button class="bs" onclick="createP()" style="margin-bottom:6px">CREAR PROYECTO</button>
  <button onclick="toggleNewProjForm()" style="width:100%;padding:10px;background:none;border:none;color:var(--text-3);font-family:var(--font-sans);font-size:.6rem;cursor:pointer">CANCELAR</button>
</div>`;

  try {
    const res  = await api('/proyectos');
    const data = await res.json();

    if (!Array.isArray(data) || !data.length) {
      pl.innerHTML = formHTML + '<div class="empty-state">Sin proyectos activos</div>';
      return;
    }

    pl.innerHTML = formHTML + data.map(p => {
      const [label, cls] = getRank(p.progreso ?? 0);
      /* Escapa el nombre para data-attr */
      const nombreEsc = (p.nombre || '').replace(/"/g, '&quot;');
      return `<div class="pc">
  <div class="pc-header">
    <span class="rank-badge ${cls}">${label}</span>
    <button class="proj-del-btn" data-id="${p.id}" data-nombre="${nombreEsc}"
            onclick="deleteP(+this.dataset.id, this.dataset.nombre)"
            title="Eliminar proyecto">${OKICON.cross}</button>
  </div>
  <div class="pp">${p.nombre || ''}</div>
  <div class="po">${p.objetivo || ''}</div>
  <div class="ph"><div class="pf" style="width:${p.progreso ?? 0}%"></div></div>
  <div class="pi">Última acción: ${p.ultima_accion || '—'}</div>
  <button onclick="updP(${p.id}, ${p.progreso ?? 0})" class="bu" style="margin-top:10px;width:100%">ACTUALIZAR</button>
</div>`;
    }).join('');

  } catch {
    pl.innerHTML = formHTML + '<div class="empty-state">Error cargando proyectos</div>';
  }
}

/* ── 3. FORMULARIO NUEVO PROYECTO ───────────────────────────────── */
function toggleNewProjForm() {
  const form = document.getElementById('new-proj-form');
  if (!form) return;
  const opening = !form.classList.contains('open');
  form.classList.toggle('open');
  if (opening) {
    const inp = document.getElementById('np-nombre');
    setTimeout(() => inp?.focus(), 50);
  }
}

async function createP() {
  const nombreEl = document.getElementById('np-nombre');
  const descEl   = document.getElementById('np-desc');
  const nombre   = nombreEl?.value.trim() || '';
  if (!nombre) { toast('Introduce un nombre para el proyecto', 'error'); return; }

  try {
    const res = await api('/proyectos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ nombre, descripcion: descEl?.value.trim() || '' })
    });
    if (!res.ok) throw new Error(res.status);
    toast('Proyecto creado');
    loadP();
  } catch {
    toast('Error al crear proyecto', 'error');
  }
}

/* ── 4. ELIMINAR PROYECTO ───────────────────────────────────────── */
async function deleteP(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}"?\nEsta acción no se puede deshacer.`)) return;
  try {
    const res = await api(`/proyectos/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.status);
    toast('Proyecto eliminado');
    loadP();
  } catch {
    toast('Error al eliminar proyecto', 'error');
  }
}

/* ── 5. MODAL DE EDICIÓN (reemplaza los prompt()) ───────────────── */
function updP(id, actual) {
  _editProjId = id;

  const overlay   = document.getElementById('edit-proj-overlay');
  const progInput = document.getElementById('ep-prog');
  const progVal   = document.getElementById('ep-prog-val');
  const accionEl  = document.getElementById('ep-accion');

  if (progInput) progInput.value = actual;
  if (progVal)   progVal.textContent = actual + '%';
  if (accionEl)  accionEl.value = '';
  if (overlay)   {
    overlay.style.display = 'flex';
    setTimeout(() => accionEl?.focus(), 80);
  }
}

function closeEditProjModal() {
  const overlay = document.getElementById('edit-proj-overlay');
  if (overlay) overlay.style.display = 'none';
  _editProjId = null;
}

async function saveEditP() {
  if (_editProjId === null) return;

  const accionEl = document.getElementById('ep-accion');
  const progEl   = document.getElementById('ep-prog');
  const accion   = accionEl?.value.trim() || '';
  const progreso = Math.max(0, Math.min(100, parseInt(progEl?.value) || 0));

  try {
    const res = await api(`/proyectos/${_editProjId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ultima_accion: accion, progreso })
    });
    if (!res.ok) throw new Error(res.status);
    toast('Proyecto actualizado');
    closeEditProjModal();
    loadP();
  } catch {
    toast('Error al actualizar proyecto', 'error');
  }
}
