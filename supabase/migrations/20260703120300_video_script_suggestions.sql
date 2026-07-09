-- ============================================================================
-- COMPANHEIRA DO PORTAL PÚBLICO — SUGESTÃO DE ROTEIRO (video_script_suggestions)
--
-- O cliente NÃO edita o roteiro diretamente no portal público. Em vez disso,
-- envia uma SUGESTÃO de correção (campo + valor sugerido), que a agência
-- revisa e aplica depois. Isso evita sobrescrever roteiro sem controle e
-- mantém histórico do que o cliente pediu.
--
-- Aditiva e não destrutiva. Depende da Migration 1 (organizations,
-- is_org_member, can_edit_org_content, clients.public_link_*). Independe da
-- Migration 3, mas é aplicada JUNTO com ela no staging para o teste integrado
-- do portal reescrito para RPCs.
--
-- Rode em UMA transação. NÃO aplicar em produção. NÃO aplicar no staging até
-- o plano de aplicação ser autorizado.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABELA
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_script_suggestions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_script_id  UUID NOT NULL REFERENCES public.video_scripts(id) ON DELETE CASCADE,
  planning_id      UUID REFERENCES public.plannings(id) ON DELETE CASCADE,
  organization_id  UUID REFERENCES public.organizations(id),
  field_name       TEXT NOT NULL
                     CHECK (field_name IN ('title','spoken_text','references_notes','editing_instructions')),
  original_value   TEXT,
  suggested_value  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','rejected')),
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at      TIMESTAMPTZ
);

CREATE INDEX vss_script_idx     ON public.video_script_suggestions (video_script_id);
CREATE INDEX vss_org_status_idx ON public.video_script_suggestions (organization_id, status);

-- ---------------------------------------------------------------------------
-- TRIGGER DE ESCOPO — deriva planning_id/organization_id do roteiro pai,
-- espelhando o padrão dos triggers de sincronização da Migration 1. Garante
-- consistência mesmo que o insert não informe esses campos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_vss_scope()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT vs.planning_id, vs.organization_id
    INTO NEW.planning_id, NEW.organization_id
  FROM public.video_scripts vs
  WHERE vs.id = NEW.video_script_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_vss_scope
BEFORE INSERT ON public.video_script_suggestions
FOR EACH ROW EXECUTE FUNCTION public.sync_vss_scope();

-- ---------------------------------------------------------------------------
-- RLS
-- Sem policy de INSERT direto: o cliente (anon) grava só via a RPC
-- SECURITY DEFINER abaixo, que revalida o token a cada chamada.
-- ---------------------------------------------------------------------------
ALTER TABLE public.video_script_suggestions ENABLE ROW LEVEL SECURITY;

-- Membros da organização visualizam as sugestões da sua organização
CREATE POLICY "org_members_select_vss" ON public.video_script_suggestions FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

-- Equipe (owner/admin/manager/editor) edita status: aceitar / rejeitar
CREATE POLICY "org_editors_update_vss" ON public.video_script_suggestions FOR UPDATE TO authenticated
  USING (public.can_edit_org_content(organization_id))
  WITH CHECK (public.can_edit_org_content(organization_id));

-- ============================================================================
-- RPCs PÚBLICAS (portal do cliente /c/:token) — SECURITY DEFINER, revalidam o
-- token (existência, não revogado, não expirado) a cada chamada.
-- ============================================================================

-- INSERIR sugestão de roteiro
CREATE OR REPLACE FUNCTION public.public_insert_video_script_suggestion(
  _token TEXT, _script_id UUID, _field_name TEXT,
  _original_value TEXT, _suggested_value TEXT, _author_name TEXT DEFAULT NULL)
RETURNS public.video_script_suggestions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ok BOOLEAN;
  v_row public.video_script_suggestions;
BEGIN
  IF _field_name NOT IN ('title','spoken_text','references_notes','editing_instructions') THEN
    RAISE EXCEPTION 'Campo de roteiro inválido';
  END IF;
  IF coalesce(btrim(_suggested_value), '') = '' THEN
    RAISE EXCEPTION 'Sugestão vazia';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.video_scripts vs
    JOIN public.plannings pl ON pl.id = vs.planning_id
    JOIN public.clients c    ON c.id = pl.client_id
    WHERE vs.id = _script_id
      AND c.public_link_token::text = _token
      AND c.public_link_revoked = false
      AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Roteiro não encontrado ou token inválido';
  END IF;

  -- planning_id / organization_id são preenchidos pelo trigger sync_vss_scope
  INSERT INTO public.video_script_suggestions
    (video_script_id, field_name, original_value, suggested_value, created_by_name)
  VALUES (_script_id, _field_name, _original_value, _suggested_value, NULLIF(_author_name, ''))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- LISTAR as sugestões de um roteiro (para o cliente ver o histórico)
