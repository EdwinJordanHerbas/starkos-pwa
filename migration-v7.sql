-- ═══════════════════════════════════════════════════════════════
-- OKIRO v7 — Puente hacia Notion
--
-- OKIRO sigue siendo donde se rellenan los datos; Notion es el
-- escaparate: tablero, timeline y agrupaciones sobre lo mismo.
-- Para actualizar una página en vez de duplicarla en cada envío hay
-- que recordar qué página de Notion corresponde a cada proyecto.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS notion_page_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS proyectos_notion_idx ON proyectos(notion_page_id);
