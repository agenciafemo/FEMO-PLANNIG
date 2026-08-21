-- ============================================================================
-- Correção pedida pelo cliente → volta para o quadro de produção.
--
-- O cliente passa a dizer ONDE está o erro (legenda do vídeo, legenda do post,
-- design, português, edição). Isso:
--   • fica gravado no post;
--   • marca a "Aprovação do cliente" da peça como reprovada, com o motivo;
--   • DESMARCA a etapa responsável, devolvendo o trabalho;
--   • notifica quem precisa refazer.
-- Idempotente.
-- ============================================================================

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS revision_reasons TEXT[],
  ADD COLUMN IF NOT EXISTS revision_note TEXT;

-- ---------------------------------------------------------------------------
-- RPC do portal: o cliente pede correção informando os motivos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_request_post_revision(
  _token TEXT,
  _post_id UUID,
  _reasons TEXT[],
  _note TEXT DEFAULT NULL
)
RETURNS public.posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.posts;
BEGIN
  UPDATE public.posts po
  SET status = 'needs_revision',
      revision_reasons = COALESCE(_reasons, ARRAY[]::TEXT[]),
      revision_note = NULLIF(btrim(COALESCE(_note, '')), '')
  FROM public.plannings pl, public.clients c
  WHERE po.id = _post_id
    AND po.planning_id = pl.id
    AND pl.client_id = c.id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
  RETURNING po.* INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Post não encontrado ou token inválido';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.public_request_post_revision(TEXT, UUID, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_request_post_revision(TEXT, UUID, TEXT[], TEXT)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gatilho: pedido de correção do cliente devolve o trabalho no quadro.
-- ---------------------------------------------------------------------------
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

  -- Aprovação do cliente passa a constar como reprovada, com o motivo dele.
  UPDATE public.production_item_steps
  SET done = false,
      outcome = 'reprovado',
      reason_codes = NEW.revision_reasons,
      reason_note = NEW.revision_note,
      done_at = NULL
  WHERE item_id = v_item.id AND step_key = 'aprov_cliente';

  -- Quais etapas voltam a ficar em aberto, conforme o que o cliente apontou.
  WITH mapa(code, keys) AS (
    VALUES
      ('legenda_video', ARRAY['legenda_capa']),
      ('legenda_post',  ARRAY['legenda']),
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
  WHERE item_id = v_item.id
    AND step_key = ANY(v_keys)
    AND done = true;

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

DROP TRIGGER IF EXISTS sync_production_revision ON public.posts;
CREATE TRIGGER sync_production_revision
  AFTER UPDATE OF status, revision_reasons ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.sync_production_revision_from_post();
