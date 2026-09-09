BEGIN;

-- Existing agencies stay private until an owner/admin opts into discovery.
ALTER TABLE public.organizations ADD COLUMN accepts_join_requests boolean NOT NULL DEFAULT false;
CREATE TABLE public.organization_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, user_id)
);
CREATE INDEX organization_join_requests_user_idx ON public.organization_join_requests(user_id);
CREATE INDEX organization_join_requests_pending_idx ON public.organization_join_requests(organization_id, created_at)
  WHERE status = 'pending';
ALTER TABLE public.organization_join_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_join_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_join_requests TO authenticated;
CREATE POLICY join_requests_read ON public.organization_join_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.get_org_role(organization_id) IN ('owner', 'admin', 'manager'));
-- No direct writes: request identity, approval and membership are server-owned.

CREATE SCHEMA IF NOT EXISTS norteia_access;
REVOKE ALL ON SCHEMA norteia_access FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA norteia_access TO authenticated;

CREATE FUNCTION norteia_access.directory(_search text DEFAULT '', _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM (
    SELECT o.id, o.name, o.slug, r.status AS request_status
    FROM public.organizations o
    LEFT JOIN public.organization_join_requests r ON r.organization_id=o.id AND r.user_id=auth.uid()
    WHERE o.accepts_join_requests
      AND (strpos(lower(o.name), lower(left(COALESCE(_search, ''), 100))) > 0
        OR strpos(lower(o.slug), lower(left(COALESCE(_search, ''), 100))) > 0)
      AND NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.organization_id=o.id AND m.user_id=auth.uid())
    ORDER BY lower(o.name), o.id LIMIT 20 OFFSET greatest(0, least(COALESCE(_offset, 0), 10000))
  ) d), '[]'::jsonb);
END;
$$;

CREATE FUNCTION norteia_access.my_requests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM (
    SELECT r.id, r.organization_id, o.name AS organization_name, r.status, r.created_at
    FROM public.organization_join_requests r JOIN public.organizations o ON o.id=r.organization_id
    WHERE r.user_id=auth.uid() ORDER BY r.created_at DESC LIMIT 100
  ) d), '[]'::jsonb);
END;
$$;

CREATE FUNCTION norteia_access.request_join(_organization_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_email text; v_confirmed timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501'; END IF;
  -- Serialize this user's requests, including the pending-request limit.
  SELECT u.email, u.email_confirmed_at INTO v_email, v_confirmed FROM auth.users u WHERE u.id=auth.uid() FOR UPDATE;
  IF NULLIF(btrim(v_email), '') IS NULL OR v_confirmed IS NULL THEN
    RAISE EXCEPTION 'Confirme seu e-mail antes de solicitar acesso' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE user_id=auth.uid() AND organization_id=_organization_id) THEN
    RAISE EXCEPTION 'Você já tem um vínculo nesta agência. Fale com o administrador.';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id=_organization_id AND accepts_join_requests FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agência indisponível para solicitações'; END IF;
  SELECT id INTO v_id FROM public.organization_join_requests
    WHERE organization_id=_organization_id AND user_id=auth.uid() AND status='pending';
  IF FOUND THEN RETURN v_id; END IF;
  IF EXISTS (SELECT 1 FROM public.organization_join_requests WHERE organization_id=_organization_id AND user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Solicitação já analisada. Fale com o administrador para receber um convite.';
  END IF;
  IF (SELECT count(*) FROM public.organization_join_requests WHERE user_id=auth.uid() AND status='pending') >= 5 THEN
    RAISE EXCEPTION 'Aguarde a análise dos seus pedidos pendentes antes de solicitar outra agência';
  END IF;
  INSERT INTO public.organization_join_requests(organization_id, user_id)
    VALUES (_organization_id, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION norteia_access.review_queue(_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.get_org_role(_organization_id) IN ('owner','admin','manager'), false) THEN
    RAISE EXCEPTION 'Somente a liderança desta agência pode analisar pedidos' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('accepts_join_requests',
    (SELECT accepts_join_requests FROM public.organizations WHERE id=_organization_id),
    'requests', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM (
      SELECT r.id, r.user_id, u.email, r.created_at
      FROM public.organization_join_requests r JOIN auth.users u ON u.id=r.user_id
      WHERE r.organization_id=_organization_id AND r.status='pending'
      ORDER BY r.created_at, r.id LIMIT 100
    ) d), '[]'::jsonb));
END;
$$;

