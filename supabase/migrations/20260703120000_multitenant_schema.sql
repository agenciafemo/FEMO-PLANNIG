-- ============================================================================
-- MULTI-TENANT — PARTE 1/3: SCHEMA (organizations, members, invitations,
-- colunas organization_id, funções de suporte, triggers de sincronização).
--
-- Esta migration é ADITIVA e NÃO DESTRUTIVA: nenhuma tabela/coluna/dado
-- existente é removido. As novas colunas organization_id ficam NULLABLE
-- aqui — o backfill (parte 2/3) preenche os valores e só depois torna as
-- colunas NOT NULL. A troca de RLS acontece só na parte 3/3.
--
-- Rode as 3 partes em sequência, cada uma numa transação.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
CREATE TYPE public.organization_member_role AS ENUM ('owner', 'admin', 'manager', 'editor', 'viewer');
CREATE TYPE public.organization_member_status AS ENUM ('active', 'suspended', 'removed');
CREATE TYPE public.organization_invitation_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- ---------------------------------------------------------------------------
-- ORGANIZATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  brand_color TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- ORGANIZATION MEMBERS
-- Convite pendente NÃO cria linha aqui — só existe em organization_invitations
-- até o aceite, para evitar o estado ambíguo "é membro mas não é" que hoje
-- acontece com team_members.user_id IS NULL.
-- ---------------------------------------------------------------------------
CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.organization_member_role NOT NULL DEFAULT 'editor',
  status public.organization_member_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX organization_members_user_status_idx ON public.organization_members (user_id, status);
CREATE INDEX organization_members_organization_idx ON public.organization_members (organization_id);
CREATE TRIGGER update_organization_members_updated_at BEFORE UPDATE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- ORGANIZATION INVITATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE public.organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.organization_member_role NOT NULL DEFAULT 'editor',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status public.organization_invitation_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX organization_invitations_pending_unique
  ON public.organization_invitations (organization_id, lower(email))
  WHERE status = 'pending';
CREATE INDEX organization_invitations_token_idx ON public.organization_invitations (token);

-- ---------------------------------------------------------------------------
-- PROFILES: organização ativa (puramente UX — ver funções de RLS abaixo)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN active_organization_id UUID REFERENCES public.organizations(id);

-- ---------------------------------------------------------------------------
-- CLIENTS: suporte a revogação/expiração do link público
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients ADD COLUMN public_link_revoked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.clients ADD COLUMN public_link_expires_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- POST_COMMENTS: soft delete
--
-- public_delete_post_comment (parte 3/3) não apaga a linha de verdade — só
-- marca deleted_at. O comentário fica preservado no banco para auditoria
-- (ex: disputa sobre o que o cliente disse), mas fica oculto de todas as
-- leituras (públicas e autenticadas) assim que deleted_at IS NOT NULL.
-- ---------------------------------------------------------------------------
ALTER TABLE public.post_comments ADD COLUMN deleted_at TIMESTAMPTZ;
COMMENT ON COLUMN public.post_comments.deleted_at IS
  'Soft delete: quando preenchido, o comentário some da interface (público e autenticado) mas permanece no banco para auditoria. Nunca apagar a linha de verdade — ver public_delete_post_comment na parte 3/3.';

-- ---------------------------------------------------------------------------
-- COLUNAS organization_id (NULLABLE nesta etapa)
--
-- Ficam NULLABLE em TODA esta migration e na parte 2/3 (backfill). O
-- ALTER COLUMN ... SET NOT NULL só acontece na parte 3/3, junto com a troca
-- de RLS — porque só ali o frontend novo (que envia organization_id nos
-- inserts) já precisa estar em produção. Ver aviso no topo da parte 3/3.
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients             ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.plannings           ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.posts               ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.video_scripts       ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.planning_templates  ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.monthly_reports     ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.client_documents    ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.notifications       ADD COLUMN organization_id UUID REFERENCES public.organizations(id);

