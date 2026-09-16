-- ============================================================================
-- Pedido de correção do cliente some da vista da equipe.
--
-- Caso real (15/09, Dr. Pedro Lucyk): o cliente pediu correção explicando "está
-- aparecendo o nome do Nicolas na touca no slide 4". O texto FOI gravado em
-- posts.revision_note, mas:
--   * nenhuma tela mostra revision_note — só o quadro de Produção, e o post
--     não tinha item lá;
--   * o aviso da correção só vai para os responsáveis das etapas de Produção,
--     então sem item ninguém foi avisado;
--   * o cliente também não vê o que mandou, e concluiu que "não salvou".
-- Comentário comum do cliente tampouco avisava alguém.
--
-- Correção:
--   1) Pedir correção também grava um comentário do cliente (texto + motivos),
--      que aparece no portal e no editor da equipe, e avisa a equipe.
--   2) Comentário do cliente avisa a equipe.
--   3) As observações antigas que ficaram escondidas viram comentário.
--
-- Assinaturas mantidas (CREATE OR REPLACE, sem DROP), GRANTs reemitidos.
-- Idempotente.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.post_comments') IS NULL
     OR to_regclass('public.notifications') IS NULL
     OR to_regclass('public.posts') IS NULL THEN
    RAISE EXCEPTION 'Tabelas posts/post_comments/notifications não encontradas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'revision_note'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'post_comments' AND column_name = 'reason_codes'
  ) THEN
    RAISE EXCEPTION 'Faltam migrations anteriores: posts.revision_note ou post_comments.reason_codes';
  END IF;

  IF to_regprocedure('public.public_request_post_revision(text,uuid,text[],text)') IS NULL
     OR to_regprocedure('public.public_insert_post_comment(text,uuid,text,text,text,text[])') IS NULL THEN
    RAISE EXCEPTION 'Funções públicas de comentário/correção não encontradas';
  END IF;
END;
$$;

