// Genera el catálogo local de ejercicios de OKIRO desde el dataset
// hasaneyldrm/exercises-dataset (1.324 ejercicios, CC BY / media de Gym Visual).
//
// Por qué se precocina aquí y no se descarga en el móvil:
//   · el JSON original pesa 17 MB y se bajaba entero al abrir una técnica
//   · sus nombres están solo en inglés
//   · la ruta del GIF que usaba la app (data/gifs/{id}.gif) NO EXISTE en el
//     repo; la buena es videos/{id}-{media_id}.gif y viene en el campo gif_url
//
// Salida:
//   assets/ejercicios.json          índice ligero para buscar y previsualizar
//   assets/ejercicios-tecnica.json  pasos en español, se carga aparte
//
// Uso:  node generar-catalogo.js <carpeta-destino>

const fs   = require('fs');
const path = require('path');

const SRC = require('./exercises.json');
const OUT = process.argv[2] || '.';

/* ══════════════════════════════════════════════════════════════════
   TRADUCCIÓN DE NOMBRES
   Los nombres del dataset son composicionales ("barbell bench press"),
   así que se traducen por piezas y se recolocan al orden español:
   núcleo + modificadores + equipo.
   ══════════════════════════════════════════════════════════════════ */

/* Género del núcleo, para que concuerden los modificadores:
   m masculino · f femenino · mp/fp los mismos en plural. */
