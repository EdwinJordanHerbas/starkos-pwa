-- ═══════════════════════════════════════════════════════════════════
-- v16 — El castigo por no entrar se borra, y el panel entra (17-ago-2026)
-- ═══════════════════════════════════════════════════════════════════
--
-- QUÉ PASÓ
-- Al mirar la base el 17-ago-2026: 20 misiones generadas, 19 en estado
-- 'ofrecida' —o sea, nunca abiertas— y todas selladas como 'fallada'. Progreso:
-- XP 0, rango E, racha 0, mejor racha 1, **19 penalizaciones**. El cierre
-- nocturno marcaba fallada toda misión que no estuviera completa, sin mirar si
-- se había llegado a abrir, así que el sistema restaba 25 XP por cada día que
-- no entrabas. Abrir la app costaba ver la cuenta de lo que llevabas perdido.
--
-- Un sistema que castiga por no entrar garantiza que no entres.
--
-- QUÉ CAMBIA (el criterio nuevo vive en cierreDeMision() de server.js)
--   · 'ofrecida' y sin abrir  → 'expirada', 0 XP. No es un fallo: es un día en
--     que no estuviste. Tampoco dispara la misión de recuperación del día
--     siguiente, que era la segunda vuelta de tuerca.
--   · aceptada y no cumplida  → 'fallada', −25 XP. Sigue costando.
--   · rechazada               → 'fallada', −25 XP. Decir que no es decidir.
--
-- La exigencia se queda donde él la quería: sobre lo que decides, no sobre el
-- olvido. Esta migración reescribe el histórico con ese mismo criterio; el XP
-- y el rango no hay que tocarlos, los recalcula calcularProgreso() a partir de
-- los xp_bonus en cuanto se abre /progreso.
--
-- Idempotente: se puede aplicar dos veces sin cambiar nada la segunda.

-- 1. Las misiones que nunca se abrieron dejan de contar como fallos.
UPDATE misiones
   SET resultado = 'expirada',
       xp_bonus  = 0
 WHERE estado    = 'ofrecida'
   AND resultado = 'fallada';

-- 2. Línea de salida. Con lo anterior, las penalizaciones bajan de 19 a 6: las
--    13 que nunca se abrieron dejan de contar, pero quedan 6 que sí aceptó y no
--    cumplió. Esas fueron decisiones de verdad, así que no se disfrazan de
--    expiradas ni de cumplidas: se marcan 'perdonada', que es lo que son. La
--    historia queda escrita, el coste no se arrastra.
--
--    Es un corte de una sola vez, con fecha: solo alcanza a lo anterior al
--    17-ago-2026. A partir de ahí la regla nueva es la que manda, y fallar una
--    misión aceptada vuelve a costar 25 XP. El borrón es el arranque, no una
--    puerta de salida permanente.
UPDATE misiones
   SET resultado = 'perdonada',
       xp_bonus  = 0
 WHERE resultado = 'fallada'
   AND fecha     < DATE '2026-08-17';

-- 3. El contador de penalizaciones se recalcula desde la verdad nueva. Se hace
--    aquí además de en el backend para que el número sea correcto ya en la
--    primera pantalla, sin esperar a que algo llame a /progreso.
UPDATE progreso p
   SET penalizaciones = (SELECT count(*) FROM misiones m
                          WHERE m.usuario_id = p.usuario_id AND m.resultado = 'fallada'),
       actualizado    = NOW()
 WHERE p.usuario_id = 1;

-- 4. La mejor racha se conserva a propósito. Es lo único del progreso que mira
--    hacia arriba ("ya lo hiciste una vez") y borrarla sería quitarle la única
--    prueba de que el sistema alguna vez funcionó. Hoy vale 1, y ese 1 es real.

-- 5. NeumorStudio deja de contarse a mano. Decía "1 cliente de 5" desde el
--    28-jul mientras el panel tenía ya dos proyectos vivos cobrando (Derwint en
--    mantenimiento y González-Regalado en marcha) más una propuesta. Con la
--    fuente `ns_clientes` el número sale del panel y sube solo al firmar: un
--    contador que hay que acordarse de subir es un contador que se queda viejo.
--    Una propuesta no cuenta como cliente — inflar ese número engaña justo en
--    lo que más importa.
UPDATE proyectos
   SET fuente = 'ns_clientes'
 WHERE id = 1
   AND nombre = 'NeumorStudio'
   AND fuente = 'manual';

-- Los tres hijos (Salonio, Cafetería Tina, TinaFusión web) se quedan como
-- están, a mano. No se tocan a propósito: son de otra etapa y ya no coinciden
-- con los proyectos que corren en el panel, pero archivarlos o rehacerlos es
-- decisión suya, no de una migración.

-- ── Comprobación (no cambia nada, solo deja el resultado en el log) ──
DO $$
DECLARE
  falladas   int;
  expiradas  int;
  perdonadas int;
  cumplidas  int;
BEGIN
  SELECT count(*) FILTER (WHERE resultado = 'fallada'),
         count(*) FILTER (WHERE resultado = 'expirada'),
         count(*) FILTER (WHERE resultado = 'perdonada'),
         count(*) FILTER (WHERE resultado = 'cumplida')
    INTO falladas, expiradas, perdonadas, cumplidas
    FROM misiones;
  RAISE NOTICE 'v16 · misiones: % falladas · % expiradas · % perdonadas · % cumplidas',
    falladas, expiradas, perdonadas, cumplidas;
END $$;