CREATE FUNCTION norteia_access.review_request(_request_id uuid, _approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.organization_join_requests; v_member public.organization_members;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE='42501'; END IF;
  IF _approve IS NULL THEN RAISE EXCEPTION 'Informe a decisão'; END IF;
  SELECT * INTO v_request FROM public.organization_join_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação indisponível'; END IF;
  -- Lock the reviewer's active membership so revocation cannot race approval.
  PERFORM 1 FROM public.organization_members WHERE organization_id=v_request.organization_id
    AND user_id=auth.uid() AND status='active' AND role IN ('owner','admin','manager') FOR SHARE;
  IF NOT FOUND OR v_request.user_id=auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão para analisar esta solicitação' USING ERRCODE='42501';
  END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'Solicitação já analisada'; END IF;
  IF _approve THEN
    PERFORM 1 FROM auth.users WHERE id=v_request.user_id AND email_confirmed_at IS NOT NULL AND NULLIF(btrim(email), '') IS NOT NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'O solicitante precisa confirmar seu e-mail'; END IF;
    -- Requests never grant leadership; existing roles are never overwritten.
    SELECT * INTO v_member FROM public.organization_members WHERE organization_id=v_request.organization_id AND user_id=v_request.user_id FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.organization_members(organization_id, user_id, role, status)
        VALUES (v_request.organization_id, v_request.user_id, 'editor', 'active')
        ON CONFLICT (organization_id, user_id) DO NOTHING;
      SELECT * INTO v_member FROM public.organization_members WHERE organization_id=v_request.organization_id AND user_id=v_request.user_id FOR UPDATE;
    END IF;
    IF v_member.status <> 'active' THEN RAISE EXCEPTION 'Vínculo suspenso ou removido. Revise-o na gestão da equipe.'; END IF;
  END IF;
  UPDATE public.organization_join_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    reviewed_by=auth.uid(), reviewed_at=now() WHERE id=v_request.id;
  -- Do not change the applicant's active organization behind an open form.
END;
$$;

CREATE FUNCTION norteia_access.set_discovery(_organization_id uuid, _enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.organization_members WHERE organization_id=_organization_id AND user_id=auth.uid()
    AND status='active' AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Somente administradores podem configurar a busca' USING ERRCODE='42501'; END IF;
  IF _enabled IS NULL THEN RAISE EXCEPTION 'Informe a configuração'; END IF;
  UPDATE public.organizations SET accepts_join_requests=_enabled WHERE id=_organization_id;
END;
$$;

-- Public API uses invoker wrappers; privileged implementations stay unexposed.
CREATE FUNCTION public.search_joinable_organizations(_search text DEFAULT '', _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT norteia_access.directory(_search, _offset) $$;
CREATE FUNCTION public.my_organization_join_requests()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT norteia_access.my_requests() $$;
CREATE FUNCTION public.request_organization_access(_organization_id uuid)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT norteia_access.request_join(_organization_id) $$;
CREATE FUNCTION public.organization_access_review_queue(_organization_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT norteia_access.review_queue(_organization_id) $$;
CREATE FUNCTION public.review_organization_access(_request_id uuid, _approve boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT norteia_access.review_request(_request_id, _approve) $$;
CREATE FUNCTION public.set_organization_discovery(_organization_id uuid, _enabled boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT norteia_access.set_discovery(_organization_id, _enabled) $$;

REVOKE ALL ON FUNCTION norteia_access.directory(text,integer), norteia_access.my_requests(),
 norteia_access.request_join(uuid), norteia_access.review_queue(uuid), norteia_access.review_request(uuid,boolean),
 norteia_access.set_discovery(uuid,boolean), public.search_joinable_organizations(text,integer),
 public.my_organization_join_requests(), public.request_organization_access(uuid), public.organization_access_review_queue(uuid),
 public.review_organization_access(uuid,boolean), public.set_organization_discovery(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION norteia_access.directory(text,integer), norteia_access.my_requests(),
 norteia_access.request_join(uuid), norteia_access.review_queue(uuid), norteia_access.review_request(uuid,boolean),
 norteia_access.set_discovery(uuid,boolean), public.search_joinable_organizations(text,integer),
 public.my_organization_join_requests(), public.request_organization_access(uuid), public.organization_access_review_queue(uuid),
 public.review_organization_access(uuid,boolean), public.set_organization_discovery(uuid,boolean) TO authenticated;

COMMENT ON COLUMN public.organizations.accepts_join_requests IS 'Opt-in para exibir apenas nome e identificador na busca autenticada de agências. Nunca concede acesso.';
NOTIFY pgrst, 'reload schema';
COMMIT;