CREATE OR REPLACE FUNCTION public.get_public_video_script_suggestions(_token TEXT, _script_id UUID)
RETURNS SETOF public.video_script_suggestions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vss.* FROM public.video_script_suggestions vss
  JOIN public.video_scripts vs ON vs.id = vss.video_script_id
  JOIN public.plannings pl     ON pl.id = vs.planning_id
  JOIN public.clients c        ON c.id = pl.client_id
  WHERE vss.video_script_id = _script_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
  ORDER BY vss.created_at DESC
$$;

-- ============================================================================
-- RPCs INTERNAS (agência autenticada) — aceitar/aplicar e rejeitar de forma
-- ATÔMICA e autorizada. NÃO são liberadas para anon.
-- ============================================================================

-- ACEITAR + APLICAR: copia suggested_value no campo certo do roteiro e marca accepted
CREATE OR REPLACE FUNCTION public.apply_video_script_suggestion(_suggestion_id UUID)
RETURNS public.video_script_suggestions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.video_script_suggestions;
BEGIN
  SELECT * INTO s FROM public.video_script_suggestions WHERE id = _suggestion_id;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'Sugestão não encontrada';
  END IF;
  IF public.can_edit_org_content(s.organization_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sem permissão para aplicar sugestões desta organização';
  END IF;
  IF s.status <> 'pending' THEN
    RAISE EXCEPTION 'Sugestão já revisada';
  END IF;

  UPDATE public.video_scripts SET
    title                = CASE WHEN s.field_name = 'title'                THEN s.suggested_value ELSE title END,
    spoken_text          = CASE WHEN s.field_name = 'spoken_text'          THEN s.suggested_value ELSE spoken_text END,
    references_notes     = CASE WHEN s.field_name = 'references_notes'     THEN s.suggested_value ELSE references_notes END,
    editing_instructions = CASE WHEN s.field_name = 'editing_instructions' THEN s.suggested_value ELSE editing_instructions END
  WHERE id = s.video_script_id;

  UPDATE public.video_script_suggestions
    SET status = 'accepted', reviewed_at = now()
  WHERE id = _suggestion_id
  RETURNING * INTO s;

  RETURN s;
END;
$$;

-- REJEITAR: só muda o status
CREATE OR REPLACE FUNCTION public.reject_video_script_suggestion(_suggestion_id UUID)
RETURNS public.video_script_suggestions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.video_script_suggestions;
BEGIN
  SELECT * INTO s FROM public.video_script_suggestions WHERE id = _suggestion_id;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'Sugestão não encontrada';
  END IF;
  IF public.can_edit_org_content(s.organization_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sem permissão para revisar sugestões desta organização';
  END IF;
  IF s.status <> 'pending' THEN
    RAISE EXCEPTION 'Sugestão já revisada';
  END IF;

  UPDATE public.video_script_suggestions
    SET status = 'rejected', reviewed_at = now()
  WHERE id = _suggestion_id
  RETURNING * INTO s;

  RETURN s;
END;
$$;

-- ---------------------------------------------------------------------------
-- GRANTS / REVOKES
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.public_insert_video_script_suggestion(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_video_script_suggestions(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_video_script_suggestion(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_video_script_suggestion(UUID) FROM PUBLIC;

-- Portal público (cliente): inserir e listar suas sugestões
GRANT EXECUTE ON FUNCTION public.public_insert_video_script_suggestion(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_video_script_suggestions(TEXT, UUID) TO anon, authenticated;

-- Agência (somente autenticado): aceitar/aplicar e rejeitar
GRANT EXECUTE ON FUNCTION public.apply_video_script_suggestion(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_video_script_suggestion(UUID) TO authenticated;

-- O projeto Supabase concede EXECUTE a anon por DEFAULT PRIVILEGES em toda função
-- nova do schema public; REVOKE FROM PUBLIC não remove esse grant explícito.
-- Removemos anon das RPCs internas para que só authenticated (membro da org) as execute.
REVOKE EXECUTE ON FUNCTION public.apply_video_script_suggestion(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_video_script_suggestion(UUID) FROM anon;

COMMIT;
