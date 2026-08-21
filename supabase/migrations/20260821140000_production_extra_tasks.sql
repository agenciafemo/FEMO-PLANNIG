-- ============================================================================
-- Quadro de Produção — tarefas extras e peças avulsas.
--
--   • content_type ganha 'extra' (trabalho que não vem de um planejamento).
--   • production_items.title dá nome à tarefa extra (as peças normais usam
--     tipo + número).
--   • planning_id já era opcional, então uma peça pode existir para qualquer
--     cliente mesmo sem planejamento criado.
--
-- As etapas customizadas ficam em production_item_steps com step_key começando
-- em 'custom_' — não precisa de coluna nova.
-- Idempotente.
-- ============================================================================

ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS title TEXT;

-- Libera 'extra' no tipo de conteúdo.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE public.production_items DROP CONSTRAINT production_items_content_type_check';
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

ALTER TABLE public.production_items
  ADD CONSTRAINT production_items_content_type_check
  CHECK (content_type IN ('static', 'reels', 'carousel', 'story', 'blog', 'extra'));
