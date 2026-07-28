// OkiroSport — Lógica de Proyectos
//
// La pantalla se ordena alrededor del FIN de cada proyecto, no de su estado:
// lo primero que se lee es a dónde va y cuánto le falta. Lo que no tiene fin
// declarado se marca, porque sin meta no hay forma de saber si avanza.
// Los trabajos de cliente cuelgan de la marca que los firma (padre_id).

/* ── ESTADO ─────────────────────────────────────────────────────── */
let _editProjId = null;
let _proyectos  = [];   // último GET, para poblar el modal sin volver a pedir

/* ── 1. RANGO Y FORMATO ─────────────────────────────────────────── */
function getRank(progreso) {
  if (progreso <= 20) return ['D', 'rank-d'];
  if (progreso <= 40) return ['C', 'rank-c'];
  if (progreso <= 60) return ['B', 'rank-b'];
  if (progreso <= 80) return ['A', 'rank-a'];
  return ['S', 'rank-s'];
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* 10000 → "10.000"; 3.5 → "3,5" (formato español, sin decimales inútiles) */
function fmtNum(n) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return v.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

/* "hace 3 días" a partir de updated_at */
function fmtInactivo(dias) {
  if (dias === null || dias === undefined) return '';
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30)  return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'hace 1 mes' : `hace ${meses} meses`;
}

const CATEGORIAS = {
  negocio:     'Negocio',
  fisico:      'Físico',
  aprendizaje: 'Aprendizaje',
  personal:    'Personal'
};

/* ── 2. EL FIN DEL PROYECTO ─────────────────────────────────────── */
/* Es el bloque que manda en la tarjeta: meta, dónde vas y cuánto falta. */
function finHTML(p) {
  const metaV = Number(p.meta_valor);

  // Un padre sin meta propia solo resume a sus hijos. Con meta propia se
  // pinta como cualquier otro, más la nota de lo que engloba.
  if (p.es_padre && !(metaV > 0)) {
    return `<div class="pm pm-padre">Resume ${p.hijos.length} proyecto${p.hijos.length === 1 ? '' : 's'}</div>`;
  }
  const nota = p.es_padre
    ? `<div class="pm-engloba">y engloba ${p.hijos.length} proyectos</div>` : '';
  if (metaV > 0) {
    const actual = Number(p.valor_actual) || 0;
    const falta  = Math.max(0, metaV - actual);
    const unidad = esc(p.metrica || '');
    return `<div class="pm">
  <div class="pm-meta">${esc(p.meta || 'Meta')}</div>
  <div class="pm-cifra">
    <strong>${fmtNum(actual)}</strong> de ${fmtNum(metaV)} ${unidad}
    ${falta > 0 ? `<span class="pm-falta">faltan ${fmtNum(falta)}</span>` : '<span class="pm-hecho">meta alcanzada</span>'}
  </div>${nota}
</div>`;
  }

  if (p.meta) {
    // Fin declarado pero sin número: sirve de norte, no de medida.
    return `<div class="pm"><div class="pm-meta">${esc(p.meta)}</div>
      <div class="pm-cifra pm-sincifra">sin cifra que medir</div>${nota}</div>`;
  }

  return `<button class="pm pm-vacia" onclick="updP(${p.id})">
    SIN FIN DEFINIDO · ponle una meta</button>`;
}

/* ── 3. TARJETA ─────────────────────────────────────────────────── */
function cardHTML(p, esHijo = false) {
  const prog = p.progreso_real ?? p.progreso ?? 0;
  const [label, cls] = getRank(prog);
  const cat = p.categoria ? `<span class="pc-cat">${esc(CATEGORIAS[p.categoria] || p.categoria)}</span>` : '';
  const inactivo = fmtInactivo(p.dias_inactivo);
  const alerta   = p.dias_inactivo >= 30 && !p.es_padre ? ' pc-parado' : '';

  return `<div class="pc${esHijo ? ' pc-hijo' : ''}${alerta}">
  <div class="pc-header">
    <span class="rank-badge ${cls}">${label}</span>
    <div class="pc-head-right">
      ${cat}
      <span class="pc-dias">${inactivo}</span>
      <button class="proj-del-btn" data-id="${p.id}" data-nombre="${esc(p.nombre)}"
              onclick="deleteP(+this.dataset.id, this.dataset.nombre)"
              title="Eliminar proyecto">${OKICON.cross}</button>
    </div>
  </div>
  <div class="pp">${esc(p.nombre)}</div>
  ${p.objetivo ? `<div class="po">${esc(p.objetivo)}</div>` : ''}
  ${finHTML(p)}
  <div class="ph"><div class="pf" style="width:${prog}%"></div></div>
  <div class="pc-bottom">
    <span class="pi">${p.ultima_accion ? esc(p.ultima_accion) : 'sin acciones registradas'}</span>
    <span class="pc-pct">${prog}%</span>
  </div>
  <button onclick="updP(${p.id})" class="bu pc-btn">ACTUALIZAR</button>
</div>`;
}

