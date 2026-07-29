-- ═══════════════════════════════════════════════════════════════
-- OKIRO v10 — Idiomas dentro del sistema, y la web a un toque
--
--   1. `url`: cada proyecto puede apuntar a lo que ya está en marcha.
--      Si tutoringles está operativo, verlo debe ser un toque desde la
--      tarjeta y no acordarse del dominio.
--
--   2. El inglés deja de medirse a ojo. tutoringles vive en el mismo
--      Postgres del droplet y ya guarda el progreso real (palabras con
--      estado new/learning/review/mastered, situaciones y sesiones de
--      estudio), así que OKIRO lo lee y el proyecto avanza al estudiar,
--      igual que Constancia avanza al entrenar.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS url TEXT;
