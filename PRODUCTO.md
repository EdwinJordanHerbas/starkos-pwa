# OkiroSport — Definición de producto

## El concepto en una frase

> **El sistema operativo del atleta híbrido que construye.**
> Una sola app para registrar entreno, nutrición y proyectos en menos de 60 segundos al día, con un coach IA que convierte tus datos en decisiones.

## El problema

El "atleta híbrido emprendedor" (entrena fuerza + cardio Y construye proyectos) hoy usa 4-5 apps desconectadas: una de gym (Strong/Hevy), una de nutrición (MyFitnessPal), Strava, Notion para proyectos y quizá un diario. Ninguna ve el cuadro completo: *¿cómo afecta mi sueño a mi entreno? ¿mi semana floja de nutrición coincide con la semana floja de mis proyectos?*

## La propuesta de valor

1. **Todo en una pantalla** — registro diario en <60 segundos (sueño, energía, entreno, macros, tareas).
2. **IA sin fricción** — foto a la comida → macros. Un botón → análisis del día/semana. Sin configurar nada.
3. **Gamificación con propósito** — rangos D→S, "dungeon cleared", racha semanal: el progreso se *siente*.
4. **Cruce de datos único** — cuerpo + mente + negocio en el mismo historial. Ninguna app grande hace esto.

## Usuario objetivo (ICP)

- 20–40 años, entrena 4-6 días/semana (gym + running)
- Freelance / emprendedor / creador con proyectos propios
- Ya intentó combinar 3+ apps y abandonó por fricción
- Cultura gamer/anime (el tono RPG es feature, no bug)

## Estado actual: v3.0 (producto personal validable)

**Fase actual = single-user.** La app está lista para que TÚ la uses a diario y valides el hábito. Esa es la métrica que importa ahora: *¿la uso yo todos los días durante 30 días?* Si la respuesta es no, ningún SaaS saldrá de aquí; si es sí, tienes el mejor pitch posible: tu propio historial.

## Roadmap hacia SaaS

### Fase 1 — Dogfooding (ahora → 1-2 meses)
- Usarla a diario, apuntar cada fricción
- Ajustar el registro diario hasta que sea <60 s de verdad
- Objetivo: 30 días seguidos de uso propio

### Fase 2 — Beta cerrada (5-15 usuarios)
- **Multi-usuario**: añadir `user_id` a las tablas + login real (email magic-link es lo más simple)
- Onboarding: crear rutinas propias desde la UI (hoy vienen por seed SQL)
- Objetivos de macros por usuario en BD (hoy en localStorage)
- Métricas: retención D7/D30, análisis IA usados/usuario

### Fase 3 — SaaS público
- **Pricing sugerido** (validar en beta):
  - **Gratis**: registro manual + historial + 3 análisis IA/mes
  - **Pro ~5-7 €/mes**: fotos IA ilimitadas*, resúmenes ilimitados*, Strava, exportación
  - (*con límite diario técnico — el coste real por usuario Pro es <0,50 €/mes con Haiku)
- El margen de la IA es enorme: cobras 6 € por algo que te cuesta céntimos
- Stripe + páginas legales (privacidad, términos) + borrado de cuenta (GDPR)

### Diferenciación defendible
- Nadie une **cuerpo + proyectos** con IA barata y tono RPG
- El competidor real no es MyFitnessPal: es *la libreta y el caos*
- Nicho estrecho y apasionado = marketing orgánico (TikTok/IG de "hybrid athlete" + build in public)

## Métricas de éxito por fase

| Fase | Métrica | Umbral para avanzar |
|---|---|---|
| Dogfooding | Días seguidos de uso propio | 30 |
| Beta | Retención D30 de beta testers | >40 % |
| SaaS | Conversión free→pro | >5 % |

## Decisiones técnicas ya tomadas (y por qué)

- **IA en el servidor con Haiku 4.5**: coste ~0,2 cent/análisis → puedes regalar la IA incluso en el plan gratis. El usuario nunca pega una API key (eso mata la conversión).
- **`APP_TOKEN` mono-usuario ahora, login después**: no construir auth multi-usuario antes de validar el hábito.
- **Sin framework**: JS vanilla carga instantáneo en móvil y no hay build que mantener. Si el producto crece, migrar a algo con componentes será una decisión de Fase 2/3.
