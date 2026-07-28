-- ═══════════════════════════════════════════════════════════════
-- OKIRO v6 — Los proyectos dejan de ser "una barra de progreso"
--
-- Dos cambios de fondo:
--   1. FIN MEDIBLE. Cada proyecto declara a dónde va (meta) y en qué
--      unidad se mide (metrica + meta_valor), y dónde está hoy
--      (valor_actual). El progreso deja de ser un slider a ojo.
--   2. JERARQUÍA. Un proyecto puede colgar de otro (padre_id), para que
--      los trabajos de cliente se agrupen bajo la marca que los firma.
--
-- Idempotente: se puede aplicar tantas veces como haga falta.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. El fin de cada proyecto ─────────────────────────────────
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS meta         TEXT;           -- "Facturar 10.000 €/mes"
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS metrica      VARCHAR(40);    -- "€/mes", "clientes", "kg"
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS meta_valor   NUMERIC(12,2);  -- 10000
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS valor_actual NUMERIC(12,2) DEFAULT 0;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS categoria    VARCHAR(20);    -- negocio | fisico | aprendizaje | personal

-- ── 2. Jerarquía ───────────────────────────────────────────────
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS padre_id INTEGER;

-- La FK se añade aparte: ADD CONSTRAINT no admite IF NOT EXISTS en
-- PostgreSQL, así que se comprueba antes en el catálogo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proyectos_padre_fk'
  ) THEN
    ALTER TABLE proyectos
      ADD CONSTRAINT proyectos_padre_fk
      FOREIGN KEY (padre_id) REFERENCES proyectos(id) ON DELETE SET NULL;
  END IF;

  -- Un proyecto no puede ser su propio padre. Los ciclos más largos los
  -- corta el backend limitando la jerarquía a un solo nivel.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proyectos_padre_no_self'
  ) THEN
    ALTER TABLE proyectos
      ADD CONSTRAINT proyectos_padre_no_self CHECK (padre_id IS NULL OR padre_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS proyectos_padre_idx ON proyectos(padre_id);

-- ── 3. Historial de acciones ───────────────────────────────────
-- Hasta ahora `ultima_accion` se sobrescribía y se perdía todo lo
-- anterior: no había forma de responder "¿qué hice aquí esta semana?".
CREATE TABLE IF NOT EXISTS proyecto_acciones (
  id           SERIAL PRIMARY KEY,
  proyecto_id  INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  fecha        DATE NOT NULL DEFAULT CURRENT_DATE,
  accion       TEXT NOT NULL,
  progreso     INTEGER,
  valor_actual NUMERIC(12,2),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proyecto_acciones_proy_idx ON proyecto_acciones(proyecto_id, fecha DESC);

-- ── 4. Permisos ────────────────────────────────────────────────
-- Las tablas las crea el superusuario `postgres` pero la app se conecta
-- con su propio usuario: sin esto, la tabla nueva responde
-- "permission denied for table proyecto_acciones".
DO $$
DECLARE
  app_user TEXT;
BEGIN
  FOR app_user IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_name = 'proyectos' AND privilege_type = 'INSERT'
       AND grantee NOT IN ('postgres', 'PUBLIC')
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON proyecto_acciones TO %I', app_user);
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE proyecto_acciones_id_seq TO %I', app_user);
  END LOOP;
END $$;
