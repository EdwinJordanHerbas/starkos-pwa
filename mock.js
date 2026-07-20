// ============================================================
// MOCK DE DATOS — SOLO DESARROLLO LOCAL
// ============================================================
// Solo se activa si la URL lleva ?mock=1 (o localStorage.OKIRO_MOCK='1').
// En producción este archivo NO hace nada: seguro dejarlo desplegado.
//
//   Activar:    https://localhost/?mock=1
//   Desactivar: quitar el parámetro (o localStorage.removeItem('OKIRO_MOCK'))
// ============================================================

(function () {
  const MOCK_ON = /[?&]mock=1/.test(location.search) || localStorage.getItem('OKIRO_MOCK') === '1';
  if (!MOCK_ON) return;

  const _fetch = window.fetch;

  // ── DATOS MOCK ──────────────────────────────────────────────
  // Edita estos valores para simular distintos estados del día.

  const HOY = new Date().toISOString().split('T')[0];

  const MOCK_LOG_HOY = {
    id: 1,
    fecha: HOY,
    sueno: 7.5,
    energia: 8,
    entreno_completado: true,
    tipo_entreno: 'gym',
    nutricion: 7,
    tareas_completadas: 3,
    tareas_total: 5,
    notas: 'Buen entreno. Press banca 90kg.'
  };

  const MOCK_LOGS = [
    MOCK_LOG_HOY,
    { id: 2, fecha: '2026-04-30', sueno: 6.5, energia: 7, entreno_completado: false, tipo_entreno: 'off',  nutricion: 6, tareas_completadas: 4, tareas_total: 5, notas: '' },
    { id: 3, fecha: '2026-04-29', sueno: 8.0, energia: 9, entreno_completado: true,  tipo_entreno: 'run',  nutricion: 8, tareas_completadas: 5, tareas_total: 5, notas: 'Carrera 8km' },
    { id: 4, fecha: '2026-04-28', sueno: 7.0, energia: 7, entreno_completado: true,  tipo_entreno: 'gym',  nutricion: 7, tareas_completadas: 3, tareas_total: 5, notas: '' },
    { id: 5, fecha: '2026-04-27', sueno: 5.5, energia: 5, entreno_completado: false, tipo_entreno: 'off',  nutricion: 5, tareas_completadas: 2, tareas_total: 5, notas: 'Día flojo' }
  ];

  const MOCK_RUTINAS = [
    { id: 1, nombre: 'PUSH', descripcion: 'Pecho · Hombros · Tríceps', dias: ['lunes', 'miércoles', 'viernes'] },
    { id: 2, nombre: 'PULL', descripcion: 'Espalda · Bíceps',          dias: ['martes', 'jueves', 'sábado']   },
    { id: 3, nombre: 'LEGS', descripcion: 'Cuádriceps · Isquios · Glúteos', dias: ['miércoles', 'sábado']    }
  ];

  const MOCK_EJERCICIOS = {
    1: [
      { id: 1, rutina_id: 1, nombre: 'Press banca plano',         series: 4, reps_objetivo: '6-10',  orden: 1 },
      { id: 2, rutina_id: 1, nombre: 'Press inclinado mancuerna', series: 3, reps_objetivo: '10-12', orden: 2 },
      { id: 3, rutina_id: 1, nombre: 'Fondos en paralelas',       series: 3, reps_objetivo: '8-12',  orden: 3 },
      { id: 4, rutina_id: 1, nombre: 'Press militar barra',       series: 4, reps_objetivo: '6-10',  orden: 4 },
      { id: 5, rutina_id: 1, nombre: 'Elevaciones laterales',     series: 4, reps_objetivo: '12-15', orden: 5 },
      { id: 6, rutina_id: 1, nombre: 'Extensión tríceps polea',   series: 3, reps_objetivo: '12-15', orden: 6 }
    ],
    2: [
      { id: 7, rutina_id: 2, nombre: 'Dominadas',          series: 4, reps_objetivo: '6-10',  orden: 1 },
      { id: 8, rutina_id: 2, nombre: 'Remo con barra',     series: 4, reps_objetivo: '8-12',  orden: 2 },
      { id: 9, rutina_id: 2, nombre: 'Remo en polea baja', series: 3, reps_objetivo: '10-12', orden: 3 },
      { id: 10,rutina_id: 2, nombre: 'Face pulls',         series: 3, reps_objetivo: '15-20', orden: 4 },
      { id: 11,rutina_id: 2, nombre: 'Curl bíceps barra',  series: 3, reps_objetivo: '10-12', orden: 5 },
      { id: 12,rutina_id: 2, nombre: 'Curl martillo',      series: 3, reps_objetivo: '12-15', orden: 6 }
    ],
    3: [
      { id: 13,rutina_id: 3, nombre: 'Sentadilla libre',    series: 4, reps_objetivo: '6-10',  orden: 1 },
      { id: 14,rutina_id: 3, nombre: 'Prensa de piernas',   series: 3, reps_objetivo: '10-12', orden: 2 },
      { id: 15,rutina_id: 3, nombre: 'Zancadas mancuernas', series: 3, reps_objetivo: '12c/p', orden: 3 },
      { id: 16,rutina_id: 3, nombre: 'Curl femoral',        series: 3, reps_objetivo: '12-15', orden: 4 },
      { id: 17,rutina_id: 3, nombre: 'Hip thrust',          series: 4, reps_objetivo: '10-12', orden: 5 },
      { id: 18,rutina_id: 3, nombre: 'Gemelos en máquina',  series: 4, reps_objetivo: '15-20', orden: 6 }
    ]
  };

  // null = sin sesión activa hoy → mostrará el selector de rutinas
  // Cambia a un objeto para simular sesión en curso (ver abajo)
  const MOCK_SESION_HOY = null;
  /* Ejemplo con sesión activa:
  const MOCK_SESION_HOY = {
    id: 1, fecha: HOY, rutina_id: 1, rutina_nombre: 'PUSH',
    completada: false, notas: '',
    series: [
      { ejercicio_id: 1, ejercicio_nombre: 'Press banca plano', serie_num: 1, peso: 87.5, reps: 8, completada: true },
      { ejercicio_id: 1, ejercicio_nombre: 'Press banca plano', serie_num: 2, peso: 87.5, reps: 8, completada: true }
    ]
  };
  */

  const MOCK_SESIONES = [
    { id: 1, fecha: '2026-04-29', rutina_id: 1, rutina_nombre: 'PUSH', completada: true, total_series: 18 },
    { id: 2, fecha: '2026-04-28', rutina_id: 2, rutina_nombre: 'PULL', completada: true, total_series: 16 },
    { id: 3, fecha: '2026-04-26', rutina_id: 3, rutina_nombre: 'LEGS', completada: true, total_series: 20 }
  ];

  const MOCK_PROYECTOS = [
    { id: 1, nombre: 'OkiroSport PWA',      objetivo: 'MVP desplegado',          progreso: 78, ultima_accion: 'Deploy v2 + módulo gym' },
    { id: 2, nombre: 'Agencia IA Freelance', objetivo: 'Primer cliente cerrado',  progreso: 45, ultima_accion: 'Propuesta cliente #3'   },
    { id: 3, nombre: 'Contenido Training',   objetivo: '1k seguidores',           progreso: 30, ultima_accion: 'Vídeo Press Banca'       }
  ];

  const MOCK_NUTRICION = {
    comidas: [
      { id: 1, fecha: HOY, nombre: 'Avena + proteína',   calorias: 420, proteinas: 35, carbos: 55, grasas: 8  },
      { id: 2, fecha: HOY, nombre: 'Pechuga + arroz',    calorias: 580, proteinas: 52, carbos: 68, grasas: 10 },
      { id: 3, fecha: HOY, nombre: 'Greek yogurt + fruta', calorias: 280, proteinas: 20, carbos: 38, grasas: 5  },
      { id: 4, fecha: HOY, nombre: 'Salmón + verduras',  calorias: 560, proteinas: 45, carbos: 20, grasas: 25 }
    ],
    totales: { calorias: 1840, proteinas: 152, carbos: 181, grasas: 48 }
  };

  // ── INTERCEPTOR ─────────────────────────────────────────────

  window.fetch = function (url, opts) {
    const u = typeof url === 'string' ? url : url.toString();

    // GET /auth/check — en mock siempre autorizado
    if (u.endsWith('/auth/check')) {
      return mockOk({ ok: true });
    }

    // POST /ia/resumen — análisis IA simulado
    if (u.endsWith('/ia/resumen') && opts?.method === 'POST') {
      const tipo = JSON.parse(opts.body || '{}').tipo;
      return mockOk({
        texto: tipo === 'weekly'
          ? '[MOCK] ANÁLISIS SEMANAL\n\nTendencia: ascendente. 3/7 días con entreno.\nMejor día: 29 ABR (carrera 8km + energía 9).\nPatrón a corregir: sueño irregular.\nObjetivo próximo: 4 entrenos.\nRango de la semana: B.'
          : '[MOCK] ANÁLISIS DIARIO\n\nEstado: sólido. Entreno completado y 7.5h de sueño.\nPunto fuerte: constancia en el gym.\nA mejorar: sube proteína a 180g.\nPuntuación: 8/10.',
        modelo: 'mock'
      });
    }

    // POST /nutricion/analizar-foto — respuesta simulada
    if (u.endsWith('/nutricion/analizar-foto') && opts?.method === 'POST') {
      return mockOk({ nombre: 'Plato mock: pollo con arroz', calorias: 560, proteinas: 48, carbos: 62, grasas: 12 });
    }

    // DELETE /nutricion/:id
    if (/\/nutricion\/\d+$/.test(u) && opts?.method === 'DELETE') {
      return mockOk({ ok: true });
    }

    // GET /logs
    if (u.endsWith('/logs') && (!opts || opts.method === undefined || opts.method === 'GET')) {
      return mockOk(MOCK_LOGS);
    }

    // GET /rutinas
    if (/\/rutinas$/.test(u) && (!opts || !opts.method || opts.method === 'GET')) {
      return mockOk(MOCK_RUTINAS);
    }

    // GET /rutinas/:id/ejercicios
    const ejerciciosMatch = u.match(/\/rutinas\/(\d+)\/ejercicios/);
    if (ejerciciosMatch) {
      return mockOk(MOCK_EJERCICIOS[ejerciciosMatch[1]] || []);
    }

    // GET /sesiones/hoy
    if (u.endsWith('/sesiones/hoy')) {
      return mockOk(MOCK_SESION_HOY);
    }

    // GET /sesiones
    if (/\/sesiones$/.test(u) && (!opts || !opts.method || opts.method === 'GET')) {
      return mockOk(MOCK_SESIONES);
    }

    // POST /sesiones — simula crear sesión devolviendo datos básicos
    if (/\/sesiones$/.test(u) && opts?.method === 'POST') {
      const body = JSON.parse(opts.body || '{}');
      return mockOk({ id: 99, fecha: HOY, rutina_id: body.rutina_id, completada: false, notas: '', series: [] });
    }

    // POST /sesiones/:id/series — simula guardar serie
    if (/\/sesiones\/\d+\/series$/.test(u) && opts?.method === 'POST') {
      const body = JSON.parse(opts.body || '{}');
      return mockOk({ ...body, id: Math.random(), completada: true });
    }

    // PUT /sesiones/:id/completar
    if (/\/sesiones\/\d+\/completar$/.test(u) && opts?.method === 'PUT') {
      return mockOk({ id: 99, completada: true });
    }

    // GET /nutricion/:fecha
    if (/\/nutricion\/\d{4}-\d{2}-\d{2}$/.test(u)) {
      return mockOk(MOCK_NUTRICION);
    }

    // POST /nutricion — simula guardar comida
    if (/\/nutricion$/.test(u) && opts?.method === 'POST') {
      const body = JSON.parse(opts.body || '{}');
      return mockOk({ id: Math.random(), ...body });
    }

    // GET /proyectos
    if (u.endsWith('/proyectos') && (!opts || !opts.method || opts.method === 'GET')) {
      return mockOk(MOCK_PROYECTOS);
    }

    // PUT /proyectos/:id
    if (/\/proyectos\/\d+$/.test(u) && opts?.method === 'PUT') {
      return mockOk({ ok: true });
    }

    // DELETE /proyectos/:id
    if (/\/proyectos\/\d+$/.test(u) && opts?.method === 'DELETE') {
      return mockOk({ ok: true });
    }

    // POST /logs — simula guardar log del día
    if (u.endsWith('/logs') && opts?.method === 'POST') {
      return mockOk({ ok: true });
    }

    // Cualquier otra ruta (Anthropic API, Strava, etc.) → pasa al fetch real
    return _fetch(url, opts);
  };

  function mockOk(data) {
    return Promise.resolve(new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
  }

  console.warn('[MOCK] Datos hardcodeados activos — eliminar mock.js antes de producción');
})();
