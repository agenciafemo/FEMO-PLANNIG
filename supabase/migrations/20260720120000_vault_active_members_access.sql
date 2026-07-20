-- ============================================================================
-- Cofre — acesso por membership ativo, sem concessoes individuais
--
-- Modelo:
--   view            -> qualquer membro ativo da organizacao
--   reveal / copy   -> qualquer membro ativo da organizacao
--   manage          -> somente owner/admin ativo
--   manage_settings -> somente owner/admin ativo
--
-- A senha mestre, as sessoes individuais de desbloqueio, o lockout e a
-- criptografia nao sao alterados por esta migration.
-- ============================================================================

BEGIN;

-- Falhar cedo caso a migration base do Cofre ou os helpers multitenant nao
-- estejam presentes. Nenhum objeto e alterado se qualquer dependencia faltar.
DO $$
BEGIN
  IF to_regprocedure('public.is_org_member(uuid,uuid)') IS NULL
     OR to_regprocedure('public.is_org_admin_or_owner(uuid,uuid)') IS NULL
     OR to_regprocedure('public.vault_permission_ok(uuid,text,uuid)') IS NULL
     OR to_regprocedure('public.vault_has_any_access(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Dependencias do modelo de acesso do Cofre nao encontradas';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.vault_can_view(
  _organization_id UUID,
  _user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_org_member(_organization_id, _user_id)
$$;

CREATE OR REPLACE FUNCTION public.vault_can_reveal(
  _organization_id UUID,
  _user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_org_member(_organization_id, _user_id)
$$;

CREATE OR REPLACE FUNCTION public.vault_can_manage(
  _organization_id UUID,
  _user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_org_member(_organization_id, _user_id)
    AND public.is_org_admin_or_owner(_organization_id, _user_id)
$$;

CREATE OR REPLACE FUNCTION public.vault_can_manage_settings(
  _organization_id UUID,
  _user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_org_member(_organization_id, _user_id)
    AND public.is_org_admin_or_owner(_organization_id, _user_id)
$$;

-- Os helpers permanecem internos. As RPCs publicas do Cofre os chamam dentro
-- de funcoes SECURITY DEFINER; roles da API nunca precisam executa-los direto.
REVOKE ALL ON FUNCTION public.vault_can_view(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_can_reveal(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_can_manage(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_can_manage_settings(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- O modelo nao usa mais concessoes individuais. Os objetos permanecem para
-- compatibilidade/historico, mas deixam de ser uma API acessivel. Nenhuma linha
-- de organization_vault_members e apagada ou alterada.
REVOKE ALL ON FUNCTION public.set_vault_member_access(
  UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.revoke_vault_member_access(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.vault_can_view(UUID, UUID) IS
  'Cofre: qualquer membro ativo da organizacao pode visualizar apos desbloqueio.';
COMMENT ON FUNCTION public.vault_can_reveal(UUID, UUID) IS
  'Cofre: qualquer membro ativo da organizacao pode revelar/copiar apos desbloqueio.';
COMMENT ON FUNCTION public.vault_can_manage(UUID, UUID) IS
  'Cofre: somente owner/admin ativo pode criar, atualizar ou remover credenciais.';
COMMENT ON FUNCTION public.vault_can_manage_settings(UUID, UUID) IS
  'Cofre: somente owner/admin ativo pode alterar configuracoes.';

COMMIT;
