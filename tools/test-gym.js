// Prueba de gym.js con un DOM de mentira: se ejecuta el archivo REAL, no una
// copia, y se comprueba el HTML que produce. Cubre buscador, tarjeta de
// ejercicio y visor de técnica.
const fs = require('fs');
const vm = require('vm');

const RAIZ = 'C:/Users/ejord/starkos-pwa';
const src  = fs.readFileSync(`${RAIZ}/src/js/gym.js`, 'utf8');
const cat  = JSON.parse(fs.readFileSync(`${RAIZ}/assets/ejercicios.json`, 'utf8'));
const tec  = JSON.parse(fs.readFileSync(`${RAIZ}/assets/ejercicios-tecnica.json`, 'utf8'));

/* ── DOM mínimo ── */
const nodos = {};
function nodo(id) {
  if (!nodos[id]) nodos[id] = {
    id, innerHTML: '', style: {}, value: '', textContent: '', dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    querySelectorAll: () => [], querySelector: () => null,
    insertAdjacentHTML(_, html) { this.innerHTML += html; },
    focus() {}
  };
  return nodos[id];
}

const ctx = {
  console,
  document: {
    getElementById: nodo,
    querySelectorAll: () => [],
    querySelector: () => null,
    body: { style: {} }
  },
  window: {},
  localStorage: { getItem: () => null, setItem() {} },
  setTimeout, setInterval, clearInterval, requestAnimationFrame: fn => fn(),
  navigator: { vibrate: () => true },
  OKICON: new Proxy({}, { get: (_, k) => `<svg data-i="${String(k)}"></svg>` }),
  toast: (m, t) => console.log(`   [toast${t === 'error' ? ' ERROR' : ''}] ${m}`),
  confirm: () => true,
  prompt:  () => 'TEST',
  api: async () => ({ ok: true, json: async () => ([]) }),
  // El catálogo se sirve del disco en vez de por red
  fetch: async (url) => ({
    ok: true,
    json: async () => (url.includes('tecnica') ? tec : cat)
  })
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'gym.js' });

/* ── Utilidades del test ── */
let fallos = 0;
const comprobar = (nombre, cond, extra = '') => {
  console.log(`${cond ? '  OK  ' : '  MAL '} ${nombre}${extra ? ' — ' + extra : ''}`);
  if (!cond) fallos++;
};