/* ── 4. CARGAR ──────────────────────────────────────────────────── */
async function loadP() {
  const pl = document.getElementById('pl');
  if (!pl) return;
  pl.innerHTML = '<div class="empty-state">Cargando...</div>';

  const formHTML = `
<button class="bs np-toggle-btn" onclick="toggleNewProjForm()">+ NUEVO PROYECTO</button>
<div id="new-proj-form" class="np-form">
  <div class="ct" style="margin-bottom:12px">NUEVO PROYECTO</div>
  <div class="form-field" style="margin-bottom:8px">
    <label>Nombre</label>
    <input type="text" id="np-nombre" placeholder="Nombre del proyecto...">
  </div>
  <div class="form-field" style="margin-bottom:8px">
    <label>¿De qué va?</label>
    <textarea id="np-desc" placeholder="Una línea" style="min-height:48px"></textarea>
  </div>
  <div class="form-field" style="margin-bottom:8px">
    <label>¿A qué fin? <span class="lbl-hint">lo que lo hace medible</span></label>
    <input type="text" id="np-meta" placeholder="Ej: facturar 10.000 €/mes">
  </div>
  <div class="np-row">
    <div class="form-field">
      <label>Meta</label>
      <input type="number" id="np-meta-valor" placeholder="10000" inputmode="decimal">
    </div>
    <div class="form-field">
      <label>Unidad</label>
      <input type="text" id="np-metrica" placeholder="€/mes">
    </div>
  </div>
  <div class="np-row" style="margin-bottom:12px">
    <div class="form-field">
      <label>Categoría</label>
      <select id="np-categoria">
        <option value="">—</option>
        ${Object.entries(CATEGORIAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
    </div>
    <div class="form-field">
      <label>Cuelga de</label>
      <select id="np-padre"><option value="">Nada (independiente)</option></select>
    </div>
  </div>
  <button class="bs" onclick="createP()" style="margin-bottom:6px">CREAR PROYECTO</button>
  <button onclick="toggleNewProjForm()" style="width:100%;padding:10px;background:none;border:none;color:var(--text-3);font-family:var(--font-sans);font-size:.6rem;cursor:pointer">CANCELAR</button>
</div>`;

  try {
    const res  = await api('/proyectos');
    const data = await res.json();
    _proyectos = Array.isArray(data) ? data : [];

    if (!_proyectos.length) {
      pl.innerHTML = formHTML + '<div class="empty-state">Sin proyectos activos</div>';
      rellenaSelectPadres();
      return;
    }

    const sinMeta = _proyectos.filter(p => p.sin_meta && !p.es_padre).length;
    const resumen = `<div class="proj-resumen">
      <span>${_proyectos.length} proyectos</span>
      ${sinMeta ? `<span class="proj-resumen-alerta">${sinMeta} sin fin definido</span>` : '<span class="proj-resumen-ok">todos con fin</span>'}
    </div>`;

    // Padres primero, con sus hijos dentro; después los independientes.
    const padres  = _proyectos.filter(p => p.es_padre);
    const sueltos = _proyectos.filter(p => !p.es_padre && !p.padre_id);

    const grupos = padres.map(padre => {
      const hijos = _proyectos.filter(h => h.padre_id === padre.id);
      return `<div class="proj-grupo">
        ${cardHTML(padre)}
        <div class="proj-hijos">${hijos.map(h => cardHTML(h, true)).join('')}</div>
      </div>`;
    }).join('');

    pl.innerHTML = formHTML + resumen + grupos + sueltos.map(p => cardHTML(p)).join('');
    rellenaSelectPadres();
    notionEstado();

  } catch {
    pl.innerHTML = formHTML + '<div class="empty-state">Error cargando proyectos</div>';
  }
}

/* ── PUENTE CON NOTION ──────────────────────────────────────────── */
/* OKIRO es donde se rellena; Notion solo enseña. El envío va de aquí
   hacia allá y el backend lo repite solo tras cada cambio.           */
function toggleNotionBox() {
  document.getElementById('notion-form')?.classList.toggle('open');
}

function toggleNotionBase() {
  document.getElementById('notion-base')?.classList.toggle('open');
}

