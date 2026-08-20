-- ============================================================================
-- Permissão cirúrgica: quem tem a função "Tráfego Pago" pode gerenciar as
-- conexões Meta (conectar / reconectar / desconectar) — SEM ganhar acesso de
-- manager em nada mais. As funções da equipe continuam, por padrão, sem
-- conceder acesso; esta é a única exceção e vale só para conexões Meta.
--
-- Atualiza meta_can_manage_connection (usada pelo botão via
-- get_client_meta_connection_status e pelas policies de auditoria). A checagem
-- equivalente no servidor (Edge Functions) é feita em _shared/meta-auth.ts.
-- Idempotente (CREATE OR REPLACE preserva os REVOKE/GRANT existentes).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.meta_can_manage_connection(
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
    AND (
      public.get_org_role(_organization_id, _user_id) IN ('owner', 'admin', 'manager')
      OR EXISTS (
        SELECT 1
        FROM public.team_member_functions mf
        JOIN public.team_function_tags t
          ON t.organization_id = mf.organization_id AND t.id = mf.tag_id
        WHERE mf.organization_id = _organization_id
          AND mf.user_id = _user_id
          AND (t.name ILIKE '%tráfego%' OR t.name ILIKE '%trafego%')
      )
    )
$$;
