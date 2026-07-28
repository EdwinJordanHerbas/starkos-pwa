-- ═══════════════════════════════════════════════════════════════
-- OKIRO v8 — Medir de verdad
--
-- Hasta aquí el número de cada proyecto se tecleaba a mano, y una
-- cifra que hay que acordarse de actualizar deja de actualizarse.
-- Dos cosas:
--
--   1. `fuente` dice de dónde sale el número. Con 'manual' se sigue
--      escribiendo; con cualquier otra, OKIRO lo calcula de sus
--      propios datos y el proyecto avanza solo al entrenar o registrar.
--
--   2. `medidas_corporales`: no existía ningún sitio donde apuntar
--      masa muscular ni grasa, así que "volver a mi mejor versión"
--      —el motivo por el que nació OKIRO— no era medible.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS fuente VARCHAR(30) NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS medidas_corporales (
  id            SERIAL PRIMARY KEY,
  fecha         DATE NOT NULL,
  peso          NUMERIC(5,2),
  masa_muscular NUMERIC(5,2),
  grasa_pct     NUMERIC(4,1),
  notas         TEXT,
  usuario_id    INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMP DEFAULT now(),
  UNIQUE (fecha, usuario_id)
);

CREATE INDEX IF NOT EXISTS medidas_fecha_idx ON medidas_corporales(usuario_id, fecha DESC);

-- Las bases las creó `postgres` pero la app entra con su propio usuario:
-- sin esto responde "permission denied for table medidas_corporales".
DO $$
DECLARE app_user TEXT;
BEGIN
  FOR app_user IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_name = 'proyectos' AND privilege_type = 'INSERT'
       AND grantee NOT IN ('postgres', 'PUBLIC')
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON medidas_corporales TO %I', app_user);
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE medidas_corporales_id_seq TO %I', app_user);
  END LOOP;
END $$;