-- Aviso para a equipe inteira da organização (user_id nulo), no mesmo formato
-- do "link do planejamento acessado". Só o servidor chama.
CREATE OR REPLACE FUNCTION public.portal_notify_team_about_post(
  _post_id UUID,
  _type TEXT,
  _title TEXT,
  _body TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (organization_id, type, title, body, planning_id)
  SELECT po.organization_id,
         _type,
         _title,
         c.name || ': ' || left(COALESCE(NULLIF(btrim(_body), ''), 'sem texto'), 160),
         po.planning_id
  FROM public.posts po
  JOIN public.plannings pl ON pl.id = po.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE po.id = _post_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_request_post_revision(
  _token TEXT,
  _post_id UUID,
  _reasons TEXT[],
  _note TEXT DEFAULT NULL
)
RETURNS public.posts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.posts;
  v_reasons TEXT[] := COALESCE(_reasons, ARRAY[]::TEXT[]);
  v_note TEXT := NULLIF(btrim(COALESCE(_note, '')), '');
BEGIN
  IF cardinality(v_reasons) = 0 AND v_note IS NULL THEN
    RAISE EXCEPTION 'Diga o que precisa corrigir';
  END IF;

  UPDATE public.posts po
  SET status = 'needs_revision',
      revision_reasons = v_reasons,
      revision_note = v_note
  FROM public.plannings pl, public.clients c
  WHERE po.id = _post_id
    AND po.planning_id = pl.id
    AND pl.client_id = c.id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved')
  RETURNING po.* INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Post não encontrado, token inválido ou planejamento não disponível';
  END IF;

  -- Na mesma transação: ou a correção fica visível nos comentários, ou nada
  -- é gravado.
  INSERT INTO public.post_comments (post_id, author_type, author_name, text, reason_codes)
  VALUES (v_row.id, 'client', 'Cliente', COALESCE(v_note, 'Pediu correção.'), NULLIF(v_reasons, '{}'));

  PERFORM public.portal_notify_team_about_post(
    v_row.id, 'client_revision', '↩️ Cliente pediu correção',
    COALESCE(v_note, 'sem explicação escrita')
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_insert_post_comment(
  _token TEXT,
  _post_id UUID,
  _author_name TEXT,
  _text TEXT,
  _audio_url TEXT DEFAULT NULL,
  _reason_codes TEXT[] DEFAULT NULL
)
RETURNS public.post_comments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_valid BOOLEAN;
  v_row public.post_comments;
BEGIN
  IF NULLIF(btrim(COALESCE(_text, '')), '') IS NULL
     AND NULLIF(btrim(COALESCE(_audio_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Comentário vazio';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.posts po
    JOIN public.plannings pl ON pl.id = po.planning_id
    JOIN public.clients c ON c.id = pl.client_id
    WHERE po.id = _post_id
      AND c.public_link_token::text = _token
      AND c.public_link_revoked = false
      AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
      AND pl.status IN ('client_review', 'approved')
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Post não encontrado, token inválido ou planejamento não disponível';
  END IF;

  INSERT INTO public.post_comments
    (post_id, author_type, author_name, text, audio_url, reason_codes)
  VALUES
    (_post_id, 'client', COALESCE(NULLIF(_author_name, ''), 'Cliente'), _text,
     _audio_url, NULLIF(_reason_codes, '{}'))
  RETURNING * INTO v_row;

  PERFORM public.portal_notify_team_about_post(
    _post_id, 'client_comment', '💬 Cliente comentou um post',
    COALESCE(NULLIF(btrim(COALESCE(_text, '')), ''), 'Enviou um áudio')
  );

  RETURN v_row;
END;
$$;

-- Observações que ficaram escondidas viram comentário (sem aviso: são antigas).
INSERT INTO public.post_comments (post_id, author_type, author_name, text, reason_codes, created_at)
SELECT p.id, 'client', 'Cliente', btrim(p.revision_note),
       NULLIF(p.revision_reasons, '{}'), COALESCE(p.updated_at, now())
FROM public.posts p
WHERE NULLIF(btrim(COALESCE(p.revision_note, '')), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.post_comments pc
    WHERE pc.post_id = p.id
      AND pc.author_type = 'client'
      AND btrim(COALESCE(pc.text, '')) = btrim(p.revision_note)
  );

REVOKE ALL ON FUNCTION public.portal_notify_team_about_post(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_request_post_revision(TEXT, UUID, TEXT[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_insert_post_comment(TEXT, UUID, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.public_request_post_revision(TEXT, UUID, TEXT[], TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_insert_post_comment(TEXT, UUID, TEXT, TEXT, TEXT, TEXT[]) TO anon, authenticated;

COMMIT;

-- Conferência: 6 linhas, todas ok = true.
SELECT 'cliente pode pedir correção' AS item,
       has_function_privilege('anon', 'public.public_request_post_revision(text,uuid,text[],text)', 'EXECUTE') AS ok
UNION ALL
SELECT 'cliente pode comentar',
       has_function_privilege('anon', 'public.public_insert_post_comment(text,uuid,text,text,text,text[])', 'EXECUTE')
UNION ALL
SELECT 'aviso interno fechado para anon',
       NOT has_function_privilege('anon', 'public.portal_notify_team_about_post(uuid,text,text,text)', 'EXECUTE')
UNION ALL
SELECT 'aviso interno fechado para logados',
       NOT has_function_privilege('authenticated', 'public.portal_notify_team_about_post(uuid,text,text,text)', 'EXECUTE')
UNION ALL
SELECT 'correção grava comentário',
       pg_get_functiondef('public.public_request_post_revision(text,uuid,text[],text)'::regprocedure)
         ILIKE '%INSERT INTO public.post_comments%'
UNION ALL
SELECT 'nenhuma observação escondida',
       NOT EXISTS (
         SELECT 1 FROM public.posts p
         WHERE NULLIF(btrim(COALESCE(p.revision_note, '')), '') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM public.post_comments pc
             WHERE pc.post_id = p.id
               AND pc.author_type = 'client'
               AND btrim(COALESCE(pc.text, '')) = btrim(p.revision_note)
           )
       );