const MOV = [
  ['bench press',          'press banca',              'm'],
  ['chest press',          'press de pecho',           'm'],
  ['shoulder press',       'press de hombro',          'm'],
  ['military press',       'press militar',            'm'],
  ['french press',         'press francés',            'm'],
  ['leg press',            'prensa de piernas',        'f'],
  ['calf press',           'prensa de gemelos',        'f'],
  ['floor press',          'press en el suelo',        'm'],
  ['push press',           'push press',               'm'],
  ['hammer press',         'press neutro',             'm'],
  ['press',                'press',                    'm'],

  ['lateral raise',        'elevación lateral',        'f'],
  ['front raise',          'elevación frontal',        'f'],
  ['calf raise',           'elevación de gemelos',     'f'],
  ['leg raise',            'elevación de piernas',     'f'],
  ['knee raise',           'elevación de rodillas',    'f'],
  ['hip raise',            'elevación de cadera',      'f'],
  ['heel raise',           'elevación de talones',     'f'],
  ['toe raise',            'elevación de puntas',      'f'],
  ['shoulder raise',       'elevación de hombros',     'f'],
  ['raise',                'elevación',                'f'],

  ['hammer curl',          'curl martillo',            'm'],
  ['preacher curl',        'curl predicador',          'm'],
  ['concentration curl',   'curl concentrado',         'm'],
  ['spider curl',          'curl araña',               'm'],
  ['drag curl',            'curl de arrastre',         'm'],
  ['wrist curl',           'curl de muñeca',           'm'],
  ['leg curl',             'curl femoral',             'm'],
  ['biceps curl',          'curl de bíceps',           'm'],
  ['bicep curl',           'curl de bíceps',           'm'],
  ['curl-up',              'encogimiento',             'm'],
  ['curl',                 'curl',                     'm'],

  ['chin-up',              'dominada supina',          'f'],
  ['chin up',              'dominada supina',          'f'],
  ['pull-up',              'dominada',                 'f'],
  ['pull up',              'dominada',                 'f'],
  ['pull-ups',             'dominadas',                'fp'],
  ['push-up',              'flexión',                  'f'],
  ['push up',              'flexión',                  'f'],
  ['push-ups',             'flexiones',                'fp'],
  ['sit-up',               'abdominal',                'f'],
  ['sit up',               'abdominal',                'f'],
  ['sit-ups',              'abdominales',              'fp'],

  ['upright row',          'remo al mentón',           'm'],
  ['pull-down',            'jalón',                    'm'],
  ['pulldown',             'jalón',                    'm'],
  ['pushdown',             'extensión de tríceps',     'f'],
  ['pullover',             'pullover',                 'm'],
  ['row',                  'remo',                     'm'],

  ['romanian deadlift',    'peso muerto rumano',       'm'],
  ['stiff leg deadlift',   'peso muerto piernas rectas','m'],
  ['deadlift',             'peso muerto',              'm'],

  ['hack squat',           'hack squat',               'm'],
  ['front squat',          'sentadilla frontal',       'f'],
  ['split squat',          'sentadilla búlgara',       'f'],
  ['squat',                'sentadilla',               'f'],
  ['lunge',                'zancada',                  'f'],
  ['lunges',               'zancadas',                 'fp'],
  ['step-up',              'subida al cajón',          'f'],
  ['step up',              'subida al cajón',          'f'],

  ['hip thrust',           'hip thrust',               'm'],
  ['hip thrusts',          'hip thrusts',              'mp'],
  ['glute bridge',         'puente de glúteo',         'm'],
  ['bridge',               'puente',                   'm'],

  ['leg extension',        'extensión de cuádriceps',  'f'],
  ['triceps extension',    'extensión de tríceps',     'f'],
  ['tricep extension',     'extensión de tríceps',     'f'],
  ['back extension',       'extensión lumbar',         'f'],
  ['extension',            'extensión',                'f'],
  ['kickback',             'patada de tríceps',        'f'],

  ['chest dip',            'fondo de pecho',           'm'],
  ['triceps dip',          'fondo de tríceps',         'm'],
  ['bench dip',            'fondo en banco',           'm'],
  ['dips',                 'fondos',                   'mp'],
  ['dip',                  'fondo',                    'm'],

  ['face pull',            'face pull',                'm'],
  ['good morning',         'buenos días',              'mp'],
  ['clean and jerk',       'dos tiempos',              'm'],
  ['clean and press',      'cargada y press',          'f'],
  ['power clean',          'cargada de potencia',      'f'],
  ['clean',                'cargada',                  'f'],
  ['snatch',               'arrancada',                'f'],
  ['thruster',             'thruster',                 'm'],
  ['burpee',               'burpee',                   'm'],
  ['mountain climber',     'escalador',                'm'],
  ['jumping jack',         'jumping jack',             'm'],
  ['russian twist',        'giro ruso',                'm'],
  ['flutter kick',         'patada de aleteo',         'f'],
  ['scissor kick',         'tijeras',                  'fp'],

  ['fly',                  'aperturas',                'fp'],
  ['flye',                 'aperturas',                'fp'],
  ['flyes',                'aperturas',                'fp'],
  ['crunch',               'crunch',                   'm'],
  ['crunches',             'crunches',                 'mp'],
  ['plank',                'plancha',                  'f'],
  ['shrug',                'encogimiento de hombros',  'm'],
  ['rollout',              'rueda abdominal',          'f'],
  ['rollerout',            'rueda abdominal',          'f'],
  ['stretch',              'estiramiento',             'm'],
  ['twist',                'giro',                     'm'],
  ['rotation',             'rotación',                 'f'],
  ['abduction',            'abducción',                'f'],
  ['adduction',            'aducción',                 'f'],
  ['walk',                 'caminata',                 'f'],
  ['run',                  'carrera',                  'f'],
  ['jump',                 'salto',                    'm'],
  ['hold',                 'isométrico',               'm'],
  ['carry',                'transporte',               'm'],
  ['swing',                'swing',                    'm'],
  ['throw',                'lanzamiento',              'm'],
  ['lift',                 'levantamiento',            'm'],
  ['kick',                 'patada',                   'f'],
  ['pull',                 'tirón',                    'm'],
  ['push',                 'empuje',                   'm'],
  ['circles',              'círculos',                 'mp'],
];

/* Zonas del cuerpo: si van pegadas delante del movimiento, en español
   pasan detrás con "de" (chest press → press de pecho). */
