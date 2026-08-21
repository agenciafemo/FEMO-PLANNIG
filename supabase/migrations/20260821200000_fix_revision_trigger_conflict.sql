-- ============================================================================
-- Dois problemas na correção pedida pelo cliente:
--
-- 1) CONFLITO ENTRE GATILHOS. Em posts há dois gatilhos: o da correção
--    (sync_production_revision) e o geral (sync_production_steps). Eles disparam
--    em ordem alfabética, então o geral rodava DEPOIS e limpava o outcome que a
--    correção tinha acabado de gravar. Agora o gatilho geral não mexe na
--    aprovação do cliente quando o status é 'needs_revision'.
--
-- 2) MAPA DE MOTIVOS ESTREITO. "Legenda do vídeo" só apontava para a etapa de
--    reels; num post estático a etapa se chama 'legenda' e nada era reaberto.
--    Os motivos de legenda passam a atingir as duas etapas — a que existir.
--
-- Ao final, reaplica para os posts que estão em correção agora.
-- Idempotente.
-- ============================================================================

-- 1) Gatilho geral deixa a aprovação do cliente em paz durante uma correção.
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

  -- Aprovação do cliente:
  --   aprovado       → marca
  --   needs_revision → NÃO mexe (quem cuida é o gatilho da correção)
  --   demais         → volta a ficar pendente
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

-- 2) Mapa de motivos mais abrangente (atinge a etapa que existir no tipo).
CREATE OR REPLACE FUNCTION public.sync_production_revision_from_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item   public.production_items;
  v_keys   TEXT[];
  v_motivo TEXT;
BEGIN
  IF NEW.status <> 'needs_revision' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_item FROM public.production_items WHERE post_id = NEW.id LIMIT 1;
  IF v_item.id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.production_item_steps
  SET done = false, outcome = 'reprovado',
      reason_codes = NEW.revision_reasons,
      reason_note = NEW.revision_note,
      done_at = NULL
  WHERE item_id = v_item.id AND step_key = 'aprov_cliente';

  WITH mapa(code, keys) AS (
    VALUES
      ('legenda_video', ARRAY['legenda_capa', 'legenda']),
      ('legenda_post',  ARRAY['legenda', 'legenda_capa']),
      ('design',        ARRAY['design', 'legenda_capa']),
      ('portugues',     ARRAY['copy', 'legenda', 'legenda_capa', 'texto']),
      ('edicao',        ARRAY['edicao'])
  )
  SELECT array_agg(DISTINCT k)
    INTO v_keys
    FROM unnest(COALESCE(NEW.revision_reasons, ARRAY[]::TEXT[])) AS r
    JOIN mapa ON mapa.code = r
    CROSS JOIN LATERAL unnest(mapa.keys) AS k;

  IF v_keys IS NULL OR array_length(v_keys, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.production_item_steps
  SET done = false, done_at = NULL
  WHERE item_id = v_item.id AND step_key = ANY(v_keys) AND done = true;

  v_motivo := COALESCE(NEW.revision_note, array_to_string(NEW.revision_reasons, ', '));

  INSERT INTO public.notifications (organization_id, user_id, title, body, type, read)
  SELECT v_item.organization_id, s.assignee_id,
         '↩️ Cliente pediu correção: ' || s.label,
         COALESCE(v_motivo, 'Sem detalhes'),
         'client_revision', false
  FROM public.production_item_steps s
  WHERE s.item_id = v_item.id
    AND s.step_key = ANY(v_keys)
    AND s.assignee_id IS NOT NULL;

  RETURN NEW;
END;
$$;

-- 3) Reaplica para as correções que já foram pedidas.
UPDATE public.posts SET status = status WHERE status = 'needs_revision';
