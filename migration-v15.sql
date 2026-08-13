-- ═══════════════════════════════════════════════════════════════════
-- v15 — Plan de 5 días para hipertrofia (13-ago-2026)
-- ═══════════════════════════════════════════════════════════════════
--
-- POR QUÉ CAMBIA EL PLAN
-- Las rutinas que había eran las de ejemplo del seed: tres días de 6
-- ejercicios (~20 series por sesión) y con los días solapados —el miércoles
-- caían PUSH y LEGS a la vez—. Él lleva 3 años entrenando pero volvía de 6
-- meses parado y quería 5 días.
--
-- QUÉ SE MONTA: split PUSH · PULL · LEGS · UPPER · LOWER, de lunes a viernes.
-- Cada grupo muscular se entrena 2 veces por semana (el torso casi 3), que es
-- lo que más rinde frente a una sola vez, y el volumen semanal por grupo cae
-- en 10-17 series, la horquilla donde la respuesta sigue subiendo sin pasarse.
-- Sesiones de 14-18 series ≈ 50 min, en vez de 20-21.
--
-- CÓMO SE REORGANIZA SIN PERDER NADA
-- Los ejercicios no se borran: los que se mueven de día se marcan
-- `activo=false` en su rutina vieja y se crean de nuevo en la que les toca.
-- Un ejercicio pertenece a UNA rutina (`ejercicios.rutina_id`), así que no se
-- pueden compartir entre días. Nada se pierde: `series_realizadas` sigue
-- colgando de los ids viejos y el historial se mantiene.
--
-- Los `dataset_id` de los ejercicios nuevos están comprobados uno a uno mirando
-- la animación, como manda CLAUDE.md. Nota: el catálogo NO tiene un hip thrust
-- con la espalda en el banco; 1409 (puente de glúteo con barra) es la variante
-- más cercana que hay, y es la que ya venía usándose.
--
-- Idempotente: se puede aplicar dos veces sin duplicar nada.

-- ── 1. RUTINAS ─────────────────────────────────────────────────────
INSERT INTO rutinas (nombre, descripcion, dias) VALUES
  ('UPPER', 'Todo el torso, otros ángulos', '["jueves"]'),
  ('LOWER', 'Femoral · Glúteo · Gemelos',   '["viernes"]')
ON CONFLICT (nombre) DO NOTHING;

-- Un día por rutina: antes el miércoles tenía PUSH y LEGS a la vez
UPDATE rutinas SET dias = '["lunes"]',     descripcion = 'Pecho · Hombros · Tríceps' WHERE nombre = 'PUSH';
UPDATE rutinas SET dias = '["martes"]',    descripcion = 'Espalda · Bíceps'          WHERE nombre = 'PULL';
UPDATE rutinas SET dias = '["miércoles"]', descripcion = 'Cuádriceps · Gemelos'      WHERE nombre = 'LEGS';
UPDATE rutinas SET dias = '["jueves"]',    descripcion = 'Todo el torso, otros ángulos' WHERE nombre = 'UPPER';
UPDATE rutinas SET dias = '["viernes"]',   descripcion = 'Femoral · Glúteo · Gemelos'   WHERE nombre = 'LOWER';

-- ── 2. LOS QUE SE MUDAN DE DÍA ─────────────────────────────────────
-- Fondos y curl martillo se van a UPPER; zancadas y hip thrust, a LOWER.
-- Se archivan, no se borran: volver a ponerlos es un UPDATE.
UPDATE ejercicios e SET activo = false
  FROM rutinas r
 WHERE e.rutina_id = r.id
   AND ((r.nombre = 'PUSH' AND e.nombre = 'Fondos en paralelas')
     OR (r.nombre = 'PULL' AND e.nombre = 'Curl martillo')
     OR (r.nombre = 'LEGS' AND e.nombre IN ('Zancadas mancuernas', 'Hip thrust')));

-- ── 3. AJUSTE DE LOS QUE SE QUEDAN ─────────────────────────────────
-- El press militar baja a 3 series (con el banca ya son 7 de empuje pesado)
-- y las laterales suben de rango: el deltoide responde bien a más reps.
UPDATE ejercicios e SET series = 3, reps_objetivo = '8-12', orden = 2
  FROM rutinas r WHERE e.rutina_id = r.id AND r.nombre = 'PUSH' AND e.nombre = 'Press militar barra';
UPDATE ejercicios e SET orden = 3
  FROM rutinas r WHERE e.rutina_id = r.id AND r.nombre = 'PUSH' AND e.nombre = 'Press inclinado mancuerna';
UPDATE ejercicios e SET series = 3, reps_objetivo = '12-20', orden = 4
  FROM rutinas r WHERE e.rutina_id = r.id AND r.nombre = 'PUSH' AND e.nombre = 'Elevaciones laterales';
UPDATE ejercicios e SET orden = 5
  FROM rutinas r WHERE e.rutina_id = r.id AND r.nombre = 'PUSH' AND e.nombre = 'Extensión tríceps polea';

UPDATE ejercicios e SET series = 4, reps_objetivo = '12-20'
  FROM rutinas r WHERE e.rutina_id = r.id AND r.nombre = 'LEGS' AND e.nombre = 'Gemelos en máquina';
UPDATE ejercicios e SET orden = 3
  FROM rutinas r WHERE e.rutina_id = r.id AND r.nombre = 'LEGS' AND e.nombre = 'Curl femoral';
UPDATE ejercicios e SET orden = 4
  FROM rutinas r WHERE e.rutina_id = r.id AND r.nombre = 'LEGS' AND e.nombre = 'Gemelos en máquina';

-- ── 4. UPPER (jueves) ──────────────────────────────────────────────
INSERT INTO ejercicios (rutina_id, nombre, series, reps_objetivo, orden, dataset_id)
SELECT r.id, e.nombre, e.series::int, e.reps, e.ord::int, e.ds
FROM rutinas r
CROSS JOIN (VALUES
  ('Press inclinado barra', '3', '8-12',  '1', '0047'),
  ('Jalón al pecho polea',  '3', '10-12', '2', '2330'),
  ('Fondos en paralelas',   '3', '8-12',  '3', '0251'),
  ('Remo con mancuerna',    '3', '10-12', '4', '0293'),
  ('Elevaciones laterales', '3', '15-20', '5', '0334'),
  ('Curl martillo',         '3', '12-15', '6', '0313')
) AS e(nombre, series, reps, ord, ds)
WHERE r.nombre = 'UPPER'
  AND NOT EXISTS (SELECT 1 FROM ejercicios x WHERE x.rutina_id = r.id AND x.nombre = e.nombre);

-- ── 5. LOWER (viernes) ─────────────────────────────────────────────
INSERT INTO ejercicios (rutina_id, nombre, series, reps_objetivo, orden, dataset_id)
SELECT r.id, e.nombre, e.series::int, e.reps, e.ord::int, e.ds
FROM rutinas r
CROSS JOIN (VALUES
  ('Peso muerto rumano',      '4', '8-12',  '1', '0085'),
  ('Hip thrust',              '3', '10-12', '2', '1409'),
  ('Sentadilla búlgara',      '3', '10-12', '3', '0410'),
  ('Extensión de cuádriceps', '3', '12-15', '4', '0585'),
  ('Gemelos de pie',          '3', '15-20', '5', '0605')
) AS e(nombre, series, reps, ord, ds)
WHERE r.nombre = 'LOWER'
  AND NOT EXISTS (SELECT 1 FROM ejercicios x WHERE x.rutina_id = r.id AND x.nombre = e.nombre);

SELECT 'Migration v15 OK · plan de 5 días · ' || NOW() AS status;
