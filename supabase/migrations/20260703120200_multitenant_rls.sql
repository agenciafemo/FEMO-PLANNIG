-- ============================================================================
-- MULTI-TENANT — PARTE 3/3: NOT NULL + RLS + RPCs do portal público + storage
--
-- ⚠️ ESTA MIGRATION SÓ PODE SER APLICADA JUNTO COM O DEPLOY DO FRONTEND NOVO.
-- NÃO é segura para rodar isolada, nem para rodar "com antecedência" enquanto
-- o app antigo ainda está no ar. Ela faz DUAS coisas que, juntas, exigem
-- deploy coordenado:
--
--   1) Trava organization_id como NOT NULL em clients, plannings, posts,
--      video_scripts, planning_templates, monthly_reports, client_documents
--      e notifications (movido para cá — ver motivo no
--      cabeçalho da parte 2/3). A partir daqui, qualquer INSERT que não
--      envie organization_id explicitamente (nas tabelas sem trigger de
--      preenchimento automático: clients, plannings, planning_templates,
--      monthly_reports, client_documents) falha.
--
--   2) Remove TODAS as policies "USING (true)"/"WITH CHECK (true)" que hoje
--      vazam dados entre agências/usuários, e troca por policies escopadas
--      por organization_id. O portal público (/c/:token) deixa de acessar
--      as tabelas diretamente e passa a usar funções SECURITY DEFINER que
--      revalidam o token a cada chamada.
--
-- Rode SÓ DEPOIS das partes 1/3 e 2/3, e SÓ no mesmo instante em que o
-- frontend atualizado (que envia organization_id nos inserts e usa as RPCs
-- do portal público) for para produção. Se esta parte rodar antes do
-- frontend novo estar no ar, o app da FEMO para de funcionar imediatamente
-- (criação de cliente/planejamento/template/relatório/documento passa a dar
-- erro, e o portal público para de carregar dados). Checklist de pré-requisito
-- antes de rodar esta parte: frontend novo já em produção E validado em
-- staging com as partes 1/3 e 2/3 já aplicadas.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- LIMPEZA DE POLICIES LEGADAS (name-agnostic)
--
-- A produção real (e o staging restaurado dela) usa nomes CURTOS de policy
-- (cl_*, pl_*, po_*, vs_*, pc_*, pes_*, mr_*, rc_*, cd_all_auth, nt_*, pt_all,
-- tp_all) — diferentes dos nomes descritivos dos DROP POLICY abaixo, que vieram
-- de outra linhagem de schema. Se dependêssemos só daqueles DROPs por nome, as
-- policies antigas (incluindo as `anon`) permaneceriam e a RLS não travaria
-- nada. Este bloco remove TODAS as policies das tabelas-alvo, seja qual for o
-- nome, garantindo que só as novas `org_*` (criadas abaixo) restem.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'clients',
        'plannings',
        'posts',
        'video_scripts',
        'post_comments',
        'post_edit_suggestions',
        'monthly_reports',
        'report_comments',
        'client_documents',
        'notifications',
        'planning_templates',
        'template_posts'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- NOT NULL — só agora, depois que o backfill (parte 2/3) já garantiu que
-- toda linha existente tem organization_id preenchido, e junto com o
-- deploy do frontend que passa a enviar organization_id nos inserts novos.
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients             ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.plannings           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.posts               ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.video_scripts       ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.planning_templates  ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.monthly_reports     ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.client_documents    ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.notifications       ALTER COLUMN organization_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- CLIENTS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users manage own clients" ON public.clients;
DROP POLICY IF EXISTS "Public access via token" ON public.clients;

CREATE POLICY "org_members_select_clients" ON public.clients FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "org_managers_insert_clients" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.get_org_role(organization_id) IN ('owner','admin','manager') AND created_by = auth.uid());
CREATE POLICY "org_managers_update_clients" ON public.clients FOR UPDATE TO authenticated
  USING (public.get_org_role(organization_id) IN ('owner','admin','manager'))
  WITH CHECK (public.get_org_role(organization_id) IN ('owner','admin','manager'));
CREATE POLICY "org_managers_delete_clients" ON public.clients FOR DELETE TO authenticated
  USING (public.get_org_role(organization_id) IN ('owner','admin','manager'));