async function notionEstado() {
  const el = document.getElementById('notion-estado');
  if (!el) return;
  const abrir = document.getElementById('nt-abrir');
  try {
    const res = await api('/notion/estado');
    const e   = await res.json();

    if (abrir) {
      abrir.hidden = !e.url;
      if (e.url) abrir.href = e.url;
    }

    if (!e.conectado) {
      el.textContent = 'Sin conectar';
      el.className   = 'notion-estado';
      return;
    }
    if (!e.base_creada) {
      el.textContent = 'Token guardado, falta crear la base';
      el.className   = 'notion-estado notion-medio';
      return;
    }
    const cuando = e.ultimo_push
      ? new Date(e.ultimo_push).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : 'nunca';
    el.textContent = `Conectado · ${e.enlazados}/${e.total} en Notion · último envío: ${cuando}`;
    el.className   = 'notion-estado notion-ok';
  } catch {
    el.textContent = 'No se pudo comprobar';
    el.className   = 'notion-estado';
  }
}

/* Rotar el token es lo normal y la base ya existe: guardar el token no crea
   ni toca nada allí. El servidor lo prueba contra Notion antes de guardarlo. */
async function notionGuardarToken() {
  const campo = document.getElementById('nt-token');
  const token = campo?.value.trim() || '';
  if (!token) { toast('Pega el token de la integración', 'error'); return; }

  try {
    toast('Comprobando el token...');
    const res  = await api('/notion/config', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el token');

    // El token ya está en el servidor: se borra del formulario en cuanto viaja.
    if (campo) campo.value = '';

    if (data.base_creada && !data.base_ok) {
      toast('Token guardado, pero no ve la base: dale acceso en Notion', 'error');
    } else {
      toast('Token guardado y funcionando');
    }
    notionEstado();
  } catch (e) {
    toast(e.message || 'Error guardando el token', 'error');
  }
}

/* Solo para la primera vez, o si se quiere empezar de cero en otra página. */
async function notionCrearBase() {
  const pagina = document.getElementById('nt-pagina')?.value.trim() || '';
  if (!pagina) { toast('Pega el enlace de la página de Notion', 'error'); return; }

  try {
    toast('Creando la base en Notion...');
    const res  = await api('/notion/setup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pagina })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error creando la base');

    toast('Base creada en Notion');
    await notionSync();
  } catch (e) {
    toast(e.message || 'Error creando la base', 'error');
  }
}

async function notionSync() {
  try {
    toast('Enviando a Notion...');
    const res  = await api('/notion/push', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al enviar');
    const partes = [];
    if (data.creados)      partes.push(`${data.creados} creados`);
    if (data.actualizados) partes.push(`${data.actualizados} actualizados`);
    toast(partes.length ? partes.join(' · ') : 'Nada que enviar');
    if (data.errores?.length) toast(data.errores[0], 'error');
    notionEstado();
  } catch (e) {
    toast(e.message || 'Error al enviar a Notion', 'error');
  }
}

/* Solo pueden ser padres los que no cuelgan de nadie: la jerarquía es de un nivel. */
function rellenaSelectPadres(selectId = 'np-padre', excluirId = null, valor = '') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const candidatos = _proyectos.filter(p => !p.padre_id && p.id !== excluirId);
  sel.innerHTML = '<option value="">Nada (independiente)</option>' +
    candidatos.map(p => `<option value="${p.id}"${String(valor) === String(p.id) ? ' selected' : ''}>${esc(p.nombre)}</option>`).join('');
}

/* ── 5. NUEVO PROYECTO ──────────────────────────────────────────── */
function toggleNewProjForm() {
  const form = document.getElementById('new-proj-form');
  if (!form) return;
  const opening = !form.classList.contains('open');
  form.classList.toggle('open');
  if (opening) setTimeout(() => document.getElementById('np-nombre')?.focus(), 50);
}

async function createP() {
  const val = id => document.getElementById(id)?.value.trim() || '';
  const nombre = val('np-nombre');
  if (!nombre) { toast('Introduce un nombre para el proyecto', 'error'); return; }

  try {
    const res = await api('/proyectos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        nombre,
        objetivo:   val('np-desc'),     // el backend leía `objetivo`, no `descripcion`:
        meta:       val('np-meta'),     // por eso los proyectos nacían sin objetivo
        meta_valor: val('np-meta-valor'),
        metrica:    val('np-metrica'),
        categoria:  val('np-categoria'),
        padre_id:   val('np-padre')
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.status);
    }
    toast('Proyecto creado');
    toggleNewProjForm();
    ['np-nombre', 'np-desc', 'np-meta', 'np-meta-valor', 'np-metrica'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    loadP();
  } catch (e) {
    toast(e.message || 'Error al crear proyecto', 'error');
  }
}

/* ── 6. ELIMINAR ────────────────────────────────────────────────── */
async function deleteP(id, nombre) {
  const p = _proyectos.find(x => x.id === id);
  const aviso = p?.es_padre
    ? `\nSus ${p.hijos.length} proyectos NO se borran: pasarán a ser independientes.`
    : '';
  if (!confirm(`¿Eliminar "${nombre}"?${aviso}\nEsta acción no se puede deshacer.`)) return;
  try {
    const res = await api(`/proyectos/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.status);
    toast('Proyecto eliminado');
    loadP();
  } catch {
    toast('Error al eliminar proyecto', 'error');
  }
}

/* ── 7. MODAL DE EDICIÓN ────────────────────────────────────────── */
function updP(id) {
  const p = _proyectos.find(x => x.id === id);
  if (!p) return;
  _editProjId = id;

  const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v ?? ''; };
  set('ep-nombre',     p.nombre);
  set('ep-objetivo',   p.objetivo);
  set('ep-meta',       p.meta);
  set('ep-meta-valor', p.meta_valor);
  set('ep-metrica',    p.metrica);
  set('ep-valor',      p.valor_actual);
  set('ep-categoria',  p.categoria);
  set('ep-accion',     '');

  rellenaSelectPadres('ep-padre', id, p.padre_id || '');

  // El slider manual solo tiene sentido sin meta numérica y sin hijos:
  // en los demás casos el progreso es un cálculo, no una opinión.
  const manual = document.getElementById('ep-manual');
  const metaPropia = Number(p.meta_valor) > 0;
  const usaCalculo = p.es_padre || metaPropia;
  if (manual) manual.style.display = usaCalculo ? 'none' : 'block';
  const progInput = document.getElementById('ep-prog');
  const progVal   = document.getElementById('ep-prog-val');
  if (progInput) progInput.value = p.progreso ?? 0;
  if (progVal)   progVal.textContent = (p.progreso ?? 0) + '%';

  const calc = document.getElementById('ep-calculado');
  if (calc) {
    calc.style.display = usaCalculo ? 'block' : 'none';
    calc.textContent = metaPropia
      ? `Progreso calculado desde la meta: ${p.progreso_real}%`
      : `Progreso calculado: media de sus ${p.hijos.length} proyectos (${p.progreso_real}%). Si le pones meta propia, mandará la meta.`;
  }

  cargarHistorial(id);

  const overlay = document.getElementById('edit-proj-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    setTimeout(() => document.getElementById('ep-accion')?.focus(), 80);
  }
}

async function cargarHistorial(id) {
  const cont = document.getElementById('ep-historial');
  if (!cont) return;
  cont.innerHTML = '<div class="ep-hist-vacio">Cargando historial...</div>';
  try {
    const res  = await api(`/proyectos/${id}/acciones`);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) {
      cont.innerHTML = '<div class="ep-hist-vacio">Sin acciones registradas todavía</div>';
      return;
    }
    cont.innerHTML = data.slice(0, 8).map(a => `<div class="ep-hist-item">
      <span class="ep-hist-fecha">${esc(String(a.fecha).slice(0, 10))}</span>
      <span class="ep-hist-txt">${esc(a.accion)}</span>
    </div>`).join('');
  } catch {
    cont.innerHTML = '<div class="ep-hist-vacio">No se pudo cargar el historial</div>';
  }
}

function closeEditProjModal() {
  const overlay = document.getElementById('edit-proj-overlay');
  if (overlay) overlay.style.display = 'none';
  _editProjId = null;
}

async function saveEditP() {
  if (_editProjId === null) return;
  const val = id => document.getElementById(id)?.value.trim() ?? '';

  const nombre = val('ep-nombre');
  if (!nombre) { toast('El nombre no puede quedar vacío', 'error'); return; }

  const body = {
    nombre,
    objetivo:      val('ep-objetivo'),
    meta:          val('ep-meta'),
    meta_valor:    val('ep-meta-valor'),
    metrica:       val('ep-metrica'),
    valor_actual:  val('ep-valor'),
    categoria:     val('ep-categoria'),
    padre_id:      val('ep-padre'),
    ultima_accion: val('ep-accion')
  };
  // El progreso manual solo se manda cuando es él quien manda.
  if (document.getElementById('ep-manual')?.style.display !== 'none') {
    body.progreso = Math.max(0, Math.min(100, parseInt(val('ep-prog')) || 0));
  }

  try {
    const res = await api(`/proyectos/${_editProjId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.status);
    }
    toast('Proyecto actualizado');
    closeEditProjModal();
    loadP();
  } catch (e) {
    toast(e.message || 'Error al actualizar proyecto', 'error');
  }
}