const ZONA = [
  ['triceps','tríceps'], ['tricep','tríceps'], ['biceps','bíceps'], ['bicep','bíceps'],
  ['chest','pecho'], ['pectoral','pectoral'], ['shoulder','hombro'], ['delt','deltoides'],
  ['lats','dorsales'], ['lat','dorsal'], ['back','espalda'], ['glute','glúteo'],
  ['hamstring','isquios'], ['quad','cuádriceps'], ['calf','gemelo'], ['calves','gemelos'],
  ['abs','abdomen'], ['oblique','oblicuos'], ['forearm','antebrazo'], ['wrist','muñeca'],
  ['neck','cuello'], ['hip','cadera'], ['knee','rodilla'], ['ankle','tobillo'],
  ['thigh','muslo'], ['leg','pierna'], ['legs','piernas'], ['arm','brazo'], ['arms','brazos'],
  ['spine','columna'], ['trap','trapecio'], ['groin','aductores'], ['adductor','aductor'],
  ['abductor','abductor'], ['core','core'], ['shin','espinilla'], ['toe','punta'],
  ['heel','talón'], ['foot','pie'], ['head','cabeza'], ['hand','mano'], ['finger','dedo'],
];

/* Equipo: en español va al final ("press banca CON BARRA"). */
const EQUIPO = [
  ['olympic barbell',   'con barra olímpica'],
  ['ez barbell',        'con barra Z'],
  ['trap bar',          'con barra hexagonal'],
  ['barbell',           'con barra'],
  ['dumbbell',          'con mancuerna'],
  ['kettlebell',        'con kettlebell'],
  ['smith machine',     'en multipower'],
  ['smith',             'en multipower'],
  ['leverage machine',  'en máquina'],
  ['lever',             'en máquina'],
  ['sled machine',      'en máquina de empuje'],
  ['sled',              'en máquina de empuje'],
  ['cable',             'en polea'],
  ['resistance band',   'con banda elástica'],
  ['band',              'con banda elástica'],
  ['medicine ball',     'con balón medicinal'],
  ['stability ball',    'con fitball'],
  ['exercise ball',     'con fitball'],
  ['bosu ball',         'en bosu'],
  ['wheel roller',      'con rueda abdominal'],
  ['roller',            'con rueda'],
  ['rope',              'con cuerda'],
  ['towel',             'con toalla'],
  ['tire',              'con neumático'],
  ['sz-bar',            'con barra Z'],
  ['v-bar',             'con barra V'],
  ['machine',           'en máquina'],
];

/* Modificadores. Cuatro formas para que concuerden con el núcleo. */
const G = (m, f, mp, fp) => ({ m, f, mp: mp || m + 's', fp: fp || f + 's' });
const MODIF = [
  ['one arm',        'a una mano'],
  ['single arm',     'a una mano'],
  ['two arm',        'a dos manos'],
  ['single leg',     'a una pierna'],
  ['one leg',        'a una pierna'],
  ['close-grip',     'agarre cerrado'],
  ['close grip',     'agarre cerrado'],
  ['wide-grip',      'agarre ancho'],
  ['wide grip',      'agarre ancho'],
  ['narrow grip',    'agarre estrecho'],
  ['reverse-grip',   'agarre invertido'],
  ['reverse grip',   'agarre invertido'],
  ['neutral grip',   'agarre neutro'],
  ['palm-in',        'palmas enfrentadas'],
  ['underhand',      'agarre supino'],
  ['overhand',       'agarre prono'],
  ['behind neck',    'tras nuca'],
  ['behind head',    'tras nuca'],
  ['behind back',    'a la espalda'],
  ['bent over',      G('inclinado', 'inclinada')],
  ['bent-over',      G('inclinado', 'inclinada')],
  ['bent knee',      'rodilla flexionada'],
  ['straight arm',   'brazo recto'],
  ['straight leg',   'pierna recta'],
  ['straight back',  'espalda recta'],
  ['seated',         G('sentado', 'sentada')],
  ['standing',       'de pie'],
  ['kneeling',       'de rodillas'],
  ['lying',          G('tumbado', 'tumbada')],
  ['prone',          'boca abajo'],
  ['supine',         'boca arriba'],
  ['hanging',        G('colgado', 'colgada')],
  ['incline',        G('inclinado', 'inclinada')],
  ['decline',        G('declinado', 'declinada')],
  ['flat',           G('plano', 'plana')],
  ['reverse',        G('invertido', 'invertida')],
  ['assisted',       G('asistido', 'asistida')],
  ['weighted',       'con lastre'],
  ['alternating',    G('alterno', 'alterna')],
  ['alternate',      G('alterno', 'alterna')],
  ['full',           G('completo', 'completa')],
  ['half',           G('medio', 'media')],
  ['deep',           G('profundo', 'profunda')],
  ['high',           G('alto', 'alta')],
  ['low',            G('bajo', 'baja')],
  ['wide',           G('abierto', 'abierta')],
  ['narrow',         G('estrecho', 'estrecha')],
  ['front',          'frontal'],
  ['rear',           'posterior'],
  ['side',           'lateral'],
  ['lateral',        'lateral'],
  ['overhead',       'sobre la cabeza'],
  ['twisting',       'con giro'],
  ['cross body',     'cruzado'],
  ['forward',        'hacia delante'],
  ['on knees',       'de rodillas'],
  ['with support',   'con apoyo'],
  ['bodyweight',     'con el peso del cuerpo'],
  ['body weight',    'con el peso del cuerpo'],
];