-- ---------------------------------------------------------------------------
-- PLANNINGS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users manage own plannings" ON public.plannings;
DROP POLICY IF EXISTS "Public access plannings via client" ON public.plannings;

CREATE POLICY "org_members_select_plannings" ON public.plannings FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "org_managers_insert_plannings" ON public.plannings FOR INSERT TO authenticated
  WITH CHECK (public.get_org_role(organization_id) IN ('owner','admin','manager') AND created_by = auth.uid());
CREATE POLICY "org_managers_update_plannings" ON public.plannings FOR UPDATE TO authenticated
  USING (public.get_org_role(organization_id) IN ('owner','admin','manager'))
  WITH CHECK (public.get_org_role(organization_id) IN ('owner','admin','manager'));
CREATE POLICY "org_managers_delete_plannings" ON public.plannings FOR DELETE TO authenticated
  USING (public.get_org_role(organization_id) IN ('owner','admin','manager'));

-- ---------------------------------------------------------------------------
-- POSTS (editor pode editar conteúdos)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users manage posts via planning" ON public.posts;
DROP POLICY IF EXISTS "Public access posts" ON public.posts;

CREATE POLICY "org_members_select_posts" ON public.posts FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "org_editors_insert_posts" ON public.posts FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_org_content(organization_id));
CREATE POLICY "org_editors_update_posts" ON public.posts FOR UPDATE TO authenticated
  USING (public.can_edit_org_content(organization_id))
  WITH CHECK (public.can_edit_org_content(organization_id));
CREATE POLICY "org_editors_delete_posts" ON public.posts FOR DELETE TO authenticated
  USING (public.can_edit_org_content(organization_id));

-- ---------------------------------------------------------------------------
-- VIDEO SCRIPTS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users manage scripts via planning" ON public.video_scripts;
DROP POLICY IF EXISTS "Public read scripts" ON public.video_scripts;

CREATE POLICY "org_members_select_video_scripts" ON public.video_scripts FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "org_editors_insert_video_scripts" ON public.video_scripts FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_org_content(organization_id));
CREATE POLICY "org_editors_update_video_scripts" ON public.video_scripts FOR UPDATE TO authenticated
  USING (public.can_edit_org_content(organization_id))
  WITH CHECK (public.can_edit_org_content(organization_id));
CREATE POLICY "org_editors_delete_video_scripts" ON public.video_scripts FOR DELETE TO authenticated
  USING (public.can_edit_org_content(organization_id));

-- ---------------------------------------------------------------------------
-- POST COMMENTS (transitivo via posts). Lado autenticado apenas — o lado do
-- portal público passa a usar public_insert_post_comment (ver seção RPCs).
--
-- Soft delete: a policy de SELECT já filtra deleted_at IS NULL, então
-- comentários apagados pelo cliente (via public_delete_post_comment, que faz
-- UPDATE deleted_at em vez de DELETE — ver seção RPCs) ficam ocultos também
-- para gestores/equipe, mas permanecem no banco para auditoria. A policy de
-- DELETE abaixo é o hard delete que managers/admins/owners continuam tendo
-- (ação diferente, não usada pelo portal público).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view comments" ON public.post_comments;
DROP POLICY IF EXISTS "Anyone can insert comments" ON public.post_comments;
DROP POLICY IF EXISTS "Managers can delete comments" ON public.post_comments;

CREATE POLICY "org_members_select_post_comments" ON public.post_comments FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.posts po WHERE po.id = post_comments.post_id AND public.is_org_member(po.organization_id))
  );
CREATE POLICY "org_members_insert_post_comments" ON public.post_comments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts po WHERE po.id = post_comments.post_id AND public.is_org_member(po.organization_id)));
CREATE POLICY "org_managers_delete_post_comments" ON public.post_comments FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts po WHERE po.id = post_comments.post_id AND public.can_edit_org_content(po.organization_id)));

-- ---------------------------------------------------------------------------
-- POST EDIT SUGGESTIONS (transitivo via posts)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view suggestions" ON public.post_edit_suggestions;
DROP POLICY IF EXISTS "Anyone can insert suggestions" ON public.post_edit_suggestions;
DROP POLICY IF EXISTS "Managers can update suggestions" ON public.post_edit_suggestions;