(async () => {
  await ctx.cargarCatalogo();

  console.log('\n── BUSCADOR ──');
  const res = nodo('busc-res');
  const consultas = ['press banca', 'dominada', 'sentadilla', 'curl biceps', 'femoral',
                     'hip thrust', 'gemelos', 'face pull', 'zancada', 'peso muerto',
                     'jalon', 'press frances', 'prensa', 'bulgara', 'plancha'];
  for (const q of consultas) {
    ctx.buscarEjercicios(q);
    const n = (res.innerHTML.match(/class="busc-item"/g) || []).length;
    const primero = (res.innerHTML.match(/class="busc-nom">([^<]+)</) || [])[1] || '—';
    comprobar(`"${q}"`, n > 0, `${n} resultados · 1º: ${primero}`);
  }

  ctx.buscarEjercicios('');
  const basicos = (res.innerHTML.match(/class="busc-item"/g) || []).length;
  comprobar('lista al abrir (básicos)', basicos >= 20, `${basicos} ejercicios`);
  comprobar('la miniatura apunta al backend',
    res.innerHTML.includes('src="ejercicios/media/'),
    (res.innerHTML.match(/src="([^"]+)"/) || [])[1]);

  ctx.buscarEjercicios('xyzzy');
  comprobar('búsqueda sin resultados avisa', res.innerHTML.includes('Ningún ejercicio'));

  console.log('\n── TARJETA DE EJERCICIO ──');
  // Las variables del módulo son `let`: no se ven como propiedades del
  // contexto, así que hay que asignarlas ejecutando dentro de él.
  const enContexto = code => vm.runInContext(code, ctx);
  enContexto('gymSeriesMap = {};');
  const conTecnica = ctx.renderEjercicioCard({
    id: 1, nombre: 'Press banca plano', series: 4, reps_objetivo: '6-10',
    dataset_id: '0025', ultima: { peso: '60.00', reps: 8 }, mejor_peso: '82.50'
  });
  comprobar('miniatura del GIF correcto', conTecnica.includes('ejercicios/media/0025-EIeI8Vf.jpg'));
  comprobar('peso sin decimales de más', conTecnica.includes('60 kg × 8'),
    (conTecnica.match(/última vez[^<]*<strong>([^<]+)/) || [])[1]);
  comprobar('marca el récord', conTecnica.includes('récord 82,5 kg'));
  comprobar('músculo objetivo a la vista', conTecnica.includes('pectoral'));

  const sinTecnica = ctx.renderEjercicioCard({
    id: 2, nombre: 'Invento mío', series: 3, reps_objetivo: '10', dataset_id: null, ultima: null
  });
  comprobar('sin técnica invita a elegirla', sinTecnica.includes('elegirEjercicioCatalogo(2)'));
  comprobar('primera vez se dice', sinTecnica.includes('primera vez'));

  console.log('\n── SERIES DE UN TOQUE ──');
  // Lo que hizo abandonar el registro: había que teclear dos números por serie.
  // Ahora la fila sale escrita y basta el check.
  const banca = { id: 1, nombre: 'Press banca plano', series: 4, reps_objetivo: '6-10',
                  dataset_id: '0025', ultima: { peso: '60.00', reps: 8 }, mejor_peso: '82.50' };
  enContexto('gymSeriesMap = {};');
  const filas4 = ctx.renderEjercicioCard(banca);
  comprobar('pinta las 4 series previstas',
    (filas4.match(/class="sp-fila/g) || []).length === 4);
  comprobar('salen con el peso del último día', filas4.includes('60 kg'));
  comprobar('y con las reps del último día', filas4.includes('sp-reps">8<'));
  comprobar('el check guarda de un toque', filas4.includes('marcarSerie(1,1)'));
  comprobar('los números abren el ajuste', filas4.includes('ajustarSerie(1,1)'));

  // Sin historial NO se puede proponer peso: es el único caso que se teclea
  const primerDia = ctx.renderEjercicioCard({
    id: 3, nombre: 'Remo', series: 3, reps_objetivo: '8-12', dataset_id: null, ultima: null
  });
  comprobar('la primera vez el peso se pide', primerDia.includes('— kg'));
  comprobar('pero las reps salen del objetivo', primerDia.includes('sp-reps">8<'));

  // Con una serie hecha hoy a 65, la siguiente propone 65 y no 60
  enContexto(`gymSeriesMap = { 1: [{ ejercicio_id: 1, serie_num: 1, peso: '65.00', reps: 7, completada: true }] };`);
  const trasUna = ctx.renderEjercicioCard(banca);
  comprobar('lo de HOY manda sobre lo del último día', trasUna.includes('65 kg'));
  comprobar('la serie hecha se marca', trasUna.includes('sp-fila done'));
  comprobar('hereda también las reps de hoy', (trasUna.match(/sp-reps">7</g) || []).length >= 2);

  // El ajuste sale sin teclado, con ± y el valor ya puesto
  const editor = ctx.editorSerie(banca, 2);
  comprobar('el ajuste trae ± de 2,5 kg', editor.includes("pasoValor('sp-p-1',2.5)"));
  comprobar('y ± de una repetición', editor.includes("pasoValor('sp-r-1',1)"));
  comprobar('con el peso propuesto dentro', /id="sp-p-1" value="65"/.test(editor));

  console.log('\n── PROGRESO Y DESCANSO ──');
  enContexto(`gymEj = [${JSON.stringify(banca)}, { id: 4, nombre: 'Fondos', series: 3 }];`);
  const prog = ctx.barraProgresoSesion();
  comprobar('cuenta las series de toda la sesión', prog.includes('de 7 series'));
  comprobar('y las que llevas hechas', prog.includes('<strong>1</strong>'));

  console.log('\n── UN TOQUE, DE VERDAD ──');
  // El flujo real: pulsar el check tiene que guardar sin abrir nada
  const llamadas = [];
  ctx.api = async (ruta, opts = {}) => {
    const cuerpo = opts.body ? JSON.parse(opts.body) : null;
    llamadas.push({ ruta, metodo: opts.method || 'GET', cuerpo });
    return { ok: true, json: async () => ({ ...cuerpo, ejercicio_id: cuerpo?.ejercicio_id }) };
  };
  enContexto('gymSesion = { id: 99, rutina_id: 1 };');

  await ctx.marcarSerie(1, 2);
  comprobar('un toque guarda la serie', llamadas.length === 1, llamadas[0]?.ruta);
  comprobar('con el peso que ya ponía la fila', llamadas[0]?.cuerpo?.peso === 65,
    `${llamadas[0]?.cuerpo?.peso} kg × ${llamadas[0]?.cuerpo?.reps}`);
  comprobar('y con su número de serie', llamadas[0]?.cuerpo?.serie_num === 2);

  await ctx.marcarSerie(1, 2);   // segundo toque sobre la misma
  comprobar('el segundo toque la desmarca',
    llamadas[1]?.metodo === 'DELETE' && llamadas[1]?.ruta === '/sesiones/99/series/1/2');

  // La primera vez de un ejercicio no puede inventarse el peso: abre el ajuste
  enContexto(`gymEj = [{ id: 5, nombre: 'Remo', series: 3, reps_objetivo: '10', ultima: null }];
              gymSeriesMap = {};`);
  const antes = llamadas.length;
  await ctx.marcarSerie(5, 1);
  comprobar('sin peso conocido no guarda nada a ciegas', llamadas.length === antes);
  comprobar('abre el ajuste para decirlo una vez',
    nodo('sets-5').innerHTML.includes('sp-edit'));

  console.log('\n── VISOR DE TÉCNICA ──');
  enContexto(`gymEj = [{ id: 1, nombre: 'Press banca plano', dataset_id: '0025' }];`);
  await ctx.verTecnica(1);
  await new Promise(r => setTimeout(r, 30));
  const visor = nodo('tecnica-body').innerHTML;
  // La técnica se enseña en vídeo: el GIF de origen son 180 px y dos de sus
  // tres segundos son fotogramas congelados. El MP4 va al triple y sin saltos.
  comprobar('la técnica se ve en vídeo', /<video[^>]+ejercicios\/media\/0025-EIeI8Vf\.mp4/.test(visor));
  comprobar('el vídeo arranca solo y en bucle',
    /autoplay/.test(visor) && /loop/.test(visor) && /muted/.test(visor) && /playsinline/.test(visor));
  comprobar('sin vídeo se cae al GIF', visor.includes('0025-EIeI8Vf.gif'));
  comprobar('conserva su nombre', visor.includes('Press banca plano'));
  comprobar('sin clip mapeado no hay botón de vídeo', !visor.includes('tec-cambiar'));

  // Con un ejercicio que SÍ tiene vídeo de persona real mapeado
  enContexto(`gymEj = [{ id: 2, nombre: 'Press banca plano', dataset_id: '0025',
                         video_slug: 'male/barbell-bench-press', video_aprox: false }];`);
  await ctx.verTecnica(2);
  await new Promise(r => setTimeout(r, 30));
  const conVideo = nodo('tecnica-body').innerHTML;
  comprobar('con clip aparece el botón', conVideo.includes('VER EN VÍDEO'));
  comprobar('pero se abre por la animación',
    conVideo.includes('0025-EIeI8Vf.mp4') && !conVideo.includes('barbell-bench-press.mp4'));
  ctx.alternarVistaTecnica();
  const trasPulsar = nodo('tec-medio').innerHTML;
  comprobar('al pulsar sale el vídeo real',
    trasPulsar.includes('ejercicios/video/male/barbell-bench-press.mp4'));
  comprobar('el vídeo trae su póster',
    trasPulsar.includes('ejercicios/video/male/barbell-bench-press.jpg'));
  ctx.alternarVistaTecnica();
  comprobar('y se puede volver a la animación',
    nodo('tec-medio').innerHTML.includes('0025-EIeI8Vf.mp4'));

  // Una variante aproximada tiene que decirlo
  enContexto(`gymEj = [{ id: 3, nombre: 'Hip thrust', dataset_id: '0025',
                         video_slug: 'female/hip-raise-bridge', video_aprox: true }];`);
  await ctx.verTecnica(3);
  await new Promise(r => setTimeout(r, 30));
  ctx.alternarVistaTecnica();
  comprobar('avisa cuando el clip es una variante parecida',
    /variante filmada más parecida/.test(nodo('tec-medio').innerHTML));
  const pasos = nodo('tec-pasos').innerHTML;
  comprobar('pasos en español', /acuést|banco|barra/i.test(pasos),
    (pasos.match(/<li>([^<]{0,60})/) || [])[1]);

  console.log(`\n${fallos === 0 ? 'TODO CORRECTO' : fallos + ' COMPROBACIONES FALLIDAS'}`);
  process.exit(fallos ? 1 : 0);
})();