/* Soportes: no son el equipo principal pero salen en el nombre. */
const SOPORTE = [
  ['preacher bench', 'en banco predicador'],
  ['parallel bars',  'en paralelas'],
  ['parallel',       'en paralelas'],
  ['preacher',       'en banco predicador'],
  ['bench',          'en banco'],
  ['wall',           'en la pared'],
  ['floor',          'en el suelo'],
  ['box',            'en cajón'],
  ['chair',          'en silla'],
  ['ball',           'con pelota'],
  ['bar',            'en barra'],
];

/* Modificadores que llevan dentro un nombre de zona ("single LEG").
   Se resuelven antes que nada: si no, el paso zona+movimiento se queda
   con esa zona y deja huérfano el "single". */
const MODIF_CON_ZONA = new Set([
  'one arm', 'single arm', 'two arm', 'single leg', 'one leg',
  'bent knee', 'straight arm', 'straight leg', 'straight back',
  'behind neck', 'behind head', 'behind back', 'cross body', 'on knees'
]);

/* Palabras que no aportan nada al nombre en español. */
const RUIDO = /\b(male|female|version|v|pov|side pov|back pov|exercise|the|and|to|of|in|for|a|an|on|with|at|by|from|attachment|blaster|arm blaster)\b/g;

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Limpia mojibake y ruido tipográfico del dataset. */
function limpiar(n) {
  return n
    .replace(/в°/g, '°')            // "sled 45в° leg press" — bytes rotos en el origen
    .replace(/\bv\.?\s*(\d)\b/gi, 'v$1')   // "v. 2" → "v2", que se trata como un matiz
    .replace(/\s+/g, ' ')
    .trim();
}

