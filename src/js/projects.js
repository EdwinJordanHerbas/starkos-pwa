// OkiroSport — Lógica de Proyectos

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

  try {
    const res  = await api('/proyectos');
    const data = await res.json();

    if (!Array.isArray(data) || !data.length) {
      pl.innerHTML = '<div class="empty-state">Sin proyectos activos</div>';
      return;
    }

    pl.innerHTML = data.map(p => {
      const [label, cls] = getRank(p.progreso ?? 0);
      return `<div class="pc">
  <span class="rank-badge ${cls}">${label}</span>
  <div class="pp">${p.nombre || ''}</div>
  <div class="po">${p.objetivo || ''}</div>
  <div class="ph"><div class="pf" style="width:${p.progreso ?? 0}%"></div></div>
  <div class="pi">Última acción: ${p.ultima_accion || '—'}</div>
  <button onclick="updP(${p.id}, ${p.progreso ?? 0})" class="bu" style="margin-top:10px;width:100%">ACTUALIZAR</button>
</div>`;
    }).join('');

  } catch {
    pl.innerHTML = '<div class="empty-state">Error cargando proyectos</div>';
  }
}

/* ── 3. ACTUALIZAR ──────────────────────────────────────────────── */
async function updP(id, actual) {
  const accion = prompt('Última acción realizada:');
  if (accion === null) return;

  const val = prompt(`Nuevo progreso (0–100). Actual: ${actual}%`, actual);
  if (val === null) return;
  const progreso = Math.max(0, Math.min(100, parseInt(val) || 0));

  try {
    const res = await api(`/proyectos/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ultima_accion: accion.trim(), progreso })
    });
    if (!res.ok) throw new Error(res.status);
    toast('Proyecto actualizado');
    loadP();
  } catch {
    toast('Error al actualizar proyecto', 'error');
  }
}
