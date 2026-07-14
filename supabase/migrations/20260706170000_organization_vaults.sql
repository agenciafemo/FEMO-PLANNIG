-- ============================================================================
-- COFRE DE ACESSOS POR ORGANIZAÇÃO — permissão explícita por usuário
--
-- ⚠️ NÃO APLICADA. Preparada apenas para revisão. Substitui integralmente as
-- versões anteriores desta mesma migration (nenhuma delas foi aplicada em
-- lugar nenhum — só existiram como arquivo local nesta conversa). Independente
-- das migrations multi-tenant (20260703120000/100/200): não altera nenhuma
-- linha delas, só reaproveita organizations, clients, organization_members e
-- is_org_member / get_org_role / is_org_admin_or_owner já existentes.
--
-- MUDANÇA DE MODELO NESTA VERSÃO: acesso ao cofre não é mais amarrado ao role
-- de organização (owner/admin/manager/editor/viewer). Owner/admin sempre têm
-- acesso total (são quem administra o cofre), mas qualquer outro membro da
-- organização (inclusive manager, editor ou viewer) só acessa se tiver uma
-- linha explícita em organization_vault_members com a permissão marcada.
-- A senha mestre agora é OPCIONAL por cofre (require_master_password): se
-- ligada, cada usuário autorizado precisa desbloquear na própria sessão
-- (organization_vault_unlock_sessions, por user_id — nunca global); se
-- desligada, login normal + permissão já bastam, mas toda ação continua
-- gerando log.
--
-- ADIÇÕES MINHAS ALÉM DO MODELO SUGERIDO (documentadas aqui e na resposta):
--   - organization_vaults.failed_attempts / locked_until: lockout progressivo
--     contra força bruta na senha mestre. O modelo sugerido não tinha essas
--     colunas; sem elas, um invasor pode tentar senhas indefinidamente.
--   - Ação de log 'vault_settings_updated', 'vault_member_granted',
--     'vault_member_revoked': o modelo listava só as ações ligadas a
--     credencial/desbloqueio; achei importante auditar quem mudou
--     configurações do cofre e quem ganhou/perdeu acesso.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ---------------------------------------------------------------------------
-- ORGANIZATION_VAULTS — um por organização. master_password_hash/kdf_salt só
-- existem se require_master_password = true (CHECK abaixo garante isso).
-- dek_secret_id sempre existe, independente da senha mestre: a criptografia
-- das senhas dos clientes não depende da senha mestre estar ativa.
-- ---------------------------------------------------------------------------
CREATE TABLE public.organization_vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  master_password_hash TEXT,
  kdf_salt TEXT,
  require_master_password BOOLEAN NOT NULL DEFAULT true,
  unlock_duration_minutes INT NOT NULL DEFAULT 15 CHECK (unlock_duration_minutes BETWEEN 1 AND 1440),
  dek_secret_id UUID NOT NULL REFERENCES vault.secrets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CONSTRAINT master_password_required_if_enabled
    CHECK (require_master_password = false OR (master_password_hash IS NOT NULL AND kdf_salt IS NOT NULL))
);

COMMENT ON COLUMN public.organization_vaults.master_password_hash IS
  'Hash bcrypt (pgcrypto) de (senha_mestre || kdf_salt). NULL quando require_master_password = false. Não recuperável — só verificável.';
COMMENT ON COLUMN public.organization_vaults.dek_secret_id IS
  'Aponta para vault.secrets(id): chave simétrica usada para criptografar client_credentials.password_encrypted desta organização. Existe sempre, mesmo com require_master_password = false.';
COMMENT ON TABLE public.organization_vaults IS
  'Um cofre por organização. Sem policy de INSERT/UPDATE/DELETE — só via RPCs desta migration.';

