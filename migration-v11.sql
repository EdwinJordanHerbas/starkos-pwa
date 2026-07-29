-- ═══════════════════════════════════════════════════════════════
-- OKIRO v11 — La misión diaria, de verdad
--
-- Hasta ahora el modal enseñaba la rutina de gym del día y tenía dos
-- botones, ACEPTAR y SALTAR, que llamaban a la misma función: cerrar.
-- Aceptar no guardaba nada, así que daba igual lo que pulsaras.
--
-- Ahora una misión es un compromiso del día con objetivos de TODOS los
-- ámbitos —entreno, nutrición, descanso, proyectos e idioma—, se acepta
-- o se rechaza y eso queda registrado.
--
-- Lo que NO se guarda es si cada objetivo está cumplido: eso se evalúa
-- en vivo contra los datos reales (¿entrenaste?, ¿cerraste un hito?,
-- ¿repasaste palabras?). Así no hay dos verdades que sincronizar y la
-- misión se cumple sola viviendo el día, sin marcar nada a mano.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS misiones (
  id          SERIAL PRIMARY KEY,
  fecha       DATE NOT NULL,
  estado      VARCHAR(12) NOT NULL DEFAULT 'ofrecida',  -- ofrecida | aceptada | rechazada
  resultado   VARCHAR(12),                              -- cumplida | fallada (lo sella el cierre)
  aceptada_en TIMESTAMPTZ,
  cerrada_en  TIMESTAMPTZ,
  usuario_id  INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fecha, usuario_id)
);

CREATE TABLE IF NOT EXISTS mision_objetivos (
  id        SERIAL PRIMARY KEY,
  mision_id INTEGER NOT NULL REFERENCES misiones(id) ON DELETE CASCADE,
  clave     VARCHAR(20) NOT NULL,   -- entreno | proteina | sueno | hito | ingles
  texto     TEXT NOT NULL,
  meta      NUMERIC,                -- 160 g, 20 palabras, 1 hito...
  orden     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS mision_objetivos_idx ON mision_objetivos(mision_id, orden);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'misiones_estado_ck') THEN
    ALTER TABLE misiones ADD CONSTRAINT misiones_estado_ck
      CHECK (estado IN ('ofrecida','aceptada','rechazada'));
  END IF;
END $$;

-- Las bases las creó `postgres` pero la app entra con su propio usuario.
DO $$
DECLARE app_user TEXT;
BEGIN
  FOR app_user IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_name = 'proyectos' AND privilege_type = 'INSERT'
       AND grantee NOT IN ('postgres', 'PUBLIC')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON misiones TO %I', app_user);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON mision_objetivos TO %I', app_user);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE misiones_id_seq TO %I', app_user);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE mision_objetivos_id_seq TO %I', app_user);
  END LOOP;
END $$;
