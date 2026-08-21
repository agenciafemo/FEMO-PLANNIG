-- ============================================================================
-- Correção do gatilho: o texto do blog fica em posts.blog_body, que não estava
-- sendo considerado. Sem isso, a etapa "Texto" do blog nunca marcava sozinha.
--
-- Também passa a contar o texto do blog como conteúdo para a etapa
-- "Enviar para o planejamento".
-- Idempotente.
-- ============================================================================

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
  v_texto   BOOLEAN;
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
               OR (COALESCE(NEW.media_urls::text, '') NOT IN ('', '[]', '{}', 'null'));
  v_video   := COALESCE(btrim(NEW.video_url), '') <> '';
  v_caption := COALESCE(btrim(NEW.caption), '') <> '';
  v_texto   := COALESCE(btrim(NEW.blog_body), '') <> '';
  v_any     := v_media OR v_video OR v_caption OR v_texto;

  UPDATE public.production_item_steps s
  SET done = true,
      done_at = COALESCE(s.done_at, now())
  WHERE s.item_id = v_item_id
    AND s.done = false
    AND (
         (s.step_key = 'design'                     AND v_media)
      OR (s.step_key = 'edicao'                     AND v_video)
      OR (s.step_key IN ('legenda', 'legenda_capa') AND v_caption)
      OR (s.step_key = 'texto'                      AND v_texto)
      OR (s.step_key = 'enviar_planejamento'        AND v_any)
      OR (s.step_key = 'revisao'                    AND NEW.status IN ('pending', 'approved'))
    );

  UPDATE public.production_item_steps s
  SET done    = (NEW.status = 'approved'),
      outcome = CASE WHEN NEW.status = 'approved' THEN 'aprovado' ELSE NULL END,
      done_at = CASE WHEN NEW.status = 'approved' THEN COALESCE(s.done_at, now()) ELSE NULL END
  WHERE s.item_id = v_item_id
    AND s.step_key = 'aprov_cliente';

  RETURN NEW;
END;
$$;

-- Aplica ao que já está escrito hoje.
UPDATE public.production_item_steps s
SET done = true, done_at = COALESCE(s.done_at, now())
FROM public.production_items i
JOIN public.posts p ON p.id = i.post_id
WHERE s.item_id = i.id
  AND s.done = false
  AND (
       (s.step_key = 'texto' AND COALESCE(btrim(p.blog_body), '') <> '')
    OR (s.step_key = 'enviar_planejamento' AND COALESCE(btrim(p.blog_body), '') <> '')
  );
