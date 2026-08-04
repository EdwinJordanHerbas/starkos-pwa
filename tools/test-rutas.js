// Comprueba qué se sirve sin la clave de acceso y qué no.
//
//   node tools/test-rutas.js
//
// Existe por un fallo concreto: al añadir los vídeos de técnica, la ruta
// /ejercicios/video se quedó fuera de PUBLIC_PATHS. En local no se notó porque
// el servidor se arrancaba sin APP_TOKEN —y sin clave la API está abierta—,
// así que el 401 solo apareció en producción, con el botón «ver en vídeo» ya
// puesto y sin cargar nada. Este test arranca el servidor CON clave, que es
// como corre de verdad.
const { spawn } = require('child_process');
const path = require('path');

const RAIZ  = path.join(__dirname, '..');
const PUERTO = 3089;
const CLAVE  = 'clave-de-prueba-suficientemente-larga';

// ruta, código sin clave, por qué.
// En /health se admiten los dos: sin base de datos delante contesta 503, y eso
// está bien — lo que se comprueba aquí es que sea PÚBLICO, no que esté sano.
const CASOS = [
  ['/health',                          [200, 503], 'lo mira el monitor, sin datos dentro'],
  ['/',                                      200, 'la PWA es pública'],
  ['/src/js/app.js',                         200, 'el código de cliente se sirve'],
  ['/ejercicios/media/0025-EIeI8Vf.jpg',     200, 'miniatura: un <img> no manda cabeceras'],
  ['/ejercicios/video/male/barbell-curl.jpg',200, 'póster: un <video> tampoco'],
  ['/logs',                                  401, 'son tus datos'],
  ['/progreso',                              401, 'son tus datos'],
  ['/nutricion/2026-01-01',                  401, 'son tus datos'],
  ['/server.js',                             404, 'el código del servidor no se publica'],
  ['/migration.sql',                         404, 'el esquema no se publica'],
  ['/.secrets/app_token',                    404, 'AQUÍ VIVE LA CLAVE DE TODO'],
  ['/.git/config',                           404, 'el repo no se publica'],
  ['/ejercicios/media/../../server.js',      404, 'no se sale del directorio']
];

const servidor = spawn(process.execPath, ['server.js'], {
  cwd: RAIZ,
  env: { ...process.env, NODE_ENV: 'development', PORT: String(PUERTO), APP_TOKEN: CLAVE },
  stdio: 'ignore'
});

const dormir = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // Esperar a que responda, sin dar por hecho un tiempo fijo
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${PUERTO}/health`); break; } catch { await dormir(250); }
  }

  let fallos = 0;
  console.log('── SIN LA CLAVE DE ACCESO ──');
  for (const [ruta, esperado, porque] of CASOS) {
    let code = 0;
    try { code = (await fetch(`http://127.0.0.1:${PUERTO}${ruta}`, { redirect: 'manual' })).status; }
    catch (e) { code = -1; }
    const validos = Array.isArray(esperado) ? esperado : [esperado];
    if (validos.includes(code)) {
      console.log(`  OK   ${String(code).padEnd(4)} ${ruta}`);
    } else {
      console.log(`  FALLO ${ruta} devolvió ${code}, se esperaba ${validos.join(' o ')} — ${porque}`);
      fallos++;
    }
  }

  console.log('\n── CON LA CLAVE ──');
  for (const ruta of ['/logs', '/progreso', '/auth/check']) {
    let code = 0;
    try {
      code = (await fetch(`http://127.0.0.1:${PUERTO}${ruta}`, {
        headers: { Authorization: `Bearer ${CLAVE}` }
      })).status;
    } catch { code = -1; }
    // 500 vale: sin base de datos el handler falla, pero la clave pasó el control
    if (code !== 401) console.log(`  OK   ${ruta} deja entrar (${code})`);
    else { console.log(`  FALLO ${ruta} sigue en 401 con la clave correcta`); fallos++; }
  }

  servidor.kill();
  console.log(`\n${fallos === 0 ? 'RUTAS CORRECTAS' : fallos + ' RUTAS MAL PROTEGIDAS'}`);
  process.exit(fallos ? 1 : 0);
})();