CREATE INDEX clients_organization_idx             ON public.clients (organization_id);
CREATE INDEX plannings_organization_idx            ON public.plannings (organization_id);
CREATE INDEX posts_organization_idx                ON public.posts (organization_id);
CREATE INDEX video_scripts_organization_idx        ON public.video_scripts (organization_id);
CREATE INDEX planning_templates_organization_idx   ON public.planning_templates (organization_id);
CREATE INDEX monthly_reports_organization_idx       ON public.monthly_reports (organization_id);
CREATE INDEX client_documents_organization_idx      ON public.client_documents (organization_id);
CREATE INDEX notifications_organization_idx         ON public.notifications (organization_id);

-- ---------------------------------------------------------------------------
-- FUNÇÕES DE CONTEXTO DE ORGANIZAÇÃO
--
-- Decisão de arquitetura: RLS não depende de "organização ativa"/claim JWT.
-- A policy autoriza acesso a QUALQUER organização da qual o usuário seja
-- membro ativo, reavaliando organization_members a cada chamada. O "contexto
-- ativo" (profiles.active_organization_id) é só um filtro de UX no frontend,
-- nunca um mecanismo de segurança — a RLS é a barreira real.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_org_member(_organization_id UUID, _user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _organization_id
      AND user_id = _user_id
      AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.get_org_role(_organization_id UUID, _user_id UUID DEFAULT auth.uid())
RETURNS public.organization_member_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.organization_members
  WHERE organization_id = _organization_id AND user_id = _user_id AND status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin_or_owner(_organization_id UUID, _user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.get_org_role(_organization_id, _user_id) IN ('owner', 'admin')
$$;

CREATE OR REPLACE FUNCTION public.can_edit_org_content(_organization_id UUID, _user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.get_org_role(_organization_id, _user_id) IN ('owner', 'admin', 'manager', 'editor')
$$;

-- ---------------------------------------------------------------------------
-- TRIGGERS DE SINCRONIZAÇÃO — mantêm organization_id consistente nas tabelas
-- denormalizadas, copiando da tabela pai. Postgres não permite generated
-- column com subquery, por isso o trigger é a forma correta aqui.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_posts_organization_id()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id FROM public.plannings WHERE id = NEW.planning_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_posts_organization_id
BEFORE INSERT OR UPDATE OF planning_id ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.sync_posts_organization_id();

CREATE OR REPLACE FUNCTION public.sync_video_scripts_organization_id()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id FROM public.plannings WHERE id = NEW.planning_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_video_scripts_organization_id
BEFORE INSERT OR UPDATE OF planning_id ON public.video_scripts
FOR EACH ROW EXECUTE FUNCTION public.sync_video_scripts_organization_id();

-- notifications: se vier planning_id, organization_id é derivado dele;
-- se não vier planning_id, organization_id precisa ser enviado explicitamente
-- pelo app (ex: convite aceito, alerta de organização) — sem isso, falha.
CREATE OR REPLACE FUNCTION public.sync_notifications_organization_id()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.planning_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id FROM public.plannings WHERE id = NEW.planning_id;
  ELSIF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'notifications.organization_id é obrigatório quando planning_id não é informado';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_notifications_organization_id
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.sync_notifications_organization_id();

-- ---------------------------------------------------------------------------
-- PREVENÇÃO DE ORGANIZAÇÃO SEM OWNER
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_remove_last_owner()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_remaining_owners INT;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner' AND OLD.status = 'active')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND OLD.status = 'active'
         AND (NEW.role <> 'owner' OR NEW.status <> 'active')) THEN
    SELECT count(*) INTO v_remaining_owners
    FROM public.organization_members
    WHERE organization_id = OLD.organization_id
      AND role = 'owner' AND status = 'active'
      AND id <> OLD.id;
    IF v_remaining_owners = 0 THEN
      RAISE EXCEPTION 'A organização precisa de pelo menos um owner ativo';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prevent_remove_last_owner
BEFORE UPDATE OR DELETE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.prevent_remove_last_owner();

COMMIT;
