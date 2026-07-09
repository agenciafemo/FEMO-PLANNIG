-- ============================================================================
-- MULTI-TENANT — PARTE 2/3: BACKFILL (somente dados — SEM travar NOT NULL)
--
-- Cria a organização "FEMO" e migra todos os dados existentes para ela.
-- Não destrutivo: nenhuma linha é apagada. team_members/user_roles são
-- preservados (não removidos), apenas espelhados em organization_members/
-- organization_invitations.
--
-- IMPORTANTE — por que esta migration NÃO torna organization_id obrigatório:
-- o app atual em produção ainda faz INSERT em clients/plannings/
-- monthly_reports/client_documents/planning_templates sem enviar
-- organization_id (essas 5 tabelas não têm trigger de preenchimento
-- automático, diferente de posts/video_scripts). Se esta
-- migration travasse a coluna como NOT NULL, essas 5 telas do app atual da
-- FEMO parariam de funcionar imediatamente, mesmo sem a parte 3/3 (RLS) ter
-- sido aplicada ainda. Por isso esta migration faz SÓ o backfill dos dados
-- existentes — organization_id continua NULLABLE ao final dela. A trava
-- ALTER COLUMN ... SET NOT NULL foi movida para o início da parte 3/3, que já
-- exige frontend atualizado e deploy coordenado (ver aviso lá).
--
-- Rode SÓ DEPOIS da parte 1/3 (schema). Rode em staging/cópia de produção
-- primeiro e confira os counts antes/depois (ver instruções no plano).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Organização FEMO
-- Owner = conta principal da agência, definida EXPLICITAMENTE por e-mail
-- (agenciafemo@gmail.com). Buscamos em auth.users porque é essa a tabela
-- referenciada por organizations.created_by e organization_members.user_id —
-- o owner NÃO precisa ter linha em profiles. Se o usuário não for encontrado
-- em auth.users, a migration ABORTA de propósito, em vez de cair num fallback
-- que escolheria o owner errado (ex.: o profile mais antigo).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_owner_id UUID;
  v_org_id UUID;
