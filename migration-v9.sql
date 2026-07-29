-- ═══════════════════════════════════════════════════════════════
-- OKIRO v9 — Hitos: lo que hace medible el trabajo
--
-- La v8 resolvió lo que tiene número propio: el cuerpo se mide en kg,
-- la constancia en entrenos, el negocio en clientes. Pero un trabajo de
-- cliente no tiene cifra natural — Salonio no se mide en "unidades de
-- Salonio" — y por eso cinco proyectos seguían saliendo SIN FIN.
--
-- Un trabajo se mide por lo que queda por cerrar. Con esto el progreso
-- queda en cascada:
--
--   1. cifra    → valor_actual / meta_valor   (v8, manual o automática)
--   2. hitos    → marcados / totales          (esta migración)
--   3. manual   → el valor de siempre
--
-- Y de paso cierra un agujero viejo: `daily_logs.tareas_completadas` y
-- `tareas_total` llevan desde el principio en la tabla, las usa el cruce
-- para responder "¿mi semana floja de gym coincide con la floja de
-- proyectos?", y nunca se llenaron porque dependían del sync de Notion
-- que jamás llegó a configurarse.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proyecto_tareas (
  id            SERIAL PRIMARY KEY,
  proyecto_id   INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  texto         TEXT NOT NULL,
  hecha         BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_limite  DATE,
  orden         INTEGER NOT NULL DEFAULT 0,
  -- Fecha en que se marcó: sin esto no se puede saber cuántos hitos
  -- cerraste un día concreto, que es justo lo que el cruce necesita.
  completada_en DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proyecto_tareas_proy_idx  ON proyecto_tareas(proyecto_id, orden, id);
CREATE INDEX IF NOT EXISTS proyecto_tareas_fecha_idx ON proyecto_tareas(completada_en);

-- Las bases las creó `postgres` pero la app entra con su propio usuario:
-- sin esto responde "permission denied for table proyecto_tareas".
DO $$
DECLARE app_user TEXT;
BEGIN
  FOR app_user IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_name = 'proyectos' AND privilege_type = 'INSERT'
       AND grantee NOT IN ('postgres', 'PUBLIC')
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON proyecto_tareas TO %I', app_user);
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE proyecto_tareas_id_seq TO %I', app_user);
  END LOOP;
END $$;
