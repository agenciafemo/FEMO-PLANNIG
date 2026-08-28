-- O portal do cliente só pode enxergar planejamentos que já foram enviados
-- para aprovação ou que já foram aprovados. As RPCs públicas usam
-- SECURITY DEFINER e, portanto, precisam aplicar esta regra explicitamente em
-- cada caminho de leitura/escrita.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_plannings(_token TEXT)
RETURNS SETOF public.plannings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pl.*
  FROM public.plannings pl
  JOIN public.clients c ON c.id = pl.client_id
  WHERE c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved')
$$;

CREATE OR REPLACE FUNCTION public.get_public_posts(_token TEXT, _planning_id UUID)
RETURNS SETOF public.posts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT po.*
  FROM public.posts po
  JOIN public.plannings pl ON pl.id = po.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE pl.id = _planning_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved')
$$;

CREATE OR REPLACE FUNCTION public.get_public_video_scripts(_token TEXT, _planning_id UUID)
RETURNS SETOF public.video_scripts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vs.*
  FROM public.video_scripts vs
  JOIN public.plannings pl ON pl.id = vs.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE pl.id = _planning_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved')
$$;

CREATE OR REPLACE FUNCTION public.get_public_all_video_scripts(_token TEXT)
RETURNS SETOF public.video_scripts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vs.*
  FROM public.video_scripts vs
  JOIN public.plannings pl ON pl.id = vs.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved')
  ORDER BY vs.planning_id, vs.position, vs.created_at
$$;

CREATE OR REPLACE FUNCTION public.get_public_post(_token TEXT, _post_id UUID)
RETURNS SETOF public.posts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT po.*
  FROM public.posts po
  JOIN public.plannings pl ON pl.id = po.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE po.id = _post_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved')
$$;

CREATE OR REPLACE FUNCTION public.get_public_post_suggestions(_token TEXT, _post_id UUID)
RETURNS SETOF public.post_edit_suggestions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pes.*
  FROM public.post_edit_suggestions pes
  JOIN public.posts po ON po.id = pes.post_id
  JOIN public.plannings pl ON pl.id = po.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE pes.post_id = _post_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved')
$$;

CREATE OR REPLACE FUNCTION public.get_public_post_comments(_token TEXT, _post_id UUID)
RETURNS SETOF public.post_comments
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pc.*
  FROM public.post_comments pc
  JOIN public.posts po ON po.id = pc.post_id
  JOIN public.plannings pl ON pl.id = po.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE pc.post_id = _post_id
    AND pc.deleted_at IS NULL
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved')
$$;

CREATE OR REPLACE FUNCTION public.get_public_video_script_suggestions(_token TEXT, _script_id UUID)
RETURNS SETOF public.video_script_suggestions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vss.*
  FROM public.video_script_suggestions vss
  JOIN public.video_scripts vs ON vs.id = vss.video_script_id
  JOIN public.plannings pl ON pl.id = vs.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE vss.video_script_id = _script_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved')
  ORDER BY vss.created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.public_update_post_status(
  _token TEXT,
  _post_id UUID,
  _new_status TEXT
)
RETURNS public.posts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.posts;
BEGIN
  IF _new_status NOT IN ('approved', 'needs_revision', 'pending') THEN
    RAISE EXCEPTION 'Status não permitido pelo portal público';
  END IF;

  UPDATE public.posts po
  SET status = _new_status
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

  RETURN v_row;
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
    AND pl.status IN ('client_review', 'approved')
  RETURNING po.* INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Post não encontrado, token inválido ou planejamento não disponível';
  END IF;

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

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_update_post_comment(
  _token TEXT,
  _comment_id UUID,
  _text TEXT
)
RETURNS public.post_comments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.post_comments;
BEGIN
  UPDATE public.post_comments pc
  SET text = _text
  FROM public.posts po, public.plannings pl, public.clients c
  WHERE pc.id = _comment_id
    AND pc.author_type = 'client'
    AND pc.deleted_at IS NULL
    AND pc.post_id = po.id
    AND po.planning_id = pl.id
    AND pl.client_id = c.id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved')
  RETURNING pc.* INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Comentário não encontrado, token inválido ou planejamento não disponível';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_delete_post_comment(_token TEXT, _comment_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated UUID;
