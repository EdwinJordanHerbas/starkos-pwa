// Lista las clases CSS que no usa nadie.
//
//   node tools/css-sin-uso.js
//
// NO borra nada, y con razón: una clase puede estar viva y no aparecer literal
// en el código si la app la construye por partes (`toast-${tipo}`,
// `rank-${rango}`). El script detecta esos prefijos y no los señala, pero aun
// así lo que sale de aquí es una lista de CANDIDATAS: antes de borrar una,
// abre la pantalla donde debería salir y compruébalo con los ojos.
//
// El bloque .dashboard-grid/.dash-card se quitó así — nueve reglas de un panel
// que ya no existía. Las clases de nombre corto (.ak, .tl, .dp...) siguen en su
// sitio a propósito: son de la nomenclatura abreviada del proyecto y no se
// tocan sin verlas.
const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

const css = ['styles', 'components', 'sections', 'animations']
  .map(f => leer(`src/css/${f}.css`)).join('\n');
const codigo = [
  leer('index.html'),
  leer('mock.js'),
  ...['app', 'gym', 'nutrition', 'projects', 'ia'].map(f => leer(`src/js/${f}.js`))
].join('\n');

const clases = new Set();
for (const m of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) clases.add(m[1]);

// Trozos que la app pega a mano: `class="algo-${x}"` y `${x}-algo`
const dinamicos = new Set();
for (const m of codigo.matchAll(/([\w-]+)-\$\{/g))      dinamicos.add(m[1] + '-');
for (const m of codigo.matchAll(/\$\{[^}]*\}(-[\w-]+)/g)) dinamicos.add(m[1]);

const candidatas = [...clases].sort().filter(c =>
  !new RegExp(`\\b${c.replace(/-/g, '\\-')}\\b`).test(codigo) &&
  ![...dinamicos].some(d => c.startsWith(d) || c.endsWith(d))
);

console.log(`clases definidas:        ${clases.size}`);
console.log(`prefijos que se arman:   ${[...dinamicos].sort().join(', ') || '(ninguno)'}`);
console.log(`candidatas a sobrar:     ${candidatas.length}`);
if (candidatas.length) console.log('\n' + candidatas.map(c => '  .' + c).join('\n'));
