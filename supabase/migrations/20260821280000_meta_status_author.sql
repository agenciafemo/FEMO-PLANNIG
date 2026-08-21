-- ============================================================================
-- get_client_meta_connection_status passa a devolver QUEM autorizou a conexão.
--
-- É o que permite a ficha do cliente mostrar "Conectado por: Fulano" e, com
-- isso, enxergar quais clientes ainda dependem da conta da agência durante a
-- migração para conta própria por cliente.
--
-- CREATE OR REPLACE não basta aqui: mudar o RETURNS TABLE exige recriar. Vai em
-- transação para não deixar a função ausente se algo falhar no meio — o botão
-- de conexão da ficha do cliente depende dela.
-- Continua sem devolver segredo algum (nem secret id, nem token, nem state).
-- Idempotente.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_client_meta_connection_status(UUID);

CREATE OR REPLACE FUNCTION public.get_client_meta_connection_status(_client_id UUID)
RETURNS TABLE (
  client_id UUID,
  organization_id UUID,
  can_manage BOOLEAN,
  connection_id UUID,
  connection_status TEXT,
  connected_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  token_expires_at TIMESTAMPTZ,
  granted_scopes TEXT[],
  last_error_code TEXT,
  meta_user_name TEXT,
  channel_id UUID,
  channel_type TEXT,
  external_account_id TEXT,
  display_name TEXT,
  username TEXT,
  account_type TEXT,
  channel_status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_organization_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT c.organization_id
  INTO v_organization_id
  FROM public.clients c
  WHERE c.id = _client_id;

  IF v_organization_id IS NULL
     OR NOT public.is_org_member(v_organization_id, auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.organization_id,
    public.meta_can_manage_connection(c.organization_id, auth.uid()),
    mc.id,
    COALESCE(mc.status, 'not_connected'),
    mc.connected_at,
    mc.disconnected_at,
    mc.last_verified_at,
    mc.token_expires_at,
    COALESCE(mc.granted_scopes, ARRAY[]::TEXT[]),
    mc.last_error_code,
    mc.meta_user_name,
    mcc.id,
    mcc.channel_type,
    mcc.external_account_id,
    mcc.display_name,
    mcc.username,
    mcc.account_type,
    mcc.status
  FROM public.clients c
  LEFT JOIN LATERAL (
    SELECT candidate.*
    FROM public.meta_connections candidate
    WHERE candidate.client_id = c.id
    ORDER BY
      CASE candidate.status
        WHEN 'active' THEN 0
        WHEN 'pending' THEN 1
        WHEN 'reauth_required' THEN 2
        WHEN 'error' THEN 3
        ELSE 4
      END,
      candidate.created_at DESC
    LIMIT 1
  ) mc ON true
  LEFT JOIN public.meta_connection_channels mcc
    ON mcc.connection_id = mc.id
   AND mcc.status <> 'disconnected'
  WHERE c.id = _client_id
  ORDER BY mcc.channel_type, mcc.display_name;
END;
$$;

COMMENT ON FUNCTION public.get_client_meta_connection_status(UUID) IS
  'Sanitized Meta connection status for active organization members. No Vault secret id, token, OAuth state/code, App Secret, or raw Meta response is returned.';

-- Mesmo par REVOKE/GRANT da migration original: recriar a função descarta os
-- privilégios anteriores, então eles precisam ser reaplicados aqui.
REVOKE ALL ON FUNCTION public.get_client_meta_connection_status(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_meta_connection_status(UUID)
  TO authenticated;

COMMIT;