BEGIN
  UPDATE public.post_comments pc
  SET deleted_at = now()
  FROM public.posts po, public.plannings pl, public.clients c
  WHERE pc.id = _comment_id
    AND pc.author_type = 'client'
    AND pc.deleted_at IS NULL
    AND pc.post_id = po.id
    AND po.planning_id = pl.id
    AND pl.client_id = c.id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved')
  RETURNING pc.id INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'Comentário não encontrado, token inválido ou planejamento não disponível';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_insert_edit_suggestion(
  _token TEXT,
  _post_id UUID,
  _field_name TEXT,
  _original_value TEXT,
  _suggested_value TEXT
)
RETURNS public.post_edit_suggestions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_valid BOOLEAN;
  v_row public.post_edit_suggestions;
BEGIN
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

  INSERT INTO public.post_edit_suggestions
    (post_id, field_name, original_value, suggested_value)
  VALUES (_post_id, _field_name, _original_value, _suggested_value)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_insert_video_script_suggestion(
  _token TEXT,
  _script_id UUID,
  _field_name TEXT,
  _original_value TEXT,
  _suggested_value TEXT,
  _author_name TEXT DEFAULT NULL
)
RETURNS public.video_script_suggestions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ok BOOLEAN;
  v_row public.video_script_suggestions;
BEGIN
  IF _field_name NOT IN ('title', 'spoken_text', 'references_notes', 'editing_instructions') THEN
    RAISE EXCEPTION 'Campo de roteiro inválido';
  END IF;

  IF COALESCE(btrim(_suggested_value), '') = '' THEN
    RAISE EXCEPTION 'Sugestão vazia';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.video_scripts vs
    JOIN public.plannings pl ON pl.id = vs.planning_id
    JOIN public.clients c ON c.id = pl.client_id
    WHERE vs.id = _script_id
      AND c.public_link_token::text = _token
      AND c.public_link_revoked = false
      AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
      AND pl.status IN ('client_review', 'approved')
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Roteiro não encontrado, token inválido ou planejamento não disponível';
  END IF;

  INSERT INTO public.video_script_suggestions
    (video_script_id, field_name, original_value, suggested_value, created_by_name)
  VALUES
    (_script_id, _field_name, _original_value, _suggested_value, NULLIF(_author_name, ''))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_notify_planning_viewed(_token TEXT, _planning_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_client_name TEXT;
BEGIN
  SELECT pl.organization_id, c.name
  INTO v_org_id, v_client_name
  FROM public.plannings pl
  JOIN public.clients c ON c.id = pl.client_id
  WHERE pl.id = _planning_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status IN ('client_review', 'approved');

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Token inválido ou planejamento não disponível';
  END IF;

  INSERT INTO public.notifications (organization_id, type, title, body, planning_id)
  VALUES (v_org_id, 'planning_viewed', 'Cliente abriu o planejamento', v_client_name, _planning_id);
END;
$$;

-- Reforça os privilégios das assinaturas públicas recriadas acima. Isso não
-- amplia acesso: cada função valida token, expiração e status do planejamento.
REVOKE ALL ON FUNCTION public.get_public_plannings(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_posts(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_video_scripts(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_all_video_scripts(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_post(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_post_suggestions(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_post_comments(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_video_script_suggestions(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_update_post_status(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_request_post_revision(TEXT, UUID, TEXT[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_insert_post_comment(TEXT, UUID, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_update_post_comment(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_delete_post_comment(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_insert_edit_suggestion(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_insert_video_script_suggestion(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_notify_planning_viewed(TEXT, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_plannings(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_posts(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_video_scripts(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_all_video_scripts(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_post(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_post_suggestions(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_post_comments(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_video_script_suggestions(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_update_post_status(TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_request_post_revision(TEXT, UUID, TEXT[], TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_insert_post_comment(TEXT, UUID, TEXT, TEXT, TEXT, TEXT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_update_post_comment(TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_delete_post_comment(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_insert_edit_suggestion(TEXT, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_insert_video_script_suggestion(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_notify_planning_viewed(TEXT, UUID) TO anon, authenticated;

COMMIT;
