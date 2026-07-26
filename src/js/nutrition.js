// OkiroSport — Lógica de Nutrición

/* ── 1. OBJETIVOS (editables, se guardan en el dispositivo) ─────── */
const MACRO_DEFAULTS = { proteinas: 180, carbos: 300, grasas: 70, calorias: 2400 };

function getGoals() {
  try {
    const saved = JSON.parse(localStorage.getItem('okiro_goals') || 'null');
    return Object.assign({}, MACRO_DEFAULTS, saved || {});
  } catch { return { ...MACRO_DEFAULTS }; }
}

function editGoals() {
  const g = getGoals();
  const kcal = parseInt(prompt('Objetivo de calorías (kcal):', g.calorias));
  if (!kcal) return;
  const prot = parseInt(prompt('Objetivo de proteínas (g):', g.proteinas)) || g.proteinas;
  const carb = parseInt(prompt('Objetivo de carbohidratos (g):', g.carbos)) || g.carbos;
  const fat  = parseInt(prompt('Objetivo de grasas (g):', g.grasas)) || g.grasas;
  localStorage.setItem('okiro_goals', JSON.stringify({ calorias: kcal, proteinas: prot, carbos: carb, grasas: fat }));
  toast('Objetivos actualizados');
  loadNutri();
}

/* ── 2. CARGAR ──────────────────────────────────────────────────── */
async function loadNutri() {
  const fecha = hoyISO();

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

/* ── 4. LISTA DE COMIDAS ────────────────────────────────────────── */
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

/* ── 5. BORRAR COMIDA ───────────────────────────────────────────── */
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

/* ── 6. GUARDAR COMIDA MANUAL ───────────────────────────────────── */
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

/* ── 7. ANALIZAR FOTO (IA en el servidor — sin configurar nada) ─── */
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