CREATE POLICY "org_members_select_suggestions" ON public.post_edit_suggestions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts po WHERE po.id = post_edit_suggestions.post_id AND public.is_org_member(po.organization_id)));
CREATE POLICY "org_members_insert_suggestions" ON public.post_edit_suggestions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts po WHERE po.id = post_edit_suggestions.post_id AND public.is_org_member(po.organization_id)));
CREATE POLICY "org_editors_update_suggestions" ON public.post_edit_suggestions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts po WHERE po.id = post_edit_suggestions.post_id AND public.can_edit_org_content(po.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts po WHERE po.id = post_edit_suggestions.post_id AND public.can_edit_org_content(po.organization_id)));

-- ---------------------------------------------------------------------------
-- MONTHLY REPORTS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers manage reports" ON public.monthly_reports;
DROP POLICY IF EXISTS "Public access reports" ON public.monthly_reports;

CREATE POLICY "org_members_select_reports" ON public.monthly_reports FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "org_managers_insert_reports" ON public.monthly_reports FOR INSERT TO authenticated
  WITH CHECK (public.get_org_role(organization_id) IN ('owner','admin','manager'));
CREATE POLICY "org_managers_update_reports" ON public.monthly_reports FOR UPDATE TO authenticated
  USING (public.get_org_role(organization_id) IN ('owner','admin','manager'))
  WITH CHECK (public.get_org_role(organization_id) IN ('owner','admin','manager'));
CREATE POLICY "org_managers_delete_reports" ON public.monthly_reports FOR DELETE TO authenticated
  USING (public.get_org_role(organization_id) IN ('owner','admin','manager'));

-- ---------------------------------------------------------------------------
-- REPORT COMMENTS (transitivo via monthly_reports)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view report comments" ON public.report_comments;
DROP POLICY IF EXISTS "Anyone can insert report comments" ON public.report_comments;
DROP POLICY IF EXISTS "Anyone can update report comments" ON public.report_comments;
DROP POLICY IF EXISTS "Managers can delete report comments" ON public.report_comments;

CREATE POLICY "org_members_select_report_comments" ON public.report_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.monthly_reports mr WHERE mr.id = report_comments.report_id AND public.is_org_member(mr.organization_id)));
CREATE POLICY "org_members_insert_report_comments" ON public.report_comments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.monthly_reports mr WHERE mr.id = report_comments.report_id AND public.is_org_member(mr.organization_id)));
CREATE POLICY "org_managers_delete_report_comments" ON public.report_comments FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.monthly_reports mr WHERE mr.id = report_comments.report_id AND public.get_org_role(mr.organization_id) IN ('owner','admin','manager')));

-- ---------------------------------------------------------------------------
-- CLIENT DOCUMENTS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers manage documents" ON public.client_documents;
DROP POLICY IF EXISTS "Public read documents" ON public.client_documents;
DROP POLICY IF EXISTS "Public insert documents" ON public.client_documents;

CREATE POLICY "org_members_select_documents" ON public.client_documents FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "org_managers_insert_documents" ON public.client_documents FOR INSERT TO authenticated
  WITH CHECK (public.get_org_role(organization_id) IN ('owner','admin','manager'));
CREATE POLICY "org_managers_update_documents" ON public.client_documents FOR UPDATE TO authenticated
  USING (public.get_org_role(organization_id) IN ('owner','admin','manager'))
  WITH CHECK (public.get_org_role(organization_id) IN ('owner','admin','manager'));
CREATE POLICY "org_managers_delete_documents" ON public.client_documents FOR DELETE TO authenticated
  USING (public.get_org_role(organization_id) IN ('owner','admin','manager'));

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS (agora escopada por organização; lado público via RPC)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated view notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated update notifications" ON public.notifications;
DROP POLICY IF EXISTS "Anyone can insert notifications" ON public.notifications;

CREATE POLICY "org_members_select_notifications" ON public.notifications FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "org_members_update_notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));
CREATE POLICY "org_members_insert_notifications" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- PLANNING TEMPLATES / TEMPLATE POSTS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "pt_all" ON public.planning_templates;

CREATE POLICY "org_members_select_templates" ON public.planning_templates FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "org_managers_insert_templates" ON public.planning_templates FOR INSERT TO authenticated
  WITH CHECK (public.get_org_role(organization_id) IN ('owner','admin','manager') AND user_id = auth.uid());
