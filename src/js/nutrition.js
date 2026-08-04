// OKIRO — Nutrición
//
// Los objetivos de macros vivían solo en el localStorage de este móvil, así
// que había tres verdades a la vez: lo que ponías aquí, los 2400/180/300/70
// que el servidor llevaba escritos a mano en el prompt del coach IA, y los
// 2200/160 del resumen de HOY. Editarlos no cambiaba ninguno de los otros dos
// y al cambiar de móvil se perdían. Ahora mandan los de la base de datos y
// localStorage queda solo como copia para poder pintar sin conexión.

/* ── 1. OBJETIVOS ───────────────────────────────────────────────── */
const MACRO_DEFAULTS = { proteinas: 180, carbos: 300, grasas: 70, calorias: 2400 };

let _goals = null;   // lo último que dijo el servidor

/** Lectura sin esperar, para pintar: memoria → copia local → por defecto. */
function getGoals() {
  if (_goals) return _goals;
  try {
    const saved = JSON.parse(localStorage.getItem('okiro_goals') || 'null');
    return Object.assign({}, MACRO_DEFAULTS, saved || {});
  } catch { return { ...MACRO_DEFAULTS }; }
}

/** Los de verdad, del servidor. Si no hay red, se queda con la copia local. */
async function cargarObjetivos() {
  try {
    const res = await api('/nutricion/objetivos');
    if (res.ok) {
      _goals = await res.json();
      localStorage.setItem('okiro_goals', JSON.stringify(_goals));
      return _goals;
    }
  } catch { /* sin conexión: se sigue con lo último que se sabía */ }
  _goals = getGoals();
  return _goals;
}

/* ── 2. CARGAR ──────────────────────────────────────────────────── */
async function loadNutri() {
  const fecha = hoyISO();

  // Los objetivos primero: si no, las barras se pintan contra los de por
  // defecto y saltan al valor bueno un instante después.
  await cargarObjetivos();

  try {
    const res  = await api(`/nutricion/${fecha}`);
    const data = res.ok ? await res.json() : { comidas: [], totales: {} };

    renderNutriTotals(data.totales || {});
    renderMeals(data.comidas || []);
  } catch {
    renderNutriTotals({});
    renderMeals([]);
  }
}

/* ── 3. TOTALES ─────────────────────────────────────────────────── */
function renderNutriTotals(t) {
  const goals = getGoals();
  const kcal = Math.round(t.calorias  || 0);
  const prot = Math.round(t.proteinas || 0);
  const carb = Math.round(t.carbos    || 0);
  const fat  = Math.round(t.grasas    || 0);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('n-kcal', kcal);
  set('n-prot', prot);
  set('n-carb', carb);
  set('n-fat',  fat);
  set('n-kcal-goal', `/ ${goals.calorias} KCAL`);
  set('n-prot2', `${prot}g / ${goals.proteinas}g`);
  set('n-carb2', `${carb}g / ${goals.carbos}g`);
  set('n-fat2',  `${fat}g / ${goals.grasas}g`);

  const pct = (v, goal) => Math.min(100, Math.round((v / goal) * 100));
  const setW = (id, w) => { const el = document.getElementById(id); if (el) el.style.width = `${w}%`; };
  setW('bar-prot', pct(prot, goals.proteinas));
  setW('bar-carb', pct(carb, goals.carbos));
  setW('bar-fat',  pct(fat,  goals.grasas));
}

/* ── 4. EDITAR OBJETIVOS ────────────────────────────────────────── */
/* Eran cuatro prompt() encadenados: cancelar el primero descartaba todo
   y no se veía en ningún momento si las cifras cuadraban entre sí.     */
async function editGoals() {
  const ov = document.getElementById('macros-overlay');
  if (!ov) return;

  const g = await cargarObjetivos();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('mo-kcal', g.calorias);
  set('mo-prot', g.proteinas);
  set('mo-carb', g.carbos);
  set('mo-fat',  g.grasas);

  ov.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  ['mo-kcal', 'mo-prot', 'mo-carb', 'mo-fat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = revisarMacros;
  });
  revisarMacros();
}

function cerrarMacros() {
  const ov = document.getElementById('macros-overlay');
  if (ov) ov.style.display = 'none';
  document.body.style.overflow = '';
}

/** Las kcal que suman los macros (4/4/9) frente a las que has puesto. */
function revisarMacros() {
  const val = id => parseInt(document.getElementById(id)?.value, 10) || 0;
  const kcal = val('mo-kcal'), prot = val('mo-prot'), carb = val('mo-carb'), fat = val('mo-fat');
  const suma = prot * 4 + carb * 4 + fat * 9;
  const el = document.getElementById('mo-calc');
  if (!el) return;

  const dif = suma - kcal;
  const desvio = Math.abs(dif) > Math.max(50, kcal * 0.05);
  el.innerHTML = `
    Esos macros suman <strong>${suma} kcal</strong>
    (${prot}×4 + ${carb}×4 + ${fat}×9).
    ${desvio
      ? `<span class="mo-desvio">Son ${Math.abs(dif)} kcal ${dif > 0 ? 'más' : 'menos'} que tu objetivo de calorías.</span>`
      : 'Cuadra con tu objetivo de calorías.'}`;
}

