-- ============================================================================
-- Integração Produção ↔ Planejamento (parte 1).
--
-- A social mídia continua trabalhando NO PLANEJAMENTO (onde já está o editor
-- completo) e o quadro de produção passa a se marcar sozinho:
--   • cada peça de produção aponta para o post do planejamento (post_id);
--   • um gatilho no post marca as etapas conforme o conteúdo aparece;
--   • a "Aprovação do cliente" segue o portal do cliente, que é a fonte da
--     verdade (lá o cliente já aprova hoje).
--
-- O gatilho só MARCA — nunca desmarca — para não apagar o que a equipe
-- registrou à mão. A única exceção é a aprovação do cliente, que acompanha o
-- portal nos dois sentidos.
-- Idempotente.
-- ============================================================================

ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS production_items_post_idx
  ON public.production_items (post_id);

-- ---------------------------------------------------------------------------
-- Vincula as peças que já existem: dentro do mesmo planejamento e tipo, a
-- enésima peça corresponde ao enésimo post.
-- ---------------------------------------------------------------------------
WITH ranked_posts AS (
  SELECT id, planning_id, content_type,
         row_number() OVER (PARTITION BY planning_id, content_type
                            ORDER BY position, created_at) AS rn
  FROM public.posts
),
ranked_items AS (
  SELECT id, planning_id, content_type,
         row_number() OVER (PARTITION BY planning_id, content_type
                            ORDER BY piece_number, position) AS rn
  FROM public.production_items
  WHERE planning_id IS NOT NULL AND post_id IS NULL
)
UPDATE public.production_items i
SET post_id = rp.id
FROM ranked_items ri
JOIN ranked_posts rp
  ON rp.planning_id  = ri.planning_id
 AND rp.content_type = ri.content_type
 AND rp.rn           = ri.rn
WHERE i.id = ri.id;

-- ---------------------------------------------------------------------------
-- Gatilho: o conteúdo do post marca as etapas da peça
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_production_steps_from_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id UUID;
  v_media   BOOLEAN;
  v_video   BOOLEAN;
  v_caption BOOLEAN;
  v_any     BOOLEAN;
BEGIN
  SELECT id INTO v_item_id
  FROM public.production_items
  WHERE post_id = NEW.id
  LIMIT 1;

  IF v_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_media   := (COALESCE(btrim(NEW.cover_image_url), '') <> '')
               OR (COALESCE(array_length(NEW.media_urls, 1), 0) > 0);
  v_video   := COALESCE(btrim(NEW.video_url), '') <> '';
  v_caption := COALESCE(btrim(NEW.caption), '') <> '';
  v_any     := v_media OR v_video OR v_caption;

  -- Só marca o que ainda não está marcado.
  UPDATE public.production_item_steps s
  SET done = true,
      done_at = COALESCE(s.done_at, now())
  WHERE s.item_id = v_item_id
    AND s.done = false
    AND (
         (s.step_key = 'design'                          AND v_media)
      OR (s.step_key = 'edicao'                          AND v_video)
      OR (s.step_key IN ('legenda', 'legenda_capa')      AND v_caption)
      OR (s.step_key = 'enviar_planejamento'             AND v_any)
      OR (s.step_key = 'revisao'                         AND NEW.status IN ('pending', 'approved'))
    );

  -- Aprovação do cliente acompanha o portal nos dois sentidos.
  UPDATE public.production_item_steps s
  SET done    = (NEW.status = 'approved'),
      outcome = CASE WHEN NEW.status = 'approved' THEN 'aprovado' ELSE NULL END,
      done_at = CASE WHEN NEW.status = 'approved' THEN COALESCE(s.done_at, now()) ELSE NULL END
  WHERE s.item_id = v_item_id
    AND s.step_key = 'aprov_cliente';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_production_steps ON public.posts;
CREATE TRIGGER sync_production_steps
  AFTER INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.sync_production_steps_from_post();

-- ---------------------------------------------------------------------------
-- Sincronização inicial: aplica a regra ao que já está preenchido hoje.
-- ---------------------------------------------------------------------------
UPDATE public.production_item_steps s
SET done = true, done_at = COALESCE(s.done_at, now())
FROM public.production_items i
JOIN public.posts p ON p.id = i.post_id
WHERE s.item_id = i.id
  AND s.done = false
  AND (
       (s.step_key = 'design' AND ((COALESCE(btrim(p.cover_image_url), '') <> '')
                                   OR (COALESCE(array_length(p.media_urls, 1), 0) > 0)))
    OR (s.step_key = 'edicao' AND COALESCE(btrim(p.video_url), '') <> '')
    OR (s.step_key IN ('legenda', 'legenda_capa') AND COALESCE(btrim(p.caption), '') <> '')
    OR (s.step_key = 'enviar_planejamento' AND (
          (COALESCE(btrim(p.cover_image_url), '') <> '')
          OR (COALESCE(array_length(p.media_urls, 1), 0) > 0)
          OR (COALESCE(btrim(p.video_url), '') <> '')
          OR (COALESCE(btrim(p.caption), '') <> '')))
    OR (s.step_key = 'revisao' AND p.status IN ('pending', 'approved'))
  );

UPDATE public.production_item_steps s
SET done    = true,
    outcome = 'aprovado',
    done_at = COALESCE(s.done_at, now())
FROM public.production_items i
JOIN public.posts p ON p.id = i.post_id
WHERE s.item_id = i.id
  AND s.step_key = 'aprov_cliente'
  AND p.status = 'approved'
  AND s.done = false;