CREATE POLICY "org_managers_update_templates" ON public.planning_templates FOR UPDATE TO authenticated
  USING (public.get_org_role(organization_id) IN ('owner','admin','manager'))
  WITH CHECK (public.get_org_role(organization_id) IN ('owner','admin','manager'));
CREATE POLICY "org_managers_delete_templates" ON public.planning_templates FOR DELETE TO authenticated
  USING (public.get_org_role(organization_id) IN ('owner','admin','manager'));

DROP POLICY IF EXISTS "tp_all" ON public.template_posts;

CREATE POLICY "org_members_select_template_posts" ON public.template_posts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.planning_templates pt WHERE pt.id = template_posts.template_id AND public.is_org_member(pt.organization_id)));
CREATE POLICY "org_managers_manage_template_posts" ON public.template_posts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.planning_templates pt WHERE pt.id = template_posts.template_id AND public.get_org_role(pt.organization_id) IN ('owner','admin','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.planning_templates pt WHERE pt.id = template_posts.template_id AND public.get_org_role(pt.organization_id) IN ('owner','admin','manager')));

-- ---------------------------------------------------------------------------
-- ORGANIZATIONS / MEMBERS / INVITATIONS
-- ---------------------------------------------------------------------------
CREATE POLICY "org_members_select_organizations" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));
CREATE POLICY "org_admins_update_organizations" ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_org_admin_or_owner(id))
  WITH CHECK (public.is_org_admin_or_owner(id));
-- Sem policy de INSERT: criação só via RPC create_organization (SECURITY DEFINER).

CREATE POLICY "org_members_select_members" ON public.organization_members FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "org_admins_update_members" ON public.organization_members FOR UPDATE TO authenticated
  USING (public.is_org_admin_or_owner(organization_id) AND (role <> 'owner' OR public.get_org_role(organization_id) = 'owner'))
  WITH CHECK (public.is_org_admin_or_owner(organization_id) AND (role <> 'owner' OR public.get_org_role(organization_id) = 'owner'));
CREATE POLICY "org_admins_delete_members" ON public.organization_members FOR DELETE TO authenticated
  USING (public.is_org_admin_or_owner(organization_id) AND (role <> 'owner' OR public.get_org_role(organization_id) = 'owner'));
CREATE POLICY "org_members_leave_self" ON public.organization_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());
-- Sem policy de INSERT: membership só é criada via RPC (create_organization / accept_organization_invitation).

CREATE POLICY "org_admins_select_invitations" ON public.organization_invitations FOR SELECT TO authenticated
  USING (public.is_org_admin_or_owner(organization_id));
CREATE POLICY "org_admins_insert_invitations" ON public.organization_invitations FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin_or_owner(organization_id) AND created_by = auth.uid());
CREATE POLICY "org_admins_update_invitations" ON public.organization_invitations FOR UPDATE TO authenticated
  USING (public.is_org_admin_or_owner(organization_id))
  WITH CHECK (public.is_org_admin_or_owner(organization_id));
-- Leitura do convite pelo convidado (ainda não é membro) é via RPC get_invitation_by_token, não policy direta.

-- ============================================================================
-- RPCs — ORGANIZAÇÃO (criação, convites)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_organization(_name TEXT, _slug TEXT)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org public.organizations;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário';
  END IF;

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES (_name, _slug, auth.uid())
  RETURNING * INTO v_org;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (v_org.id, auth.uid(), 'owner', 'active');

  UPDATE public.profiles SET active_organization_id = v_org.id WHERE id = auth.uid();

  RETURN v_org;
