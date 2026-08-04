-- ═══════════════════════════════════════════════════════════════
-- OKIRO v14 — La técnica, enseñada por una persona
--
-- La animación 3D dice el recorrido, pero no dice dónde apoyas el
-- pie ni cuándo respiras. Ahora cada ejercicio puede llevar además
-- un vídeo real de alguien haciéndolo, en Full HD.
--
-- Salen de free-exercise-db-with-videos (licencia MIT, 317
-- ejercicios, 593 clips grabados con modelo masculino y femenino):
--   https://github.com/arhxam/free-exercise-db-with-videos
--
-- POR QUÉ EL MAPEO ES A MANO Y NO POR ID. Ese catálogo también usa
-- ids de cuatro dígitos, y es una trampa: de los 238 que cruzan con
-- los nuestros, solo 161 son el mismo ejercicio. El id 0976 es
-- "band concentration curl" aquí y "Band Prone Leg Curl" allí.
-- Emparejar por id enseñaría el ejercicio equivocado una de cada
-- tres veces, y en una app de técnica eso es peor que no enseñar
-- nada. Sus `aliases` fallan igual. Así que cada línea de abajo
-- está revisada una por una.
--
-- video_slug guarda la ruta relativa ("male/barbell-bench-press")
-- porque no todos los ejercicios tienen las dos versiones: de los
-- 317, hay 290 con modelo masculino y 303 con femenino.
--
-- video_aprox marca los cuatro que NO son exactamente el mismo
-- movimiento sino la variante más cercana que hay filmada. La app
-- lo dice en pantalla: preferimos avisar a que parezca que tu
-- ejercicio se hace de otra manera.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ejercicios ADD COLUMN IF NOT EXISTS video_slug  VARCHAR(160);
ALTER TABLE ejercicios ADD COLUMN IF NOT EXISTS video_aprox BOOLEAN DEFAULT false;

-- Mapeo revisado a mano (= mismo ejercicio · ~ variante más cercana)
UPDATE ejercicios SET video_slug='male/classic-barbell-squat', video_aprox=false WHERE dataset_id='0043';   -- Sentadilla libre -> Barbell Back Squat
UPDATE ejercicios SET video_slug='male/sled-45-degree-leg-wide-press', video_aprox=true WHERE dataset_id='0739';   -- Prensa de piernas -> Sled 45 Degree Wide Leg Press
UPDATE ejercicios SET video_slug='male/dumbbell-lunge', video_aprox=false WHERE dataset_id='0336';   -- Zancadas mancuernas -> Dumbbell Lunge
UPDATE ejercicios SET video_slug='male/lever-lying-leg-curl', video_aprox=false WHERE dataset_id='0586';   -- Curl femoral -> Lever Lying Leg Curl
UPDATE ejercicios SET video_slug='female/hip-raise-bridge', video_aprox=true WHERE dataset_id='1409';   -- Hip thrust -> Glute Bridge
UPDATE ejercicios SET video_slug='male/lever-standing-calf-raise', video_aprox=false WHERE dataset_id='0605';   -- Gemelos en máquina -> Lever Standing Calf Raise
UPDATE ejercicios SET video_slug='male/chin-ups-pull-ups', video_aprox=false WHERE dataset_id='0652';   -- Dominadas -> Pull-Up / Chin-Up
UPDATE ejercicios SET video_slug='male/barbell-underhand-bent-over-row', video_aprox=true WHERE dataset_id='0027';   -- Remo con barra -> Barbell Underhand Bent-Over Row
UPDATE ejercicios SET video_slug='male/cable-straight-back-seated-row-v-grip', video_aprox=false WHERE dataset_id='0180';   -- Remo en polea baja -> Seated Cable Row (V-Grip)
UPDATE ejercicios SET video_slug='male/cable-rear-delt-row-with-rope', video_aprox=false WHERE dataset_id='0203';   -- Face pulls -> Cable Rear Delt Row (with rope)
UPDATE ejercicios SET video_slug='male/barbell-curl', video_aprox=false WHERE dataset_id='0031';   -- Curl bíceps barra -> Barbell Curl
UPDATE ejercicios SET video_slug='male/dumbbell-cross-body-hammer-curl', video_aprox=true WHERE dataset_id='0313';   -- Curl martillo -> Dumbbell Cross Body Hammer Curl
UPDATE ejercicios SET video_slug='male/barbell-bench-press', video_aprox=false WHERE dataset_id='0025';   -- Press banca plano -> Barbell Bench Press
UPDATE ejercicios SET video_slug='male/dumbbell-incline-bench-press', video_aprox=false WHERE dataset_id='0314';   -- Press inclinado mancuerna -> Dumbbell Incline Bench Press
UPDATE ejercicios SET video_slug='male/chest-dips', video_aprox=false WHERE dataset_id='0251';   -- Fondos en paralelas -> Chest Dips
UPDATE ejercicios SET video_slug='male/military-press', video_aprox=false WHERE dataset_id='0091';   -- Press militar barra -> Military Press
UPDATE ejercicios SET video_slug='male/dumbbell-lateral-raise', video_aprox=false WHERE dataset_id='0334';   -- Elevaciones laterales -> Dumbbell Lateral Raise
UPDATE ejercicios SET video_slug='male/cable-triceps-pushdown', video_aprox=false WHERE dataset_id='0201';   -- Extensión tríceps polea -> Cable Triceps Pushdown
-- Comprobación: debería devolver 18 filas con vídeo
-- SELECT nombre, video_slug, video_aprox FROM ejercicios WHERE video_slug IS NOT NULL;
