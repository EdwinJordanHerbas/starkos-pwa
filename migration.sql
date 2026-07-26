-- OkiroSport v2 · Migration
-- Ejecutar en el servidor:
-- curl -s "https://raw.githubusercontent.com/EdwinJordanHerbas/starkos-pwa/main/migration.sql" \
--   | docker exec -i postgres psql -U postgres -d starkos

-- ── DAILY LOGS (tabla base, puede ya existir) ─────────────────
CREATE TABLE IF NOT EXISTS daily_logs (
  id                  SERIAL PRIMARY KEY,
  fecha               DATE NOT NULL,
  sueno               NUMERIC(3,1),
  energia             INTEGER,
  entreno_completado  BOOLEAN DEFAULT false,
  tipo_entreno        VARCHAR(50),
  nutricion           INTEGER,
  tareas_completadas  INTEGER DEFAULT 0,
  tareas_total        INTEGER DEFAULT 5,
  notas               TEXT,
  created_at          TIMESTAMP DEFAULT NOW()
);

-- Constraint única por fecha (idempotente)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_logs_fecha_unique'
  ) THEN
    ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_fecha_unique UNIQUE (fecha);
  END IF;
END $$;

-- ── RUTINAS GYM ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rutinas (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  dias        JSONB DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ejercicios (
  id            SERIAL PRIMARY KEY,
  rutina_id     INTEGER REFERENCES rutinas(id) ON DELETE CASCADE,
  nombre        VARCHAR(100) NOT NULL,
  series        INTEGER DEFAULT 3,
  reps_objetivo VARCHAR(20) DEFAULT '8-12',
  orden         INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sesiones_gym (
  id         SERIAL PRIMARY KEY,
  fecha      DATE NOT NULL UNIQUE,
  rutina_id  INTEGER REFERENCES rutinas(id),
  completada BOOLEAN DEFAULT FALSE,
  foto_url   TEXT,
  notas      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS series_realizadas (
  id           SERIAL PRIMARY KEY,
  sesion_id    INTEGER REFERENCES sesiones_gym(id) ON DELETE CASCADE,
  ejercicio_id INTEGER REFERENCES ejercicios(id),
  serie_num    INTEGER NOT NULL,
  peso         NUMERIC(6,2),
  reps         INTEGER,
  completada   BOOLEAN DEFAULT TRUE,
  UNIQUE (sesion_id, ejercicio_id, serie_num)
);

-- ── STRAVA ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strava_tokens (
  athlete_id    BIGINT PRIMARY KEY,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    BIGINT
);

CREATE TABLE IF NOT EXISTS strava_activities (
  id          SERIAL PRIMARY KEY,
  strava_id   BIGINT UNIQUE,
  athlete_id  BIGINT,
  nombre      TEXT,
  tipo        VARCHAR(50),
  fecha       TIMESTAMPTZ,
  distancia   NUMERIC(10,2),
  tiempo      INTEGER,
  elevacion   NUMERIC(8,2),
  calorias    INTEGER,
  avg_hr      NUMERIC(5,2),
  max_hr      NUMERIC(5,2),
  avg_speed   NUMERIC(8,4),
  kudos       INTEGER DEFAULT 0,
  datos_raw   JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── CONFIG ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  clave VARCHAR(100) PRIMARY KEY,
  valor TEXT
);

-- ── NUTRICIÓN ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comidas (
  id         SERIAL PRIMARY KEY,
  fecha      DATE NOT NULL,
  nombre     VARCHAR(200) NOT NULL,
  calorias   INTEGER DEFAULT 0,
  proteinas  NUMERIC(6,2) DEFAULT 0,
  carbos     NUMERIC(6,2) DEFAULT 0,
  grasas     NUMERIC(6,2) DEFAULT 0,
  foto_url   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comidas_fecha_idx ON comidas(fecha);

-- ── SUSCRIPCIONES PUSH (misión diaria) ────────────────────────
-- Un dispositivo = una fila. El endpoint es único por dispositivo/navegador.
CREATE TABLE IF NOT EXISTS push_subs (
  id          SERIAL PRIMARY KEY,
  endpoint    TEXT UNIQUE NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  hora_aviso  SMALLINT DEFAULT 8   CHECK (hora_aviso  >= 0 AND hora_aviso  <= 23),
  hora_cierre SMALLINT DEFAULT 22  CHECK (hora_cierre >= 0 AND hora_cierre <= 23),
  activa      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Marca qué avisos se han enviado ya, para no repetir si el cron corre dos veces
CREATE TABLE IF NOT EXISTS push_enviados (
  fecha DATE NOT NULL,
  tipo  VARCHAR(20) NOT NULL,   -- 'mision' | 'cierre'
  PRIMARY KEY (fecha, tipo)
);

-- ── PROYECTOS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proyectos (
  id            SERIAL PRIMARY KEY,
  nombre        VARCHAR(200) NOT NULL,
  objetivo      TEXT,
  progreso      INTEGER DEFAULT 0 CHECK (progreso >= 0 AND progreso <= 100),
  ultima_accion TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── DATOS DE EJEMPLO: RUTINAS ─────────────────────────────────
INSERT INTO rutinas (nombre, descripcion, dias) VALUES
  ('PUSH', 'Pecho · Hombros · Tríceps', '["lunes","miércoles","viernes"]'),
  ('PULL', 'Espalda · Bíceps', '["martes","jueves","sábado"]'),
  ('LEGS', 'Cuádriceps · Isquios · Glúteos', '["miércoles","sábado"]')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO ejercicios (rutina_id, nombre, series, reps_objetivo, orden)
SELECT r.id, e.nombre, e.series::int, e.reps, e.ord::int
FROM rutinas r
CROSS JOIN (VALUES
  ('Press banca plano',        '4','6-10',  '1'),
  ('Press inclinado mancuerna','3','10-12', '2'),
  ('Fondos en paralelas',      '3','8-12',  '3'),
  ('Press militar barra',      '4','6-10',  '4'),
  ('Elevaciones laterales',    '4','12-15', '5'),
  ('Extensión tríceps polea',  '3','12-15', '6')
) AS e(nombre, series, reps, ord)
WHERE r.nombre = 'PUSH'
  AND NOT EXISTS (SELECT 1 FROM ejercicios WHERE rutina_id = r.id);

INSERT INTO ejercicios (rutina_id, nombre, series, reps_objetivo, orden)
SELECT r.id, e.nombre, e.series::int, e.reps, e.ord::int
FROM rutinas r
CROSS JOIN (VALUES
  ('Dominadas',           '4','6-10',  '1'),
  ('Remo con barra',      '4','8-12',  '2'),
  ('Remo en polea baja',  '3','10-12', '3'),
  ('Face pulls',          '3','15-20', '4'),
  ('Curl bíceps barra',   '3','10-12', '5'),
  ('Curl martillo',       '3','12-15', '6')
) AS e(nombre, series, reps, ord)
WHERE r.nombre = 'PULL'
  AND NOT EXISTS (SELECT 1 FROM ejercicios WHERE rutina_id = r.id);

INSERT INTO ejercicios (rutina_id, nombre, series, reps_objetivo, orden)
SELECT r.id, e.nombre, e.series::int, e.reps, e.ord::int
FROM rutinas r
CROSS JOIN (VALUES
  ('Sentadilla libre',   '4','6-10',  '1'),
  ('Prensa de piernas',  '3','10-12', '2'),
  ('Zancadas mancuernas','3','12c/p', '3'),
  ('Curl femoral',       '3','12-15', '4'),
  ('Hip thrust',         '4','10-12', '5'),
  ('Gemelos en máquina', '4','15-20', '6')
) AS e(nombre, series, reps, ord)
WHERE r.nombre = 'LEGS'
  AND NOT EXISTS (SELECT 1 FROM ejercicios WHERE rutina_id = r.id);

SELECT 'Migration OK · ' || NOW() AS status;