/** Traduce el contenido de un paréntesis, que suele ser un matiz. */
function traducirMatiz(txt) {
  let s = ' ' + txt.toLowerCase() + ' ';
  if (/\b(male|female|side pov|back pov)\b/.test(s)) return '';   // no aporta
  for (const [en, es] of [...EQUIPO, ...SOPORTE].sort((a, b) => b[0].length - a[0].length)) {
    s = s.replace(new RegExp(`(?<=\\s)${escRe(en)}(?=\\s)`, 'g'), ` ${es} `);
  }
  for (const [en, val] of MODIF.sort((a, b) => b[0].length - a[0].length)) {
    const es = typeof val === 'string' ? val : val.m;
    s = s.replace(new RegExp(`(?<=\\s)${escRe(en)}(?=\\s)`, 'g'), ` ${es} `);
  }
  s = s.replace(RUIDO, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

function traducir(nombreEN) {
  const original = limpiar(nombreEN);

  // Los paréntesis se apartan y se traducen aparte
  const matices = [];
  let base = original.replace(/\(([^)]*)\)/g, (_, dentro) => {
    const t = traducirMatiz(dentro);
    if (t) matices.push(t);
    return ' ';
  });

  let s = ' ' + base.toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
  const equipo = [], modif = [];
  let genero = 'm';   // el del núcleo, para concordar los modificadores

  // 0. Modificadores que contienen una zona ("single leg"): si no salen
  //    ahora, el paso siguiente se lleva la zona y deja el resto colgando.
  const pendientesConZona = [];
  for (const [en, val] of MODIF.filter(x => MODIF_CON_ZONA.has(x[0]))
                               .sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`(?<=\\s)${escRe(en)}(?=\\s)`, 'g');
    if (re.test(s)) { s = s.replace(re, ' '); pendientesConZona.push(val); }
  }

  // 1. El núcleo. Se resuelve primero para que "hammer curl" no pierda
  //    su "hammer" a manos del equipo llamado igual.
  //    Zona + movimiento pegados pasan a "movimiento de zona".
  const movOrden = MOV.slice().sort((a, b) => b[0].length - a[0].length);
  let nucleoPuesto = false;
  for (const [en, es, gen] of movOrden) {
    const re = new RegExp(`(?<=\\s)(?:(${ZONA.map(z => escRe(z[0])).join('|')})\\s)?${escRe(en)}(?=\\s)`, 'g');
    if (!re.test(s)) continue;
    s = s.replace(re, (_, zona) => {
      const zEs = zona && ZONA.find(z => z[0] === zona)?.[1];
      // "triceps pushdown" ya se traduce como "extensión de tríceps": no repetir la zona
      return ` ${zEs && !es.includes(zEs) ? `${es} de ${zEs}` : es} `;
    });
    if (!nucleoPuesto) { genero = gen; nucleoPuesto = true; }
  }

  // 2. Equipo → al final del todo
  for (const [en, es] of EQUIPO.slice().sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`(?<=\\s)${escRe(en)}(?=\\s)`, 'g');
    if (re.test(s)) { s = s.replace(re, ' '); equipo.push(es); }
  }

  // 3. Modificadores → detrás del núcleo, ya concordados
  for (const val of pendientesConZona) {
    modif.push(typeof val === 'string' ? val : val[genero]);
  }
  for (const [en, val] of MODIF.filter(x => !MODIF_CON_ZONA.has(x[0]))
                               .sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`(?<=\\s)${escRe(en)}(?=\\s)`, 'g');
    if (!re.test(s)) continue;
    s = s.replace(re, ' ');
    modif.push(typeof val === 'string' ? val : val[genero]);
  }

  // 4. Grados y números sueltos ("45°") también son matiz
  s = s.replace(/(?<=\s)(\d+\s*°?)(?=\s)/g, (_, n) => { modif.push(n.trim()); return ' '; });

  // 5. Zonas que quedaran sueltas y soportes
  for (const [en, es] of ZONA.slice().sort((a, b) => b[0].length - a[0].length)) {
    s = s.replace(new RegExp(`(?<=\\s)${escRe(en)}(?=\\s)`, 'g'), ` ${es} `);
  }
  for (const [en, es] of SOPORTE.slice().sort((a, b) => b[0].length - a[0].length)) {
    s = s.replace(new RegExp(`(?<=\\s)${escRe(en)}(?=\\s)`, 'g'), ` ${es} `);
  }

  s = s.replace(RUIDO, ' ').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

  const out = [s, ...modif, ...equipo, ...matices]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  if (!out) return original.charAt(0).toUpperCase() + original.slice(1);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/* ══════════════════════════════════════════════════════════════════
   MÚSCULOS — el dataset los da en inglés
   ══════════════════════════════════════════════════════════════════ */
