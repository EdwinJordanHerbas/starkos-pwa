-- ═══════════════════════════════════════════════════════════════
-- OKIRO v12 — El progreso sube al servidor, y la misión tiene peso
--
-- Rango, nivel, XP y racha se calculaban en el navegador y se
-- guardaban en localStorage. Eso significaba tres cosas malas:
-- se perdían al cambiar de móvil o vaciar la caché, cualquier
-- penalización se esquivaba borrando datos del navegador, y el cron
-- de cierre no podía aplicar nada porque ni siquiera conocía el rango.
--
-- Ahora el estado vive en Postgres y lo calcula el backend. Con eso,
-- cumplir la misión suma y fallarla resta de verdad.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Estado del jugador ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS progreso (
  usuario_id     INTEGER PRIMARY KEY DEFAULT 1,
  xp             INTEGER NOT NULL DEFAULT 0,
  nivel          INTEGER NOT NULL DEFAULT 1,
  rango          VARCHAR(2) NOT NULL DEFAULT 'E',
  racha          INTEGER NOT NULL DEFAULT 0,
  mejor_racha    INTEGER NOT NULL DEFAULT 0,
  penalizaciones INTEGER NOT NULL DEFAULT 0,
  actualizado    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO progreso (usuario_id) VALUES (1) ON CONFLICT DO NOTHING;

-- ── 2. Lo que da y quita cada misión ───────────────────────────
-- Se guarda en la propia misión y no se recalcula: el XP de un día
-- pasado no debe cambiar porque hoy toquemos las reglas.
ALTER TABLE misiones ADD COLUMN IF NOT EXISTS xp_bonus INTEGER NOT NULL DEFAULT 0;

-- Misión de recuperación: la que se genera al día siguiente de fallar.
-- En Solo Leveling la penalización es MÁS esfuerzo, no menos.
ALTER TABLE misiones ADD COLUMN IF NOT EXISTS recuperacion BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 3. Permisos ────────────────────────────────────────────────
DO $$
DECLARE app_user TEXT;
BEGIN
  FOR app_user IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_name = 'proyectos' AND privilege_type = 'INSERT'
       AND grantee NOT IN ('postgres', 'PUBLIC')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON progreso TO %I', app_user);
  END LOOP;
END $$;
