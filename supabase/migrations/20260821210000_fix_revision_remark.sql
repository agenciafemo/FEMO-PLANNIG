-- ============================================================================
-- Última ponta do conflito entre gatilhos.
--
-- O gatilho de correção desmarcava a etapa culpada (ex.: Legenda) e, logo em
-- seguida, o gatilho geral via que o post TEM legenda escrita e marcava de
-- novo — sem saber que aquele texto é exatamente o que o cliente reprovou.
--
-- Agora, enquanto o post está em correção, o gatilho geral só marca o que
-- REALMENTE mudou naquela gravação. Assim:
--   • pedido de correção        → nada muda, a etapa fica em aberto;
--   • equipe corrige a legenda  → a etapa marca sozinha de novo.
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
  v_novo    BOOLEAN := (TG_OP = 'INSERT');
BEGIN
  SELECT id INTO v_item_id FROM public.production_items WHERE post_id = NEW.id LIMIT 1;
  IF v_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_media   := (COALESCE(btrim(NEW.cover_image_url), '') <> '')
               OR (COALESCE(NEW.media_urls::text, '') NOT IN ('', '[]', '{}', 'null'));
  v_video   := COALESCE(btrim(NEW.video_url), '') <> '';
  v_caption := COALESCE(btrim(NEW.caption), '') <> '';
  v_texto   := COALESCE(btrim(NEW.blog_body), '') <> '';
  v_any     := v_media OR v_video OR v_caption OR v_texto;

  -- Em correção: só conta o que mudou AGORA (o conteúdo antigo é o reprovado).
  IF NEW.status = 'needs_revision' THEN
    v_media   := v_media   AND (v_novo OR NEW.cover_image_url IS DISTINCT FROM OLD.cover_image_url
                                       OR NEW.media_urls      IS DISTINCT FROM OLD.media_urls);
    v_video   := v_video   AND (v_novo OR NEW.video_url       IS DISTINCT FROM OLD.video_url);
    v_caption := v_caption AND (v_novo OR NEW.caption         IS DISTINCT FROM OLD.caption);
    v_texto   := v_texto   AND (v_novo OR NEW.blog_body       IS DISTINCT FROM OLD.blog_body);
    v_any     := false;
  END IF;

  UPDATE public.production_item_steps s
  SET done = true, done_at = COALESCE(s.done_at, now())
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

  IF NEW.status = 'approved' THEN
    UPDATE public.production_item_steps s
    SET done = true, outcome = 'aprovado', done_at = COALESCE(s.done_at, now()),
        reason_codes = NULL, reason_note = NULL
    WHERE s.item_id = v_item_id AND s.step_key = 'aprov_cliente';
  ELSIF NEW.status <> 'needs_revision' THEN
    UPDATE public.production_item_steps s
    SET done = false, outcome = NULL, done_at = NULL,
        reason_codes = NULL, reason_note = NULL
    WHERE s.item_id = v_item_id AND s.step_key = 'aprov_cliente';
  END IF;

  RETURN NEW;
END;
$$;

-- Reabre agora as etapas apontadas nas correções que estão em aberto.
WITH mapa(code, keys) AS (
  VALUES
    ('legenda_video', ARRAY['legenda_capa', 'legenda']),
    ('legenda_post',  ARRAY['legenda', 'legenda_capa']),
    ('design',        ARRAY['design', 'legenda_capa']),
    ('portugues',     ARRAY['copy', 'legenda', 'legenda_capa', 'texto']),
    ('edicao',        ARRAY['edicao'])
),
alvo AS (
  SELECT DISTINCT i.id AS item_id, k AS step_key
  FROM public.posts p
  JOIN public.production_items i ON i.post_id = p.id
  CROSS JOIN LATERAL unnest(COALESCE(p.revision_reasons, ARRAY[]::TEXT[])) AS r
  JOIN mapa ON mapa.code = r
  CROSS JOIN LATERAL unnest(mapa.keys) AS k
  WHERE p.status = 'needs_revision'
)
UPDATE public.production_item_steps s
SET done = false, done_at = NULL
FROM alvo
WHERE s.item_id = alvo.item_id
  AND s.step_key = alvo.step_key
  AND s.done = true;
