// Vigila que ningún archivo vuelva a guardarse con la codificación rota.
//
// Pasó de verdad: sw.js quedó guardado como si su UTF-8 fuera latin1, y una de
// las líneas afectadas no era un comentario sino el texto de la notificación
// push. Un acento mal guardado no rompe nada que se note al programar — se ve
// en el móvil del usuario, semanas después.
//
//   node tools/test-codificacion.js
const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const EXT  = ['.js', '.css', '.html', '.json', '.md', '.sql', '.conf', '.sh'];
const SALTAR = new Set(['node_modules', '.git', '.cache', '.secrets', 'assets', 'icons']);

// El rastro que deja UTF-8 releído como latin1: una vocal acentuada acaba
// escrita como A-con-tilde (U+00C3) o A-con-diéresis (U+00C2) seguida de otro
// símbolo, y la raya larga como a-circunfleja + euro (U+00E2 U+20AC).
//
// El patrón se arma por código de carácter a propósito: escritos en claro,
// este archivo se delataría a sí mismo en cada ejecución.
const PREFIJOS = String.fromCharCode(0xC3, 0xC2);   // A-con-tilde, A-con-dieresis
const RAYA     = String.fromCharCode(0xE2, 0x20AC); // a-circunfleja + euro
const MOJIBAKE = new RegExp(`[${PREFIJOS}][-¿]|${RAYA}`);

function archivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (SALTAR.has(e.name)) return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return archivos(p);
    return EXT.includes(path.extname(e.name)) ? [p] : [];
  });
}

let fallos = 0;
for (const f of archivos(RAIZ)) {
  const bruto = fs.readFileSync(f);
  const texto = bruto.toString('utf8');
  const rel   = path.relative(RAIZ, f);

  // Buffer -> utf8 -> Buffer solo coincide si los bytes eran UTF-8 válidos
  if (!Buffer.from(texto, 'utf8').equals(bruto)) {
    console.log(`  FALLO  ${rel} — no es UTF-8 válido`);
    fallos++;
    continue;
  }
  const malas = texto.split(/\r?\n/)
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => MOJIBAKE.test(l));
  if (malas.length) {
    console.log(`  FALLO  ${rel} — ${malas.length} línea(s) con la codificación rota`);
    malas.slice(0, 3).forEach(([n, l]) => console.log(`           ${n}: ${l.trim().slice(0, 70)}`));
    fallos++;
  }
}

console.log(fallos === 0
  ? 'CODIFICACIÓN CORRECTA en todo el proyecto'
  : `${fallos} ARCHIVO(S) CON LA CODIFICACIÓN ROTA`);
process.exit(fallos ? 1 : 0);