BEGIN
  SELECT id INTO v_owner_id
  FROM auth.users
  WHERE lower(email) = 'agenciafemo@gmail.com'
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Owner agenciafemo@gmail.com não encontrado em auth.users — abortando para não criar a organização FEMO com owner incorreto';
  END IF;

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES ('Femo Agência', 'femo', v_owner_id)
  RETURNING id INTO v_org_id;

  -- 2) Migra usuários conhecidos para organization_members
  --    owner: a conta principal (agenciafemo@gmail.com) definida acima
  --    admin: demais usuários com user_roles.role = 'admin'
  --    editor (default): demais usuários encontrados em clients/plannings/
  --                       planning_templates/team_members
  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  SELECT v_org_id, v_owner_id, 'owner'::public.organization_member_role, 'active'::public.organization_member_status;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  SELECT DISTINCT v_org_id, ur.user_id, 'admin'::public.organization_member_role, 'active'::public.organization_member_status
  FROM public.user_roles ur
  WHERE ur.role = 'admin' AND ur.user_id <> v_owner_id
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  SELECT DISTINCT v_org_id, uid, 'editor'::public.organization_member_role, 'active'::public.organization_member_status
  FROM (
    SELECT created_by AS uid FROM public.clients
    UNION SELECT created_by FROM public.plannings
    UNION SELECT user_id FROM public.planning_templates
    UNION SELECT owner_id FROM public.team_members
    UNION SELECT user_id FROM public.team_members WHERE user_id IS NOT NULL
  ) known_users
  WHERE uid IS NOT NULL AND uid <> v_owner_id
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  -- 3) team_members com convite nunca vinculado (user_id IS NULL) viram
  --    convites pendentes reais, preservando o dado sem inventar vínculo.
  INSERT INTO public.organization_invitations (organization_id, email, role, status, created_by)
  SELECT v_org_id, tm.email, 'editor'::public.organization_member_role, 'pending'::public.organization_invitation_status, tm.owner_id
  FROM public.team_members tm
  WHERE tm.user_id IS NULL
  ON CONFLICT DO NOTHING;

  -- 4) Backfill de organization_id nas tabelas com coluna direta
  --    (só existe uma organização na base hoje, update simples e seguro)
  UPDATE public.clients             SET organization_id = v_org_id WHERE organization_id IS NULL;
  UPDATE public.plannings           SET organization_id = v_org_id WHERE organization_id IS NULL;
  UPDATE public.planning_templates  SET organization_id = v_org_id WHERE organization_id IS NULL;
  UPDATE public.monthly_reports     SET organization_id = v_org_id WHERE organization_id IS NULL;
  UPDATE public.client_documents    SET organization_id = v_org_id WHERE organization_id IS NULL;

  -- posts/video_scripts têm trigger de sincronização a partir da tabela pai,
  -- mas o trigger só dispara em INSERT/UPDATE OF <fk>; para linhas já
  -- existentes fazemos o backfill direto aqui.
  UPDATE public.posts p
  SET organization_id = pl.organization_id
  FROM public.plannings pl
  WHERE p.planning_id = pl.id AND p.organization_id IS NULL;

  UPDATE public.video_scripts vs
  SET organization_id = pl.organization_id
  FROM public.plannings pl
  WHERE vs.planning_id = pl.id AND vs.organization_id IS NULL;

  -- notifications: só existe uma organização hoje, então todo registro
  -- global (histórico) pertence à FEMO.
  UPDATE public.notifications SET organization_id = v_org_id WHERE organization_id IS NULL;

  -- 5) Organização ativa padrão para todo mundo
  UPDATE public.profiles SET active_organization_id = v_org_id WHERE active_organization_id IS NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Assertions de sanidade — aborta a transação se sobrou alguma linha órfã
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_orphans INT;
BEGIN
  SELECT count(*) INTO v_orphans FROM public.clients WHERE organization_id IS NULL;
  IF v_orphans > 0 THEN RAISE EXCEPTION '% linhas órfãs em clients', v_orphans; END IF;

  SELECT count(*) INTO v_orphans FROM public.plannings WHERE organization_id IS NULL;
  IF v_orphans > 0 THEN RAISE EXCEPTION '% linhas órfãs em plannings', v_orphans; END IF;

  SELECT count(*) INTO v_orphans FROM public.posts WHERE organization_id IS NULL;
  IF v_orphans > 0 THEN RAISE EXCEPTION '% linhas órfãs em posts', v_orphans; END IF;

  SELECT count(*) INTO v_orphans FROM public.video_scripts WHERE organization_id IS NULL;
  IF v_orphans > 0 THEN RAISE EXCEPTION '% linhas órfãs em video_scripts', v_orphans; END IF;

  SELECT count(*) INTO v_orphans FROM public.planning_templates WHERE organization_id IS NULL;
  IF v_orphans > 0 THEN RAISE EXCEPTION '% linhas órfãs em planning_templates', v_orphans; END IF;

  SELECT count(*) INTO v_orphans FROM public.monthly_reports WHERE organization_id IS NULL;
  IF v_orphans > 0 THEN RAISE EXCEPTION '% linhas órfãs em monthly_reports', v_orphans; END IF;

  SELECT count(*) INTO v_orphans FROM public.client_documents WHERE organization_id IS NULL;
  IF v_orphans > 0 THEN RAISE EXCEPTION '% linhas órfãs em client_documents', v_orphans; END IF;

  SELECT count(*) INTO v_orphans FROM public.notifications WHERE organization_id IS NULL;
  IF v_orphans > 0 THEN RAISE EXCEPTION '% linhas órfãs em notifications', v_orphans; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- FIM DA PARTE 2/3. organization_id continua NULLABLE de propósito — a trava
-- NOT NULL só acontece na parte 3/3, junto com a RLS nova e o deploy do
-- frontend atualizado. Não rode nenhum ALTER COLUMN ... SET NOT NULL aqui.
-- ---------------------------------------------------------------------------

COMMIT;
