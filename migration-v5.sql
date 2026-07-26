-- OKIRO v5 · Multiusuario y party cooperativa
-- Aditiva e idempotente: no rompe la app mono-usuario que ya está en producción.
--
-- Ejecutar:
--   docker exec -i postgres psql -U postgres -d starkos < migration-v5.sql
--
-- DISEÑO
-- El usuario 1 es el dueño actual. Todas las filas existentes se le asignan y
-- usuario_id queda con DEFAULT 1, así que cualquier consulta que aún no filtre
-- por usuario sigue comportándose exactamente igual que hoy. Eso permite migrar
-- los endpoints uno a uno sin una ventana de app rota.
--
-- NO hay auto-registro: los usuarios se crean a mano. Mientras solo exista el
-- usuario 1, es imposible que alguien vea datos de otro.

-- ── USUARIOS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(80)  NOT NULL,
  email       VARCHAR(200) UNIQUE,
  token_hash  TEXT,                      -- SHA-256 de la clave; nunca la clave en claro
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- El dueño. Su clave sigue siendo APP_TOKEN hasta que se le asigne una propia.
INSERT INTO usuarios (id, nombre) VALUES (1, 'Dueño')
ON CONFLICT (id) DO NOTHING;
SELECT setval('usuarios_id_seq', GREATEST((SELECT MAX(id) FROM usuarios), 1));

-- ── usuario_id en las tablas de datos ─────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'daily_logs','comidas','sesiones_gym','proyectos','rutinas',
    'strava_tokens','strava_activities','push_subs'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN IF NOT EXISTS usuario_id INTEGER NOT NULL DEFAULT 1
           REFERENCES usuarios(id) ON DELETE CASCADE', t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(usuario_id)', t || '_usuario_idx', t);
    END IF;
  END LOOP;
END $$;

-- La unicidad de daily_logs pasa a ser por usuario: dos personas pueden
-- registrar el mismo día. Sin esto, el segundo usuario pisaría al primero.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_logs_fecha_unique') THEN
    ALTER TABLE daily_logs DROP CONSTRAINT daily_logs_fecha_unique;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_logs_usuario_fecha_unique') THEN
    ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_usuario_fecha_unique UNIQUE (usuario_id, fecha);
  END IF;
END $$;

-- ── PARTY: sostener, no competir ──────────────────────────────
-- Un grupo pequeño con racha colectiva. El aura del grupo se mantiene mientras
-- TODOS registren; si uno falla, baja para todos. Cooperativo por diseño:
-- convierte al miembro débil en alguien a quien el grupo sostiene, no humilla.
--
-- Solo circula dato NATIVO de OKIRO (rango y racha). Nada importado de Strava:
-- su acuerdo de API prohíbe mostrar los datos de un usuario a otro usuario.
CREATE TABLE IF NOT EXISTS parties (
  id         SERIAL PRIMARY KEY,
  nombre     VARCHAR(80) NOT NULL,
  codigo     VARCHAR(12) UNIQUE NOT NULL,   -- para invitar sin exponer ids
  creada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS party_miembros (
  party_id   INTEGER REFERENCES parties(id)  ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  entro_el   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (party_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS party_miembros_usuario_idx ON party_miembros(usuario_id);