async function guardarMacros() {
  const val = id => parseInt(document.getElementById(id)?.value, 10);
  const body = {
    calorias:  val('mo-kcal'),
    proteinas: val('mo-prot'),
    carbos:    val('mo-carb'),
    grasas:    val('mo-fat')
  };
  if (!body.calorias || body.calorias <= 0) {
    toast('Las calorías tienen que ser un número mayor que cero', 'error');
    return;
  }
  if (Object.values(body).some(v => !Number.isFinite(v) || v < 0)) {
    toast('Revisa los números: hay alguno vacío o negativo', 'error');
    return;
  }

  try {
    const res = await api('/nutricion/objetivos', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error guardando');
    }
    _goals = await res.json();
    localStorage.setItem('okiro_goals', JSON.stringify(_goals));
    cerrarMacros();
    toast('Objetivos actualizados. La IA ya usa estos números.');
    loadNutri();
  } catch (e) {
    toast(e.message || 'No se pudieron guardar', 'error');
  }
}

/* ── 5. LISTA DE COMIDAS ────────────────────────────────────────── */
function renderMeals(comidas) {
  const ml = document.getElementById('meals-list');
  if (!ml) return;

  if (!comidas.length) {
    ml.innerHTML = '<div class="empty-state">Sin comidas registradas hoy.<br>Haz una foto o añade manual.</div>';
    return;
  }

  ml.innerHTML = comidas.map(c => `
    <div class="meal-card">
      <div style="flex:1;min-width:0">
        <span class="meal-name">${c.nombre || ''}</span>
        <span class="meal-macros">${Math.round(c.calorias || 0)} kcal · ${Math.round(c.proteinas || 0)}g P · ${Math.round(c.carbos || 0)}g C · ${Math.round(c.grasas || 0)}g G</span>
      </div>
      <button class="meal-del" onclick="borrarComida(${c.id})" aria-label="Eliminar comida">${OKICON.cross}</button>
    </div>`
  ).join('');
}

/* ── 6. BORRAR COMIDA ───────────────────────────────────────────── */
async function borrarComida(id) {
  if (!confirm('¿Eliminar esta comida?')) return;
  try {
    const res = await api(`/nutricion/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.status);
    toast('Comida eliminada');
    loadNutri();
  } catch {
    toast('No se pudo eliminar', 'error');
  }
}

/* ── 7. GUARDAR COMIDA MANUAL ───────────────────────────────────── */
async function guardarComida() {
  const nombreEl = document.getElementById('m-nombre');
  const kcalEl   = document.getElementById('m-kcal');
  const protEl   = document.getElementById('m-prot');
  const carbEl   = document.getElementById('m-carb');
  const fatEl    = document.getElementById('m-fat');
  const formEl   = document.getElementById('add-meal-form');

  const nombre   = nombreEl?.value?.trim() || '';
  const calorias = parseInt(kcalEl?.value) || 0;

  if (!nombre || calorias <= 0) {
    toast('Pon nombre y calorías', 'error');
    return;
  }

  const fecha = hoyISO();

  try {
    const res = await api('/nutricion', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        fecha,
        nombre,
        calorias,
        proteinas: parseInt(protEl?.value) || 0,
        carbos:    parseInt(carbEl?.value) || 0,
        grasas:    parseInt(fatEl?.value)  || 0
      })
    });
    if (!res.ok) throw new Error(res.status);

    if (nombreEl) nombreEl.value = '';
    if (kcalEl)   kcalEl.value   = '';
    if (protEl)   protEl.value   = '';
    if (carbEl)   carbEl.value   = '';
    if (fatEl)    fatEl.value    = '';
    if (formEl)   formEl.classList.remove('open');

    toast('Comida guardada');
    loadNutri();
  } catch {
    toast('Error al guardar comida', 'error');
  }
}

/* ── 8. ANALIZAR FOTO (IA en el servidor — sin configurar nada) ─── */
async function analizarFoto(input) {
  if (!input.files[0]) return;
  const btn = document.getElementById('btn-foto');
  btn.disabled = true;
  btn.innerHTML = '<span>◑</span> ANALIZANDO...';
  try {
    const file = input.files[0];
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const resp = await api('/nutricion/analizar-foto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imagen_base64: base64,
        media_type: file.type || 'image/jpeg'
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    document.getElementById('m-nombre').value = data.nombre || '';
    document.getElementById('m-kcal').value = Math.round(data.calorias) || '';
    document.getElementById('m-prot').value = Math.round(data.proteinas) || '';
    document.getElementById('m-carb').value = Math.round(data.carbos) || '';
    document.getElementById('m-fat').value = Math.round(data.grasas) || '';
    document.getElementById('add-meal-form').classList.add('open');
    toast('Foto analizada — revisa y guarda');
  } catch (e) {
    toast('Error al analizar: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>◑</span> ANALIZAR FOTO IA';
    input.value = '';
  }
}