const MUSCULO = {
  'abs': 'abdomen', 'quads': 'cuádriceps', 'lats': 'dorsales', 'calves': 'gemelos',
  'pectorals': 'pectoral', 'glutes': 'glúteos', 'hamstrings': 'isquiotibiales',
  'adductors': 'aductores', 'triceps': 'tríceps', 'cardiovascular system': 'sistema cardiovascular',
  'spine': 'columna', 'upper back': 'espalda alta', 'biceps': 'bíceps', 'delts': 'deltoides',
  'forearms': 'antebrazos', 'traps': 'trapecios', 'serratus anterior': 'serrato anterior',
  'abductors': 'abductores', 'levator scapulae': 'elevador de la escápula',
  'hip flexors': 'flexores de cadera', 'obliques': 'oblicuos', 'ankle stabilizers': 'estabilizadores del tobillo',
  'shoulders': 'hombros', 'quadriceps': 'cuádriceps', 'chest': 'pecho', 'lower back': 'lumbares',
  'core': 'core', 'back': 'espalda', 'rear deltoids': 'deltoides posterior', 'trapezius': 'trapecio',
  'ankles': 'tobillos', 'feet': 'pies', 'deltoids': 'deltoides', 'brachialis': 'braquial',
  'groin': 'aductores', 'wrists': 'muñecas', 'rotator cuff': 'manguito rotador',
  'upper chest': 'pecho superior', 'latissimus dorsi': 'dorsal ancho', 'wrist flexors': 'flexores de muñeca',
  'wrist extensors': 'extensores de muñeca', 'abdominals': 'abdominales', 'grip muscles': 'agarre',
  'lower abs': 'abdomen bajo', 'inner thighs': 'cara interna del muslo', 'soleus': 'sóleo',
  'sternocleidomastoid': 'esternocleidomastoideo', 'hands': 'manos', 'shins': 'espinillas',
  'rhomboids': 'romboides', 'hands ': 'manos'
};
const mus = m => MUSCULO[m] || m;

const EQUIPO_ES = {
  'body weight': 'peso corporal', 'cable': 'polea', 'leverage machine': 'máquina',
  'assisted': 'asistido', 'medicine ball': 'balón medicinal', 'stability ball': 'fitball',
  'band': 'banda elástica', 'barbell': 'barra', 'rope': 'cuerda', 'dumbbell': 'mancuernas',
  'ez barbell': 'barra Z', 'sled machine': 'máquina de empuje', 'upper body ergometer': 'ergómetro',
  'kettlebell': 'kettlebell', 'olympic barbell': 'barra olímpica', 'weighted': 'con lastre',
  'bosu ball': 'bosu', 'resistance band': 'banda de resistencia', 'roller': 'rueda',
  'skierg machine': 'skierg', 'hammer': 'martillo', 'smith machine': 'multipower',
  'wheel roller': 'rueda abdominal', 'stationary bike': 'bici estática', 'tire': 'neumático',
  'trap bar': 'barra hexagonal', 'elliptical machine': 'elíptica', 'stepmill machine': 'escaladora'
};

const ZONA_ES = {
  'waist': 'core', 'upper legs': 'piernas', 'back': 'espalda', 'lower legs': 'gemelos',
  'chest': 'pecho', 'upper arms': 'brazos', 'cardio': 'cardio', 'shoulders': 'hombros',
  'lower arms': 'antebrazos', 'neck': 'cuello'
};

/* ══════════════════════════════════════════════════════════════════
   ALIAS — cómo lo llama la gente en el gimnasio
   El dataset llama "cable rear delt row (with rope)" a lo que aquí es un
   face pull, y "barbell glute bridge" a un hip thrust. Sin esto, buscar
   por el nombre de la calle no encuentra nada.
   ══════════════════════════════════════════════════════════════════ */
