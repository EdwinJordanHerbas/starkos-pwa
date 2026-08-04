-- ═══════════════════════════════════════════════════════════════
-- OKIRO v13 — La técnica se ve, y los macros dejan de contradecirse
--
-- Dos arreglos con la misma raíz: había datos que la app daba por
-- sabidos y que en realidad no estaban en ninguna parte.
--
-- 1. TÉCNICA. La app emparejaba cada ejercicio con el dataset por
--    su nombre en español, contra una lista de 20 traducciones
--    escritas a mano. Cualquier ejercicio nuevo se quedaba sin
--    técnica, y varias de esas traducciones apuntaban a nombres que
--    ni existen en el dataset. Ahora el vínculo es un id guardado.
--
-- 2. MACROS. Los objetivos vivían en el localStorage del móvil, así
--    que el servidor no los conocía: el prompt de la IA llevaba
--    2400/180/300/70 escritos a mano y /resumen otros distintos
--    (2200/160). Cambiarlos en la app no cambiaba nada de eso, y al
--    cambiar de móvil se perdían. Ahora hay una sola fuente.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Vínculo con el catálogo de ejercicios ───────────────────
-- El id del dataset (hasaneyldrm/exercises-dataset), zero-padded a 4.
ALTER TABLE ejercicios ADD COLUMN IF NOT EXISTS dataset_id VARCHAR(8);

-- Semilla de los ejercicios que ya estaban sembrados. Se emparejan por
-- nombre UNA vez; a partir de aquí el nombre se puede editar sin perder
-- la técnica. Solo rellena lo que esté vacío: si él ya eligió otro
-- ejercicio del catálogo, esto no se lo pisa.
UPDATE ejercicios e SET dataset_id = v.did
  FROM (VALUES
    ('Press banca plano',         '0025'),  -- barbell bench press
    ('Press inclinado mancuerna', '0314'),  -- dumbbell incline bench press
    ('Fondos en paralelas',       '0251'),  -- chest dip
    ('Press militar barra',       '0091'),  -- barbell seated overhead press
    ('Elevaciones laterales',     '0334'),  -- dumbbell lateral raise
    ('Extensión tríceps polea',   '0201'),  -- cable pushdown
    ('Dominadas',                 '0652'),  -- pull-up
    ('Remo con barra',            '0027'),  -- barbell bent over row
    ('Remo en polea baja',        '0180'),  -- cable low seated row
    ('Face pulls',                '0203'),  -- cable rear delt row (with rope)
    ('Curl bíceps barra',         '0031'),  -- barbell curl
    ('Curl martillo',             '0313'),  -- dumbbell hammer curl
    ('Sentadilla libre',          '0043'),  -- barbell full squat
    ('Prensa de piernas',         '0739'),  -- sled 45° leg press
    ('Zancadas mancuernas',       '0336'),  -- dumbbell lunge
    ('Curl femoral',              '0586'),  -- lever lying leg curl
    ('Hip thrust',                '1409'),  -- barbell glute bridge
    ('Gemelos en máquina',        '0605')   -- lever standing calf raise
  ) AS v(nombre, did)
 WHERE e.nombre = v.nombre AND e.dataset_id IS NULL;

-- ── 2. Quitar un ejercicio sin perder lo levantado ─────────────
-- series_realizadas apunta a ejercicios(id) sin ON DELETE, así que
-- borrar uno con historial reventaría por clave foránea. Los que ya
-- tienen series se archivan en vez de borrarse: el historial de lo
-- que levantaste no se tira porque hoy cambies de rutina.
ALTER TABLE ejercicios ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

-- La tarjeta de cada ejercicio pide su última serie al abrirse.
CREATE INDEX IF NOT EXISTS series_ejercicio_idx ON series_realizadas(ejercicio_id);

-- ── 3. Objetivos de macros: una sola fuente ────────────────────
-- Arranca con los mismos números que la app tenía por defecto, para
-- que nadie se encuentre objetivos distintos tras la migración.
CREATE TABLE IF NOT EXISTS objetivos_nutricion (
  usuario_id  INTEGER PRIMARY KEY DEFAULT 1,
  calorias    INTEGER NOT NULL DEFAULT 2400 CHECK (calorias  > 0 AND calorias  <= 20000),
  proteinas   INTEGER NOT NULL DEFAULT 180  CHECK (proteinas >= 0 AND proteinas <= 2000),
  carbos      INTEGER NOT NULL DEFAULT 300  CHECK (carbos    >= 0 AND carbos    <= 2000),
  grasas      INTEGER NOT NULL DEFAULT 70   CHECK (grasas    >= 0 AND grasas    <= 2000),
  actualizado TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO objetivos_nutricion (usuario_id) VALUES (1) ON CONFLICT DO NOTHING;

-- ── 4. Permisos ────────────────────────────────────────────────
-- Las bases las creó `postgres` pero la app se conecta con su propio
-- usuario: sin esto, "permission denied for table objetivos_nutricion".
DO $$
DECLARE app_user TEXT;
BEGIN
  FOR app_user IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_name = 'proyectos' AND privilege_type = 'INSERT'
       AND grantee NOT IN ('postgres', 'PUBLIC')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON objetivos_nutricion TO %I', app_user);
  END LOOP;
END $$;