END;
$$;
REVOKE ALL ON FUNCTION public.create_organization(TEXT, TEXT) FROM PUBLIC;
-- Supabase concede EXECUTE a anon por DEFAULT PRIVILEGES; REVOKE FROM PUBLIC não
-- remove esse grant. Removemos anon explicitamente (RPC authenticated-only).
REVOKE EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(_token TEXT)
RETURNS TABLE (
  organization_id UUID,
  organization_name TEXT,
  role public.organization_member_role,
  email TEXT,
  status public.organization_invitation_status,
  expires_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT oi.organization_id, o.name, oi.role, oi.email, oi.status, oi.expires_at
  FROM public.organization_invitations oi
  JOIN public.organizations o ON o.id = oi.organization_id
  WHERE oi.token = _token
$$;
REVOKE ALL ON FUNCTION public.get_invitation_by_token(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_invitation_by_token(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(_token TEXT)
RETURNS public.organization_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invitation public.organization_invitations;
  v_user_email TEXT;
  v_member public.organization_members;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário para aceitar o convite';
  END IF;

  SELECT * INTO v_invitation FROM public.organization_invitations
  WHERE token = _token AND status = 'pending' AND expires_at > now();

  IF v_invitation.id IS NULL THEN
    RAISE EXCEPTION 'Convite inválido, expirado ou já utilizado';
  END IF;

  SELECT email INTO v_user_email FROM public.profiles WHERE id = auth.uid();

  IF lower(v_user_email) <> lower(v_invitation.email) THEN
    RAISE EXCEPTION 'Este convite foi enviado para outro e-mail';
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (v_invitation.organization_id, auth.uid(), v_invitation.role, 'active')
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = now()
  RETURNING * INTO v_member;

  UPDATE public.organization_invitations SET status = 'accepted' WHERE id = v_invitation.id;
  UPDATE public.profiles SET active_organization_id = v_invitation.organization_id WHERE id = auth.uid();

  RETURN v_member;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_organization_invitation(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_organization_invitation(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(TEXT) TO authenticated;

-- ============================================================================
-- RPCs — PORTAL PÚBLICO DO CLIENTE (/c/:token)
--
-- Todas revalidam o token a cada chamada (existência, não revogado, não
-- expirado). Nenhuma tabela base concede SELECT/INSERT a `anon` — o único
-- caminho de acesso público é por estas funções.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_client(_token TEXT)
RETURNS TABLE (id UUID, name TEXT, logo_url TEXT, accent_color TEXT, notes TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name, c.logo_url, c.accent_color, c.notes
  FROM public.clients c
  WHERE c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.get_public_plannings(_token TEXT)
RETURNS SETOF public.plannings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pl.* FROM public.plannings pl
  JOIN public.clients c ON c.id = pl.client_id
  WHERE c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.get_public_posts(_token TEXT, _planning_id UUID)
RETURNS SETOF public.posts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT po.* FROM public.posts po
  JOIN public.plannings pl ON pl.id = po.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE pl.id = _planning_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.get_public_video_scripts(_token TEXT, _planning_id UUID)
RETURNS SETOF public.video_scripts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vs.* FROM public.video_scripts vs
  JOIN public.plannings pl ON pl.id = vs.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE pl.id = _planning_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.get_public_reports(_token TEXT)
RETURNS SETOF public.monthly_reports
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT mr.* FROM public.monthly_reports mr
  JOIN public.clients c ON c.id = mr.client_id
  WHERE c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.get_public_documents(_token TEXT)
RETURNS SETOF public.client_documents
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cd.* FROM public.client_documents cd
  JOIN public.clients c ON c.id = cd.client_id
  WHERE c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.get_public_post(_token TEXT, _post_id UUID)
RETURNS SETOF public.posts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT po.* FROM public.posts po
  JOIN public.plannings pl ON pl.id = po.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE po.id = _post_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.get_public_post_suggestions(_token TEXT, _post_id UUID)
RETURNS SETOF public.post_edit_suggestions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pes.* FROM public.post_edit_suggestions pes
  JOIN public.posts po ON po.id = pes.post_id
  JOIN public.plannings pl ON pl.id = po.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE pes.post_id = _post_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.public_update_post_status(_token TEXT, _post_id UUID, _new_status TEXT)
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
  RETURNING po.* INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Post não encontrado ou token inválido';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_update_post_comment(_token TEXT, _comment_id UUID, _text TEXT)
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
  RETURNING pc.* INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Comentário não encontrado ou token inválido';
  END IF;

  RETURN v_row;
END;
$$;

-- Soft delete: NÃO apaga a linha. Marca deleted_at e o comentário some da
-- interface (público via get_public_post_comments, autenticado via
-- org_members_select_post_comments), mas fica preservado no banco para
-- auditoria (ex: disputa sobre o que o cliente disse). Só marca comentários
-- do próprio cliente (author_type='client') que ainda não estavam apagados.
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
  RETURNING pc.id INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'Comentário não encontrado ou token inválido';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_post_comments(_token TEXT, _post_id UUID)
RETURNS SETOF public.post_comments
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pc.* FROM public.post_comments pc
  JOIN public.posts po ON po.id = pc.post_id
  JOIN public.plannings pl ON pl.id = po.planning_id
  JOIN public.clients c ON c.id = pl.client_id
  WHERE pc.post_id = _post_id
    AND pc.deleted_at IS NULL
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.get_public_report_comments(_token TEXT, _report_id UUID)
RETURNS SETOF public.report_comments
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rc.* FROM public.report_comments rc
  JOIN public.monthly_reports mr ON mr.id = rc.report_id
  JOIN public.clients c ON c.id = mr.client_id
  WHERE rc.report_id = _report_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.public_insert_post_comment(_token TEXT, _post_id UUID, _author_name TEXT, _text TEXT, _audio_url TEXT DEFAULT NULL)
RETURNS public.post_comments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_valid BOOLEAN;
  v_row public.post_comments;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.posts po
    JOIN public.plannings pl ON pl.id = po.planning_id
    JOIN public.clients c ON c.id = pl.client_id
    WHERE po.id = _post_id
      AND c.public_link_token::text = _token
      AND c.public_link_revoked = false
      AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Token inválido para este post';
  END IF;

  INSERT INTO public.post_comments (post_id, author_type, author_name, text, audio_url)
  VALUES (_post_id, 'client', COALESCE(NULLIF(_author_name, ''), 'Cliente'), _text, _audio_url)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_insert_report_comment(_token TEXT, _report_id UUID, _author_name TEXT, _text TEXT, _audio_url TEXT DEFAULT NULL)
RETURNS public.report_comments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_valid BOOLEAN;
  v_row public.report_comments;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.monthly_reports mr
    JOIN public.clients c ON c.id = mr.client_id
    WHERE mr.id = _report_id
      AND c.public_link_token::text = _token
      AND c.public_link_revoked = false
      AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Token inválido para este relatório';
  END IF;

  INSERT INTO public.report_comments (report_id, author_type, author_name, text, audio_url)
  VALUES (_report_id, 'client', COALESCE(NULLIF(_author_name, ''), 'Cliente'), _text, _audio_url)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_insert_edit_suggestion(_token TEXT, _post_id UUID, _field_name TEXT, _original_value TEXT, _suggested_value TEXT)
RETURNS public.post_edit_suggestions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_valid BOOLEAN;
  v_row public.post_edit_suggestions;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.posts po
    JOIN public.plannings pl ON pl.id = po.planning_id
    JOIN public.clients c ON c.id = pl.client_id
    WHERE po.id = _post_id
      AND c.public_link_token::text = _token
      AND c.public_link_revoked = false
      AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Token inválido para este post';
  END IF;

  INSERT INTO public.post_edit_suggestions (post_id, field_name, original_value, suggested_value)
  VALUES (_post_id, _field_name, _original_value, _suggested_value)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_update_planning_status(_token TEXT, _planning_id UUID, _new_status TEXT)
RETURNS public.plannings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.plannings;
BEGIN
  IF _new_status <> 'approved' THEN
    RAISE EXCEPTION 'Transição de status não permitida pelo portal público';
  END IF;

  UPDATE public.plannings pl
  SET status = _new_status
  FROM public.clients c
  WHERE pl.id = _planning_id
    AND pl.client_id = c.id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
    AND pl.status = 'client_review'
  RETURNING pl.* INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Planejamento não encontrado, token inválido, ou status atual não permite aprovação';
  END IF;

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
  SELECT pl.organization_id, c.name INTO v_org_id, v_client_name
  FROM public.plannings pl
  JOIN public.clients c ON c.id = pl.client_id
  WHERE pl.id = _planning_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now());

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Token inválido para este planejamento';
  END IF;

  INSERT INTO public.notifications (organization_id, type, title, body, planning_id)
  VALUES (v_org_id, 'planning_viewed', 'Cliente abriu o planejamento', v_client_name, _planning_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_client(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_plannings(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_post(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_posts(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_post_suggestions(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_video_scripts(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_reports(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_documents(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_post_comments(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_report_comments(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_insert_post_comment(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_insert_report_comment(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_insert_edit_suggestion(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_update_planning_status(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_update_post_status(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_update_post_comment(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_delete_post_comment(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_notify_planning_viewed(TEXT, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_client(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_plannings(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_post(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_posts(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_post_suggestions(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_video_scripts(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_reports(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_documents(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_post_comments(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_report_comments(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_insert_post_comment(TEXT, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_insert_report_comment(TEXT, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_insert_edit_suggestion(TEXT, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_update_planning_status(TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_update_post_status(TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_update_post_comment(TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_delete_post_comment(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_notify_planning_viewed(TEXT, UUID) TO anon, authenticated;

-- ============================================================================
-- STORAGE
--
-- Buckets continuam públicos para leitura (mantém URLs já embutidas no app
-- e no portal). Upload/update/delete passam a exigir associação real com a
-- organização dona do recurso, respeitando a convenção de path JÁ USADA
-- pelo código do app (não introduzimos uma convenção nova):
--   client-logos:     <client_id>/<arquivo>       (Clients.tsx)
--   post-media:       <planning_id>/<post_id>/... (PostEditor.tsx)
--   report-pdfs:      <client_id>/<arquivo>       (ClientReports.tsx)
--   client-documents: <client_id>/<arquivo>       (ClientDocuments.tsx)
-- `comment-audios` é restrito a `authenticated` nesta migration — upload
-- público (portal, sem sessão) fica documentado como próximo passo (Edge
-- Function dedicada), não resolvido aqui.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.storage_first_segment_uuid(_name TEXT)
RETURNS UUID
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN ((storage.foldername(_name))[1])::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_org_member_for_client_path(_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = public.storage_first_segment_uuid(_name)
      AND public.is_org_member(c.organization_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_member_for_planning_path(_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.plannings pl
    WHERE pl.id = public.storage_first_segment_uuid(_name)
      AND public.is_org_member(pl.organization_id)
  )
$$;

-- Hardening: helpers internos de storage não precisam ser executáveis por anon
-- (usados só nas policies de storage.objects, que são TO authenticated). O grant
-- do anon vem via PUBLIC (default do Postgres em CREATE FUNCTION), então é
-- preciso REVOKE FROM PUBLIC — REVOKE FROM anon não removeria esse caminho.
REVOKE EXECUTE ON FUNCTION public.storage_first_segment_uuid(TEXT)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_org_member_for_client_path(TEXT)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_org_member_for_planning_path(TEXT) FROM PUBLIC;

DROP POLICY IF EXISTS "Auth upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Auth update logos" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete logos" ON storage.objects;
CREATE POLICY "org_upload_logos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-logos' AND public.is_org_member_for_client_path(name));
CREATE POLICY "org_update_logos" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'client-logos' AND public.is_org_member_for_client_path(name));
CREATE POLICY "org_delete_logos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-logos' AND public.is_org_member_for_client_path(name));

DROP POLICY IF EXISTS "Auth upload media" ON storage.objects;
DROP POLICY IF EXISTS "Auth update media" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete media" ON storage.objects;
CREATE POLICY "org_upload_media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'post-media' AND public.is_org_member_for_planning_path(name));
CREATE POLICY "org_update_media" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'post-media' AND public.is_org_member_for_planning_path(name));
CREATE POLICY "org_delete_media" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'post-media' AND public.is_org_member_for_planning_path(name));

DROP POLICY IF EXISTS "Auth upload pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete pdfs" ON storage.objects;
CREATE POLICY "org_upload_pdfs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'report-pdfs' AND public.is_org_member_for_client_path(name));
CREATE POLICY "org_delete_pdfs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'report-pdfs' AND public.is_org_member_for_client_path(name));

DROP POLICY IF EXISTS "Anyone upload audios" ON storage.objects;
CREATE POLICY "org_upload_audios" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'comment-audios' AND EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = auth.uid() AND om.status = 'active'));
-- Upload público de áudio (cliente gravando no portal, sem sessão) requer uma
-- Edge Function dedicada que valide o token e devolva uma signed upload URL —
-- não é possível autorizar `anon` genericamente aqui sem reabrir o buraco.

DROP POLICY IF EXISTS "Auth upload client docs" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete client docs" ON storage.objects;
CREATE POLICY "org_upload_client_docs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-documents' AND public.is_org_member_for_client_path(name));
CREATE POLICY "org_delete_client_docs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-documents' AND public.is_org_member_for_client_path(name));

COMMIT;