const ALIAS = [
  [/rear delt row.*rope|face pull/,            'face pull'],
  [/glute bridge|hip thrust/,                  'hip thrust'],
  [/lying.*triceps extension|skull/,           'press frances rompecraneos skull crusher'],
  [/rear (lateral raise|delt fly|fly)/,        'pajaros deltoides posterior'],
  [/pec deck|butterfly|chest fly|crossover/,   'contractora pec deck aperturas cruces'],
  [/pulldown/,                                 'jalon dorsalera polea alta'],
  [/romanian deadlift/,                        'peso muerto rumano rdl'],
  [/deadlift/,                                 'peso muerto'],
  [/hyperextension|back extension/,            'lumbares hiperextensiones'],
  [/upright row/,                              'remo al menton'],
  [/shrug/,                                    'encogimientos trapecio'],
  [/leg press/,                                'prensa'],
  [/leg extension/,                            'extension de cuadriceps camilla'],
  [/leg curl/,                                 'femoral camilla isquios'],
  [/calf raise|calf press/,                    'gemelos soleo'],
  [/split squat|bulgarian/,                    'bulgara'],
  [/hack squat/,                               'hack'],
  [/preacher/,                                 'predicador banco scott'],
  [/pull-?up|chin-?up/,                        'dominadas'],
  [/push-?up/,                                 'flexiones'],
  [/\bdips?\b/,                                'fondos'],
  [/plank/,                                    'plancha isometrico core'],
  [/russian twist/,                            'giro ruso oblicuos'],
  [/military press|overhead press|shoulder press/, 'press militar hombro'],
  [/bench press/,                              'press banca pecho'],
  [/lateral raise/,                            'elevaciones laterales hombro'],
  [/bent over row|barbell row|pendlay/,        'remo con barra'],
  [/seated row|low row/,                       'remo en polea gironda'],
  [/lunge/,                                    'zancadas desplantes'],
  [/squat/,                                    'sentadilla'],
  [/curl/,                                     'biceps'],
];

function aliasDe(nombreEN) {
  const n = nombreEN.toLowerCase();
  const out = new Set();
  for (const [re, alias] of ALIAS) {
    if (re.test(n)) alias.split(' ').forEach(p => out.add(p));
  }
  return [...out].join(' ');
}

/* Lo que se ofrece al abrir el buscador sin escribir nada. Sin esta lista
   salía el catálogo por orden alfabético ("3/4 abdominal", "air bike"),
   que no es por donde empieza nadie. */
const BASICOS = [
  '0025', '0289', '0314', '0251', '0091', '0334', '0201', '0060',   // empuje
  '0652', '0027', '0180', '0203', '2330', '0031', '0313', '0348',   // tirón
  '0043', '0739', '0336', '0586', '1409', '0605', '0032', '0085',   // pierna
  '0274', '0175'                                                     // core
];

/* ══════════════════════════════════════════════════════════════════
   GENERACIÓN
   ══════════════════════════════════════════════════════════════════ */
const catalogo = SRC.map(e => {
  const ficha = {
    id: e.id,
    m:  e.media_id,                        // con id+media_id se arma la ruta real del GIF
    n:  traducir(e.name),
    en: limpiar(e.name),                   // se busca también por el nombre original
    t:  mus(e.target),
    s:  (e.secondary_muscles || []).map(mus),
    eq: EQUIPO_ES[e.equipment] || e.equipment,
    bp: ZONA_ES[e.body_part] || e.body_part
  };
  const k = aliasDe(e.name);
  if (k) ficha.k = k;                      // como lo llama la gente
  if (BASICOS.includes(e.id)) ficha.b = 1; // sale en la lista de arranque
  return ficha;
});

const tecnica = {};
let sinES = 0;
for (const e of SRC) {
  const pasos = e.instruction_steps?.es;
  if (Array.isArray(pasos) && pasos.length) tecnica[e.id] = pasos;
  else { sinES++; tecnica[e.id] = e.instruction_steps?.en || []; }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'ejercicios.json'), JSON.stringify(catalogo));
fs.writeFileSync(path.join(OUT, 'ejercicios-tecnica.json'), JSON.stringify(tecnica));

const kb = f => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB';
console.log('ejercicios.json         ', kb('ejercicios.json'), `(${catalogo.length} ejercicios)`);
console.log('ejercicios-tecnica.json ', kb('ejercicios-tecnica.json'), `(sin español: ${sinES})`);

console.log('\n── Los 18 de sus rutinas ──');
['0025','0314','0251','0091','0334','0201','0652','0027','0180','0203',
 '0031','0313','0043','0739','0336','0586','1409','0605'].forEach(id => {
  const c = catalogo.find(x => x.id === id);
  console.log(`  ${id}  ${c.n.padEnd(38)} ← ${c.en}`);
});

console.log('\n── Muestra al azar (control de calidad) ──');
[3,77,200,404,555,700,888,1000,1111,1300].forEach(i => {
  const c = catalogo[i];
  console.log(`  ${c.n.padEnd(46)} ← ${c.en}`);
});