ALTER TABLE public.organization_vaults ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_organization_vaults_updated_at BEFORE UPDATE ON public.organization_vaults
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- ORGANIZATION_VAULT_MEMBERS — quem, além de owner/admin (que sempre têm
-- acesso total), pode acessar o cofre e com quais permissões.
-- ---------------------------------------------------------------------------
CREATE TABLE public.organization_vault_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vault_id UUID NOT NULL REFERENCES public.organization_vaults(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  can_view BOOLEAN NOT NULL DEFAULT false,
  can_manage BOOLEAN NOT NULL DEFAULT false,
  can_reveal BOOLEAN NOT NULL DEFAULT false,
  can_manage_settings BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

COMMENT ON TABLE public.organization_vault_members IS
  'Concessão explícita de acesso ao cofre para membros que não são owner/admin (esses já têm acesso total por definição). Só gerenciada por set_vault_member_access / revoke_vault_member_access, restritas a owner/admin.';

ALTER TABLE public.organization_vault_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX organization_vault_members_organization_idx ON public.organization_vault_members (organization_id);

CREATE TRIGGER update_organization_vault_members_updated_at BEFORE UPDATE ON public.organization_vault_members
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- vault_id sempre derivado de organization_id — nunca informado manualmente
-- (reaproveitado também em organization_vault_unlock_sessions abaixo).
CREATE OR REPLACE FUNCTION public.sync_vault_id_from_organization()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT id INTO NEW.vault_id FROM public.organization_vaults WHERE organization_id = NEW.organization_id;
  IF NEW.vault_id IS NULL THEN
    RAISE EXCEPTION 'Esta organização ainda não tem cofre';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_vault_members_vault_id
BEFORE INSERT OR UPDATE OF organization_id, vault_id ON public.organization_vault_members
FOR EACH ROW EXECUTE FUNCTION public.sync_vault_id_from_organization();

-- ---------------------------------------------------------------------------
-- ORGANIZATION_VAULT_UNLOCK_SESSIONS — desbloqueio POR USUÁRIO. Um usuário
-- desbloquear nunca libera para outro. Cada unlock revoga a sessão anterior
-- do mesmo usuário e insere uma linha nova (histórico completo preservado
-- para auditoria, em vez de sobrescrever).
-- ---------------------------------------------------------------------------
CREATE TABLE public.organization_vault_unlock_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vault_id UUID NOT NULL REFERENCES public.organization_vaults(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organization_vault_unlock_sessions IS
  'Sessão de desbloqueio por usuário. Nunca é global para a organização. Uma sessão só é considerada ativa quando revoked_at IS NULL AND expires_at > now() — checado sempre em código (vault_permission_ok), nunca só pelo índice, porque now() não é IMMUTABLE e não pode entrar no predicado de um índice parcial.';

ALTER TABLE public.organization_vault_unlock_sessions ENABLE ROW LEVEL SECURITY;

CREATE INDEX organization_vault_unlock_sessions_lookup_idx
  ON public.organization_vault_unlock_sessions (vault_id, user_id, expires_at) WHERE revoked_at IS NULL;

-- Segurança extra contra corrida (duas chamadas simultâneas de unlock pelo
-- mesmo usuário): garante no máximo uma sessão não revogada por usuário/cofre.
CREATE UNIQUE INDEX organization_vault_unlock_sessions_active_unique
  ON public.organization_vault_unlock_sessions (vault_id, user_id) WHERE revoked_at IS NULL;

-- Deriva vault_id sempre do organization_id também nas sessões. Incluir
-- vault_id no gatilho impede que uma escrita privilegiada force combinação
-- organização/cofre inconsistente.
CREATE TRIGGER sync_vault_unlock_sessions_vault_id
BEFORE INSERT OR UPDATE OF organization_id, vault_id ON public.organization_vault_unlock_sessions
FOR EACH ROW EXECUTE FUNCTION public.sync_vault_id_from_organization();

-- ---------------------------------------------------------------------------
-- CLIENT_CREDENTIALS
-- ---------------------------------------------------------------------------
CREATE TABLE public.client_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  vault_id UUID NOT NULL REFERENCES public.organization_vaults(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  url TEXT,
  username TEXT,
  password_encrypted BYTEA NOT NULL,
  notes TEXT,
  two_factor_notes_encrypted BYTEA,
  responsible_user_id UUID REFERENCES auth.users(id),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

COMMENT ON COLUMN public.client_credentials.password_encrypted IS
  'extensions.pgp_sym_encrypt(senha, DEK_da_organizacao). Nunca lido por SELECT direto — só dentro de reveal_client_credential. A listagem usa client_credentials_view, que nem inclui esta coluna.';
COMMENT ON COLUMN public.client_credentials.notes IS
  'Observações não sensíveis. Nunca guardar senha ou segredo aqui.';
COMMENT ON COLUMN public.client_credentials.two_factor_notes_encrypted IS
  'Notas sensíveis de 2FA criptografadas com a mesma DEK da organização. Nunca incluídas em listagens; somente reveladas pela RPC protegida por permissão reveal.';
COMMENT ON TABLE public.client_credentials IS
  'Sem policy de INSERT/UPDATE/DELETE — toda mutação passa pelas RPCs, que exigem permissão (view/manage/reveal) via vault_permission_ok e sempre gravam log em credential_access_logs.';

ALTER TABLE public.client_credentials ENABLE ROW LEVEL SECURITY;

CREATE INDEX client_credentials_organization_idx ON public.client_credentials (organization_id);
CREATE INDEX client_credentials_client_idx ON public.client_credentials (client_id);
CREATE INDEX client_credentials_vault_idx ON public.client_credentials (vault_id);
CREATE INDEX client_credentials_active_idx ON public.client_credentials (client_id) WHERE deleted_at IS NULL;

CREATE TRIGGER update_client_credentials_updated_at BEFORE UPDATE ON public.client_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.sync_client_credentials_organization_id()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT c.organization_id, ov.id
  INTO NEW.organization_id, NEW.vault_id
  FROM public.clients c
  JOIN public.organization_vaults ov ON ov.organization_id = c.organization_id
  WHERE c.id = NEW.client_id;

  IF NEW.organization_id IS NULL OR NEW.vault_id IS NULL THEN
    RAISE EXCEPTION 'Cliente sem organização ou sem cofre compatível';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_client_credentials_organization_id
BEFORE INSERT OR UPDATE OF client_id, organization_id, vault_id ON public.client_credentials
FOR EACH ROW EXECUTE FUNCTION public.sync_client_credentials_organization_id();

-- ---------------------------------------------------------------------------
-- CREDENTIAL_ACCESS_LOGS — append-only
-- ---------------------------------------------------------------------------
CREATE TABLE public.credential_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  vault_id UUID REFERENCES public.organization_vaults(id) ON DELETE CASCADE,
  credential_id UUID REFERENCES public.client_credentials(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL CHECK (action IN (
    'vault_created', 'vault_settings_updated', 'vault_member_granted', 'vault_member_revoked',
    'vault_unlocked', 'vault_failed_unlock',
    'created', 'updated', 'revealed', 'copied', 'deleted', 'imported'
  )),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.credential_access_logs IS
  'Log de auditoria do cofre. client_id/vault_id/credential_id ficam NULL em eventos de nível de cofre. Append-only: sem UPDATE/DELETE, só INSERT via RPC.';
-- DECISÃO PENDENTE: os FKs abaixo mantêm ON DELETE CASCADE por enquanto.
-- Para auditoria de longo prazo, recomenda-se futuramente preservar snapshots
-- imutáveis (organization/client/credential) e trocar os relacionamentos
-- opcionais por ON DELETE SET NULL. Não alterado aqui sem definir a política
-- de retenção e exclusão da organização.

ALTER TABLE public.credential_access_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX credential_access_logs_organization_idx ON public.credential_access_logs (organization_id, created_at DESC);
CREATE INDEX credential_access_logs_credential_idx ON public.credential_access_logs (credential_id, created_at DESC);
CREATE INDEX credential_access_logs_user_idx ON public.credential_access_logs (user_id, created_at DESC);

-- ============================================================================
-- FUNÇÕES DE PERMISSÃO
--
-- Owner/admin sempre têm acesso total (view/manage/reveal/manage_settings) —
-- não precisam de linha em organization_vault_members. Qualquer outro role
-- (inclusive manager) só tem a permissão específica se organization_vault_members
-- tiver a flag correspondente marcada E o usuário ainda for membro ativo da
-- organização (is_org_member revalida isso a cada chamada).
-- ============================================================================

-- Resolve organization_id a partir de vault_id — usada por toda RPC de
-- configuração/membro/desbloqueio, que recebe vault_id do frontend (nunca
-- organization_id direto, salvo create_organization_vault, que é o bootstrap
-- sem vault_id ainda existente).
CREATE OR REPLACE FUNCTION public.resolve_org_id_from_vault(_vault_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.organization_vaults WHERE id = _vault_id
$$;

CREATE OR REPLACE FUNCTION public.vault_can_view(_organization_id UUID, _user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_org_member(_organization_id, _user_id) AND (
    public.is_org_admin_or_owner(_organization_id, _user_id)
    OR EXISTS (SELECT 1 FROM public.organization_vault_members m WHERE m.organization_id = _organization_id AND m.user_id = _user_id AND m.can_view)
  )
$$;

CREATE OR REPLACE FUNCTION public.vault_can_manage(_organization_id UUID, _user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_org_member(_organization_id, _user_id) AND (
    public.is_org_admin_or_owner(_organization_id, _user_id)
    OR EXISTS (SELECT 1 FROM public.organization_vault_members m WHERE m.organization_id = _organization_id AND m.user_id = _user_id AND m.can_manage)
  )
$$;

CREATE OR REPLACE FUNCTION public.vault_can_reveal(_organization_id UUID, _user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_org_member(_organization_id, _user_id) AND (
    public.is_org_admin_or_owner(_organization_id, _user_id)
    OR EXISTS (SELECT 1 FROM public.organization_vault_members m WHERE m.organization_id = _organization_id AND m.user_id = _user_id AND m.can_reveal)
  )
$$;

CREATE OR REPLACE FUNCTION public.vault_can_manage_settings(_organization_id UUID, _user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_org_member(_organization_id, _user_id) AND (
    public.is_org_admin_or_owner(_organization_id, _user_id)
    OR EXISTS (SELECT 1 FROM public.organization_vault_members m WHERE m.organization_id = _organization_id AND m.user_id = _user_id AND m.can_manage_settings)
  )
$$;

CREATE OR REPLACE FUNCTION public.vault_has_any_access(_organization_id UUID, _user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.vault_can_view(_organization_id, _user_id)
    OR public.vault_can_manage(_organization_id, _user_id)
    OR public.vault_can_reveal(_organization_id, _user_id)
    OR public.vault_can_manage_settings(_organization_id, _user_id)
$$;

-- Função central: permissão específica (view/manage/reveal/manage_settings) +,
-- se require_master_password = true, sessão de desbloqueio válida PARA O
-- MESMO user_id. Usada tanto pelas policies de RLS quanto pelas RPCs — única
-- fonte de verdade, nunca duplicada.
CREATE OR REPLACE FUNCTION public.vault_permission_ok(_organization_id UUID, _permission TEXT, _user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vault public.organization_vaults;
  v_flag BOOLEAN;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_vault FROM public.organization_vaults WHERE organization_id = _organization_id;
  IF v_vault.id IS NULL OR v_vault.status <> 'active' THEN
    RETURN false;
  END IF;

  v_flag := CASE _permission
    WHEN 'view' THEN public.vault_can_view(_organization_id, _user_id)
    WHEN 'manage' THEN public.vault_can_manage(_organization_id, _user_id)
    WHEN 'reveal' THEN public.vault_can_reveal(_organization_id, _user_id)
    WHEN 'manage_settings' THEN public.vault_can_manage_settings(_organization_id, _user_id)
    ELSE false
  END;
  IF NOT v_flag THEN
    RETURN false;
  END IF;

  IF v_vault.require_master_password THEN
    RETURN EXISTS (
      SELECT 1 FROM public.organization_vault_unlock_sessions s
      WHERE s.vault_id = v_vault.id AND s.user_id = _user_id
        AND s.revoked_at IS NULL AND s.expires_at > now()
    );
  END IF;

  RETURN true;
END;
$$;

-- Wrapper para RPCs: mesma checagem, mas lança exceção com mensagem e devolve
-- o vault_id (evita cada RPC repetir o SELECT em organization_vaults).
CREATE OR REPLACE FUNCTION public.assert_vault_permission(_organization_id UUID, _permission TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vault_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário';
  END IF;
  IF NOT public.vault_permission_ok(_organization_id, _permission) THEN
    RAISE EXCEPTION 'Sem permissão (%) para o cofre desta organização, ou cofre bloqueado', _permission;
  END IF;
  SELECT id INTO v_vault_id FROM public.organization_vaults WHERE organization_id = _organization_id;
  RETURN v_vault_id;
END;
$$;

-- Helper interno (nunca concedido a authenticated): lê a DEK do Vault.
CREATE OR REPLACE FUNCTION public.get_org_vault_dek(_vault_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ds.decrypted_secret
  FROM public.organization_vaults ov
  JOIN vault.decrypted_secrets ds ON ds.id = ov.dek_secret_id
  WHERE ov.id = _vault_id
$$;

-- Helpers internos nunca podem ser chamados diretamente por API. Revogar de
-- PUBLIC não basta no Supabase, pois default privileges podem conceder EXECUTE
-- diretamente a anon/authenticated.
REVOKE ALL ON FUNCTION public.sync_vault_id_from_organization() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_client_credentials_organization_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_org_id_from_vault(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_org_vault_dek(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_can_view(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_can_manage(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_can_reveal(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_can_manage_settings(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_has_any_access(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_permission_ok(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_vault_permission(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

-- Bloqueia acesso direto às tabelas por default privileges. Somente as três
-- tabelas de metadados abaixo recebem SELECT, sempre limitado pelas policies.
-- organization_vaults não é exposta diretamente: hash, salt e dek_secret_id
-- ficam acessíveis apenas internamente; o frontend usa a RPC sanitizada.
-- client_credentials também não recebe SELECT: nem a cifra pode sair do banco.
REVOKE ALL ON TABLE public.organization_vaults FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_vault_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_vault_unlock_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.client_credentials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.credential_access_logs FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.organization_vault_members TO authenticated;
GRANT SELECT ON TABLE public.organization_vault_unlock_sessions TO authenticated;
GRANT SELECT ON TABLE public.credential_access_logs TO authenticated;

-- Projeção interna sanitizada do status do cofre. A API não consulta a view
-- diretamente: get_organization_vault_status é a única porta pública e chama
-- os helpers revogados dentro de uma função SECURITY DEFINER controlada.
CREATE VIEW public.organization_vault_status
WITH (security_invoker = false) AS
SELECT
  ov.id AS vault_id,
  ov.organization_id,
  ov.status,
  ov.require_master_password,
  ov.unlock_duration_minutes,
  ov.locked_until,
  ov.created_at,
  EXISTS (
    SELECT 1 FROM public.organization_vault_unlock_sessions s
    WHERE s.vault_id = ov.id AND s.user_id = auth.uid() AND s.revoked_at IS NULL AND s.expires_at > now()
  ) AS is_unlocked_for_me
FROM public.organization_vaults ov
WHERE public.vault_has_any_access(ov.organization_id);

REVOKE ALL ON public.organization_vault_status FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_organization_vault_status(_organization_id UUID)
RETURNS TABLE (
  vault_id UUID,
  organization_id UUID,
  status TEXT,
  require_master_password BOOLEAN,
  unlock_duration_minutes INT,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  is_unlocked_for_me BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário';
  END IF;

  -- Não diferenciar "sem acesso" de "cofre inexistente" evita usar a RPC
  -- para enumerar organizações/cofres de outros tenants.
  IF NOT public.vault_has_any_access(_organization_id, auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ov.id,
    ov.organization_id,
    ov.status,
    ov.require_master_password,
    ov.unlock_duration_minutes,
    ov.locked_until,
    ov.created_at,
    EXISTS (
      SELECT 1
      FROM public.organization_vault_unlock_sessions session_row
      WHERE session_row.vault_id = ov.id
        AND session_row.user_id = auth.uid()
        AND session_row.revoked_at IS NULL
        AND session_row.expires_at > now()
    )
  FROM public.organization_vaults ov
  WHERE ov.organization_id = _organization_id;
END;
$$;

COMMENT ON FUNCTION public.get_organization_vault_status(UUID) IS
  'API pública sanitizada do status do Cofre. Retorna zero linhas sem acesso e nunca expõe hash, salt ou DEK.';

-- organization_vault_members: admin/owner veem tudo; qualquer usuário vê a
-- própria linha (para o frontend saber suas próprias permissões).
CREATE POLICY "vault_members_select" ON public.organization_vault_members FOR SELECT TO authenticated
  USING (public.is_org_admin_or_owner(organization_id) OR user_id = auth.uid());

-- organization_vault_unlock_sessions: mesma regra — admin/owner veem tudo,
-- usuário vê a própria sessão.
CREATE POLICY "vault_unlock_sessions_select" ON public.organization_vault_unlock_sessions FOR SELECT TO authenticated
  USING (public.is_org_admin_or_owner(organization_id) OR user_id = auth.uid());

-- Projeção interna sem password_encrypted e sem notas de 2FA. A view não é
-- concedida a nenhum role da API; list_client_credentials é a única porta
-- de leitura e aplica permissão + sessão de desbloqueio antes de listar.
CREATE VIEW public.client_credentials_view
WITH (security_invoker = true) AS
SELECT
  id, organization_id, client_id, vault_id, platform, url, username,
  notes, responsible_user_id,
  created_by, updated_by, created_at, updated_at
FROM public.client_credentials
WHERE deleted_at IS NULL;
-- Nunca inclui password_encrypted.

REVOKE ALL ON public.client_credentials_view FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_client_credentials(
  _organization_id UUID,
  _client_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  client_id UUID,
  vault_id UUID,
  platform TEXT,
  url TEXT,
  username TEXT,
  notes TEXT,
  responsible_user_id UUID,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_vault_permission(_organization_id, 'view');

  RETURN QUERY
  SELECT
    v.id, v.organization_id, v.client_id, v.vault_id, v.platform, v.url,
    v.username, v.notes, v.responsible_user_id, v.created_by, v.updated_by,
    v.created_at, v.updated_at
  FROM public.client_credentials_view v
  WHERE v.organization_id = _organization_id
    AND (_client_id IS NULL OR v.client_id = _client_id)
  ORDER BY v.platform, v.username;
END;
$$;

-- credential_access_logs: só owner/admin — trilha de auditoria de senha é
-- público restrito por natureza, mesmo que outro usuário tenha can_reveal.
CREATE POLICY "vault_admins_select_logs" ON public.credential_access_logs FOR SELECT TO authenticated
  USING (public.is_org_admin_or_owner(organization_id));

-- ============================================================================
-- RPCs — CICLO DE VIDA DO COFRE E CONFIGURAÇÃO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_organization_vault(
  _organization_id UUID,
  _require_master_password BOOLEAN DEFAULT true,
  _master_password TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_salt TEXT;
  v_hash TEXT;
  v_dek TEXT;
  v_dek_secret_id UUID;
  v_vault_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário';
  END IF;
  IF NOT public.is_org_admin_or_owner(_organization_id) THEN
    RAISE EXCEPTION 'Só owner ou admin pode criar o cofre da organização';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_vaults WHERE organization_id = _organization_id) THEN
    RAISE EXCEPTION 'Esta organização já tem um cofre';
  END IF;

  IF _require_master_password THEN
    IF length(coalesce(_master_password, '')) < 12 THEN
      RAISE EXCEPTION 'Senha mestre precisa ter pelo menos 12 caracteres';
    END IF;
    v_salt := encode(extensions.gen_random_bytes(16), 'hex');
    v_hash := extensions.crypt(_master_password || v_salt, extensions.gen_salt('bf', 12));
  END IF;

  v_dek := encode(extensions.gen_random_bytes(32), 'base64');
  v_dek_secret_id := vault.create_secret(
    v_dek,
    'org_vault_dek_' || _organization_id::text,
    'organization_vaults:' || _organization_id::text
  );

  INSERT INTO public.organization_vaults
    (organization_id, master_password_hash, kdf_salt, require_master_password, dek_secret_id, created_by)
  VALUES
    (_organization_id, v_hash, v_salt, _require_master_password, v_dek_secret_id, auth.uid())
  RETURNING id INTO v_vault_id;

  INSERT INTO public.credential_access_logs (organization_id, vault_id, user_id, action, metadata)
  VALUES (_organization_id, v_vault_id, auth.uid(), 'vault_created', jsonb_build_object('require_master_password', _require_master_password));

  RETURN v_vault_id;
END;
$$;

-- Liga/desliga a exigência de senha mestre (e troca a senha, se já existir).
-- Se já havia senha mestre ativa, exige a senha atual antes de trocar/desligar
-- (defesa extra contra sessão de admin sequestrada).
CREATE OR REPLACE FUNCTION public.set_vault_master_password_requirement(
  _vault_id UUID,
  _require BOOLEAN,
  _current_master_password TEXT DEFAULT NULL,
  _new_master_password TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vault public.organization_vaults;
  v_organization_id UUID;
  v_salt TEXT;
  v_hash TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário';
  END IF;

  SELECT * INTO v_vault FROM public.organization_vaults WHERE id = _vault_id FOR UPDATE;
  IF v_vault.id IS NULL THEN
    RAISE EXCEPTION 'Cofre não encontrado';
  END IF;
  v_organization_id := v_vault.organization_id;

  IF NOT public.is_org_admin_or_owner(v_organization_id) THEN
    RAISE EXCEPTION 'Só owner ou admin pode alterar a exigência de senha mestre';
  END IF;

  -- Quando a senha mestre já está ativa, configurações sensíveis exigem
  -- sessão desbloqueada. Isso evita usar esta RPC como oráculo ilimitado para
  -- testar senhas fora do fluxo de lockout.
  IF v_vault.require_master_password THEN
    PERFORM public.assert_vault_permission(v_organization_id, 'manage_settings');
  END IF;

  IF v_vault.require_master_password AND v_vault.master_password_hash IS NOT NULL THEN
    IF extensions.crypt(coalesce(_current_master_password, '') || v_vault.kdf_salt, v_vault.master_password_hash) <> v_vault.master_password_hash THEN
      RAISE EXCEPTION 'Senha mestre atual incorreta';
    END IF;
  END IF;

  IF _require THEN
    IF length(coalesce(_new_master_password, '')) < 12 THEN
      RAISE EXCEPTION 'Senha mestre precisa ter pelo menos 12 caracteres';
    END IF;
    v_salt := encode(extensions.gen_random_bytes(16), 'hex');
    v_hash := extensions.crypt(_new_master_password || v_salt, extensions.gen_salt('bf', 12));

    UPDATE public.organization_vaults
    SET require_master_password = true, master_password_hash = v_hash, kdf_salt = v_salt,
        failed_attempts = 0, locked_until = NULL
    WHERE id = v_vault.id;
  ELSE
    UPDATE public.organization_vaults
    SET require_master_password = false, master_password_hash = NULL, kdf_salt = NULL,
        failed_attempts = 0, locked_until = NULL
    WHERE id = v_vault.id;

    UPDATE public.organization_vault_unlock_sessions SET revoked_at = now()
    WHERE vault_id = v_vault.id AND revoked_at IS NULL;
  END IF;

  INSERT INTO public.credential_access_logs (organization_id, vault_id, user_id, action, metadata)
  VALUES (v_organization_id, v_vault.id, auth.uid(), 'vault_settings_updated', jsonb_build_object('require_master_password', _require));
END;
$$;

CREATE OR REPLACE FUNCTION public.update_vault_unlock_duration(_vault_id UUID, _unlock_duration_minutes INT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_organization_id UUID := public.resolve_org_id_from_vault(_vault_id);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário';
  END IF;
  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Cofre não encontrado';
  END IF;
  PERFORM public.assert_vault_permission(v_organization_id, 'manage_settings');
  IF _unlock_duration_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'Duração precisa estar entre 1 e 1440 minutos';
  END IF;

  UPDATE public.organization_vaults SET unlock_duration_minutes = _unlock_duration_minutes
  WHERE id = _vault_id;

  INSERT INTO public.credential_access_logs (organization_id, vault_id, user_id, action, metadata)
  VALUES (v_organization_id, _vault_id, auth.uid(), 'vault_settings_updated', jsonb_build_object('unlock_duration_minutes', _unlock_duration_minutes));
END;
$$;

-- ============================================================================
-- RPCs — PERMISSÕES POR USUÁRIO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_vault_member_access(
  _vault_id UUID,
  _user_id UUID,
  _can_view BOOLEAN DEFAULT false,
  _can_manage BOOLEAN DEFAULT false,
  _can_reveal BOOLEAN DEFAULT false,
  _can_manage_settings BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_organization_id UUID := public.resolve_org_id_from_vault(_vault_id);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário';
  END IF;
  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Cofre não encontrado';
  END IF;
  IF NOT public.is_org_admin_or_owner(v_organization_id) THEN
    RAISE EXCEPTION 'Só owner ou admin pode configurar acesso ao cofre';
  END IF;
  PERFORM public.assert_vault_permission(v_organization_id, 'manage_settings');
  IF NOT public.is_org_member(v_organization_id, _user_id) THEN
    RAISE EXCEPTION 'Usuário não é membro ativo desta organização';
  END IF;
  IF (_can_manage OR _can_reveal OR _can_manage_settings) AND NOT _can_view THEN
    RAISE EXCEPTION 'Permissões manage/reveal/manage_settings exigem can_view';
  END IF;

  INSERT INTO public.organization_vault_members
    (organization_id, vault_id, user_id, can_view, can_manage, can_reveal, can_manage_settings, created_by)
  VALUES
    (v_organization_id, _vault_id, _user_id, _can_view, _can_manage, _can_reveal, _can_manage_settings, auth.uid())
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    can_view = _can_view, can_manage = _can_manage, can_reveal = _can_reveal,
    can_manage_settings = _can_manage_settings, updated_at = now();

  INSERT INTO public.credential_access_logs (organization_id, vault_id, user_id, action, metadata)
  VALUES (v_organization_id, _vault_id, auth.uid(), 'vault_member_granted', jsonb_build_object(
    'target_user_id', _user_id, 'can_view', _can_view, 'can_manage', _can_manage,
    'can_reveal', _can_reveal, 'can_manage_settings', _can_manage_settings
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_vault_member_access(_vault_id UUID, _user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_organization_id UUID := public.resolve_org_id_from_vault(_vault_id);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário';
  END IF;
  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Cofre não encontrado';
  END IF;
  IF NOT public.is_org_admin_or_owner(v_organization_id) THEN
    RAISE EXCEPTION 'Só owner ou admin pode revogar acesso ao cofre';
  END IF;
  PERFORM public.assert_vault_permission(v_organization_id, 'manage_settings');

  DELETE FROM public.organization_vault_members WHERE vault_id = _vault_id AND user_id = _user_id;

  UPDATE public.organization_vault_unlock_sessions SET revoked_at = now()
  WHERE vault_id = _vault_id AND user_id = _user_id AND revoked_at IS NULL;

  INSERT INTO public.credential_access_logs (organization_id, vault_id, user_id, action, metadata)
  VALUES (v_organization_id, _vault_id, auth.uid(), 'vault_member_revoked', jsonb_build_object('target_user_id', _user_id));
END;
$$;

-- ============================================================================
-- RPCs — DESBLOQUEIO (POR USUÁRIO)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.unlock_organization_vault(_vault_id UUID, _master_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vault public.organization_vaults;
  v_organization_id UUID;
  v_expires TIMESTAMPTZ;
  v_failed_attempts INT;
  v_locked_until TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário';
  END IF;

  SELECT * INTO v_vault FROM public.organization_vaults WHERE id = _vault_id FOR UPDATE;
  IF v_vault.id IS NULL THEN
    RAISE EXCEPTION 'Cofre não encontrado';
  END IF;
  v_organization_id := v_vault.organization_id;

  IF v_vault.status <> 'active' THEN
    RAISE EXCEPTION 'Cofre suspenso — contate um administrador';
  END IF;
  IF NOT v_vault.require_master_password THEN
    RAISE EXCEPTION 'Este cofre não exige senha mestre — acesso já é liberado pelo login normal e pela permissão concedida';
  END IF;
  IF NOT public.vault_has_any_access(v_organization_id) THEN
    RAISE EXCEPTION 'Você não tem acesso a este cofre';
  END IF;
  IF v_vault.locked_until IS NOT NULL AND v_vault.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'vault_locked',
      'locked_until', v_vault.locked_until,
      'failed_attempts', v_vault.failed_attempts
    );
  END IF;

  IF extensions.crypt(_master_password || v_vault.kdf_salt, v_vault.master_password_hash) <> v_vault.master_password_hash THEN
    UPDATE public.organization_vaults
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
    WHERE id = v_vault.id
    RETURNING failed_attempts, locked_until INTO v_failed_attempts, v_locked_until;

    INSERT INTO public.credential_access_logs (organization_id, vault_id, user_id, action, metadata)
    VALUES (
      v_organization_id,
      v_vault.id,
      auth.uid(),
      'vault_failed_unlock',
      jsonb_build_object('failed_attempts', v_failed_attempts, 'locked_until', v_locked_until)
    );

    -- Não lançar exceção aqui: RAISE reverteria o contador, o lockout e o
    -- log gravados acima. O frontend trata ok=false como erro de desbloqueio.
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'invalid_master_password',
      'failed_attempts', v_failed_attempts,
      'locked_until', v_locked_until
    );
  END IF;

  v_expires := now() + (v_vault.unlock_duration_minutes * interval '1 minute');

  -- Revoga a sessão ativa anterior DO MESMO usuário (nunca mexe na sessão de
  -- outro usuário) e insere uma linha nova — histórico completo preservado.
  UPDATE public.organization_vault_unlock_sessions
  SET revoked_at = now()
  WHERE vault_id = v_vault.id AND user_id = auth.uid() AND revoked_at IS NULL;

  INSERT INTO public.organization_vault_unlock_sessions (organization_id, vault_id, user_id, unlocked_at, expires_at)
  VALUES (v_organization_id, v_vault.id, auth.uid(), now(), v_expires);

  UPDATE public.organization_vaults SET failed_attempts = 0, locked_until = NULL WHERE id = v_vault.id;

  INSERT INTO public.credential_access_logs (organization_id, vault_id, user_id, action)
  VALUES (v_organization_id, v_vault.id, auth.uid(), 'vault_unlocked');

  RETURN jsonb_build_object('ok', true, 'expires_at', v_expires);
END;
$$;

-- Encerra só a sessão do próprio usuário chamando (nunca a de outro).
CREATE OR REPLACE FUNCTION public.lock_organization_vault(_vault_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário';
  END IF;

  UPDATE public.organization_vault_unlock_sessions
  SET revoked_at = now()
  WHERE vault_id = _vault_id AND user_id = auth.uid() AND revoked_at IS NULL;
END;
$$;

-- ============================================================================
-- RPCs — CREDENCIAIS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_client_credential(
  _client_id UUID,
  _platform TEXT,
  _password TEXT,
  _url TEXT DEFAULT NULL,
  _username TEXT DEFAULT NULL,
  _notes TEXT DEFAULT NULL,
  _two_factor_notes TEXT DEFAULT NULL,
  _responsible_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_vault_id UUID;
  v_dek TEXT;
  v_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM public.clients WHERE id = _client_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;
  IF length(trim(coalesce(_platform, ''))) = 0 THEN
    RAISE EXCEPTION 'Plataforma é obrigatória';
  END IF;
  IF length(coalesce(_password, '')) = 0 THEN
    RAISE EXCEPTION 'Senha é obrigatória';
  END IF;
  IF _responsible_user_id IS NOT NULL AND NOT public.is_org_member(v_org_id, _responsible_user_id) THEN
    RAISE EXCEPTION 'Responsável precisa ser membro ativo da organização';
  END IF;

  v_vault_id := public.assert_vault_permission(v_org_id, 'manage');

  v_dek := public.get_org_vault_dek(v_vault_id);

  INSERT INTO public.client_credentials
    (organization_id, client_id, vault_id, platform, url, username, password_encrypted, notes, two_factor_notes_encrypted, responsible_user_id, created_by)
  VALUES
    (
      v_org_id,
      _client_id,
      v_vault_id,
      _platform,
      _url,
      _username,
      extensions.pgp_sym_encrypt(_password, v_dek),
      _notes,
      CASE WHEN _two_factor_notes IS NULL THEN NULL ELSE extensions.pgp_sym_encrypt(_two_factor_notes, v_dek) END,
      _responsible_user_id,
      auth.uid()
    )
  RETURNING id INTO v_id;

  INSERT INTO public.credential_access_logs (organization_id, client_id, vault_id, credential_id, user_id, action)
  VALUES (v_org_id, _client_id, v_vault_id, v_id, auth.uid(), 'created');

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_client_credential(
  _id UUID,
  _platform TEXT DEFAULT NULL,
  _url TEXT DEFAULT NULL,
  _username TEXT DEFAULT NULL,
  _notes TEXT DEFAULT NULL,
  _two_factor_notes TEXT DEFAULT NULL,
  _responsible_user_id UUID DEFAULT NULL,
  _new_password TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.client_credentials;
  v_dek TEXT;
BEGIN
  SELECT * INTO v_row FROM public.client_credentials WHERE id = _id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Credencial não encontrada';
  END IF;

  PERFORM public.assert_vault_permission(v_row.organization_id, 'manage');

  IF _platform IS NOT NULL AND length(trim(_platform)) = 0 THEN
    RAISE EXCEPTION 'Plataforma não pode ficar vazia';
  END IF;
  IF _new_password IS NOT NULL AND length(_new_password) = 0 THEN
    RAISE EXCEPTION 'Senha não pode ficar vazia';
  END IF;
  IF _responsible_user_id IS NOT NULL
     AND NOT public.is_org_member(v_row.organization_id, _responsible_user_id) THEN
    RAISE EXCEPTION 'Responsável precisa ser membro ativo da organização';
  END IF;

  IF _new_password IS NOT NULL OR _two_factor_notes IS NOT NULL THEN
    v_dek := public.get_org_vault_dek(v_row.vault_id);
  END IF;

  UPDATE public.client_credentials SET
    platform = COALESCE(_platform, platform),
    url = COALESCE(_url, url),
    username = COALESCE(_username, username),
    notes = COALESCE(_notes, notes),
    two_factor_notes_encrypted = CASE
      WHEN _two_factor_notes IS NOT NULL THEN extensions.pgp_sym_encrypt(_two_factor_notes, v_dek)
      ELSE two_factor_notes_encrypted
    END,
    responsible_user_id = COALESCE(_responsible_user_id, responsible_user_id),
    password_encrypted = CASE WHEN _new_password IS NOT NULL THEN extensions.pgp_sym_encrypt(_new_password, v_dek) ELSE password_encrypted END,
    updated_by = auth.uid()
  WHERE id = _id;

  INSERT INTO public.credential_access_logs (organization_id, client_id, vault_id, credential_id, user_id, action)
  VALUES (v_row.organization_id, v_row.client_id, v_row.vault_id, _id, auth.uid(), 'updated');
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_client_credential(_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.client_credentials;
BEGIN
  SELECT * INTO v_row FROM public.client_credentials WHERE id = _id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Credencial não encontrada';
  END IF;

  PERFORM public.assert_vault_permission(v_row.organization_id, 'manage');

  UPDATE public.client_credentials SET deleted_at = now(), updated_by = auth.uid() WHERE id = _id;

  INSERT INTO public.credential_access_logs (organization_id, client_id, vault_id, credential_id, user_id, action)
  VALUES (v_row.organization_id, v_row.client_id, v_row.vault_id, _id, auth.uid(), 'deleted');
END;
$$;

-- Única forma de ler senha/notas de 2FA em texto puro. Exige 'reveal' e
-- registra um único evento de auditoria para a revelação dos segredos.
CREATE OR REPLACE FUNCTION public.reveal_client_credential(_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.client_credentials;
  v_dek TEXT;
  v_password TEXT;
  v_two_factor_notes TEXT;
BEGIN
  SELECT * INTO v_row FROM public.client_credentials WHERE id = _id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Credencial não encontrada';
  END IF;

  PERFORM public.assert_vault_permission(v_row.organization_id, 'reveal');

  v_dek := public.get_org_vault_dek(v_row.vault_id);
  v_password := extensions.pgp_sym_decrypt(v_row.password_encrypted, v_dek);
  v_two_factor_notes := CASE
    WHEN v_row.two_factor_notes_encrypted IS NULL THEN NULL
    ELSE extensions.pgp_sym_decrypt(v_row.two_factor_notes_encrypted, v_dek)
  END;

  INSERT INTO public.credential_access_logs (organization_id, client_id, vault_id, credential_id, user_id, action)
  VALUES (v_row.organization_id, v_row.client_id, v_row.vault_id, _id, auth.uid(), 'revealed');

  RETURN jsonb_build_object(
    'password', v_password,
    'two_factor_notes', v_two_factor_notes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.log_client_credential_copy(_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.client_credentials;
BEGIN
  SELECT * INTO v_row FROM public.client_credentials WHERE id = _id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Credencial não encontrada';
  END IF;

  PERFORM public.assert_vault_permission(v_row.organization_id, 'reveal');

  INSERT INTO public.credential_access_logs (organization_id, client_id, vault_id, credential_id, user_id, action)
  VALUES (v_row.organization_id, v_row.client_id, v_row.vault_id, _id, auth.uid(), 'copied');
END;
$$;

REVOKE ALL ON FUNCTION public.list_client_credentials(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_organization_vault_status(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_organization_vault(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_vault_master_password_requirement(UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_vault_unlock_duration(UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_vault_member_access(UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_vault_member_access(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unlock_organization_vault(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_organization_vault(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_client_credential(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_client_credential(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.soft_delete_client_credential(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reveal_client_credential(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_client_credential_copy(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_client_credentials(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_vault_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_vault(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_vault_master_password_requirement(UUID, BOOLEAN, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_vault_unlock_duration(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_vault_member_access(UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_vault_member_access(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_organization_vault(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_organization_vault(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_client_credential(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_client_credential(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_client_credential(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_client_credential(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_client_credential_copy(UUID) TO authenticated;

-- ============================================================================
-- IMPORTAÇÃO FUTURA — NÃO IMPLEMENTADA NESTA MIGRATION
--
-- RPC futura import_client_credentials(_client_id, _rows JSONB) recebendo só
-- _client_id (nunca organization_id direto) — o cofre de destino é resolvido
-- do cliente, exatamente como create_client_credential. Cada linha vira uma
-- inserção equivalente, logada como 'imported'. O Excel da FEMO só poderá
-- importar para client_id's que pertencem à organização FEMO; outra agência
-- repete o processo com os client_id's dela, para o cofre dela — nunca há
-- como um import de uma organização escrever no cofre de outra, porque a RPC
-- nem aceita organization_id como parâmetro. Nada disso está implementado
-- aqui — ver detalhe na resposta desta conversa.
-- ============================================================================

COMMIT;
