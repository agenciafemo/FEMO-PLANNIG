-- ============================================================================
-- Gravar o resultado da publicacao NA COLUNA DO DESTINO CERTO.
--
-- Bug: meta_server_mark_scheduled_published gravava sempre em
-- instagram_media_id. Com o destino Facebook, o id do post da Pagina ia parar
-- na coluna do Instagram e facebook_post_id (criada em 20260824120000) nunca
-- recebia valor — coluna morta e dado em lugar enganoso.
--
-- A propria linha ja sabe o destino dela (coluna `target`), entao NAO e preciso
-- mudar a assinatura: o CASE decide onde gravar. Sem DROP, sem quebrar quem
-- chama.
--
-- De quebra, a notificacao dizia "Publicacao feita no Instagram" mesmo quando o
-- post saia na Pagina.
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.meta_server_mark_scheduled_published(
  _id UUID, _media_id TEXT, _permalink TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sp public.meta_scheduled_posts%ROWTYPE;
  v_planning_id UUID;
  v_client_name TEXT;
  v_rede TEXT;
BEGIN
  UPDATE public.meta_scheduled_posts sp
  SET status = 'published',
      -- Cada id na sua coluna: o destino da linha decide.
      instagram_media_id = CASE WHEN sp.target = 'facebook'
                                THEN sp.instagram_media_id ELSE _media_id END,
      facebook_post_id   = CASE WHEN sp.target = 'facebook'
                                THEN _media_id ELSE sp.facebook_post_id END,
      permalink = _permalink,
      error_code = NULL
  WHERE sp.id = _id
  RETURNING * INTO v_sp;

  IF v_sp.id IS NULL THEN
    RETURN;
  END IF;

  v_rede := CASE WHEN v_sp.target = 'facebook' THEN 'no Facebook' ELSE 'no Instagram' END;

  SELECT p.planning_id INTO v_planning_id FROM public.posts p WHERE p.id = v_sp.post_id;
  SELECT c.name INTO v_client_name FROM public.clients c WHERE c.id = v_sp.client_id;

  -- Best-effort: um erro ao notificar nunca deve desfazer a publicação.
  BEGIN
    INSERT INTO public.notifications (
      user_id, organization_id, type, title, body, planning_id, read
    ) VALUES (
      v_sp.created_by, v_sp.organization_id, 'post_published',
      'Publicação feita ' || v_rede,
      COALESCE(v_client_name, 'Cliente') || ' — um post agendado foi publicado.',
      v_planning_id, false
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.meta_server_mark_scheduled_published(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_server_mark_scheduled_published(UUID, TEXT, TEXT)
  TO service_role;
