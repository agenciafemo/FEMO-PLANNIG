-- ============================================================================
-- META ADS: guardar QUEM desconectou.
--
-- Em 14/09/2026 a conexão Meta Ads da agência apareceu desconectada às 13:01
-- (Brasília), duas horas depois de conectada. O único caminho que grava esse
-- status é o botão Desconectar + confirmação — mas o banco não guardava quem
-- clicou, e não havia como saber o que aconteceu.
--
-- Agora as duas conexões (agência e perfil do cliente) guardam
-- `disconnected_by`, e o status devolve a data e o NOME de quem desconectou
-- enquanto a conexão estiver desconectada. Reconectar não precisa limpar o
-- campo: o status só o mostra quando status = 'disconnected'.
--
-- As funções de status mudam as colunas de retorno: RETURNS TABLE diferente
-- exige DROP + CREATE, e DROP descarta os privilégios. Os GRANTs vêm logo
-- abaixo — já derrubou a conexão Meta uma vez (oauth_state_create_failed).
-- As de desconectar mantêm a assinatura: CREATE OR REPLACE.
--
-- Idempotente. Depende da 20260914150000 e da 20260914170000.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.meta_ads_connections') IS NULL
     OR to_regclass('public.meta_ads_client_connections') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('public.meta_ads_can_manage(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Aplique antes a 20260914150000 e a 20260914170000';
  END IF;
END;
$$;

ALTER TABLE public.meta_ads_connections
  ADD COLUMN IF NOT EXISTS disconnected_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.meta_ads_client_connections
  ADD COLUMN IF NOT EXISTS disconnected_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Desconectar grava quem clicou. Única mudança: `disconnected_by`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meta_ads_server_disconnect(
  _organization_id UUID,
  _actor_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_connection public.meta_ads_connections%ROWTYPE;
  v_access_secret_id UUID;
BEGIN
  IF NOT public.meta_ads_can_manage(_organization_id, _actor_user_id) THEN
    RAISE EXCEPTION 'meta_ads_disconnect_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_connection
  FROM public.meta_ads_connections AS connection
  WHERE connection.organization_id = _organization_id
  FOR UPDATE;

  IF v_connection.id IS NULL THEN RETURN; END IF;

  v_access_secret_id := v_connection.access_token_secret_id;

  UPDATE public.meta_ads_connections AS connection
  SET status = 'disconnected',
      access_token_secret_id = NULL,
      token_expires_at = NULL,
      disconnected_at = clock_timestamp(),
      disconnected_by = _actor_user_id,
      last_error_code = NULL
  WHERE connection.id = v_connection.id;

  IF v_access_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets AS secret WHERE secret.id = v_access_secret_id;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.meta_ads_server_disconnect_client(
  _organization_id UUID,
  _client_id UUID,
  _actor_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_connection public.meta_ads_client_connections%ROWTYPE;
  v_access_secret_id UUID;
BEGIN
  IF NOT public.meta_ads_can_manage(_organization_id, _actor_user_id) THEN
    RAISE EXCEPTION 'meta_ads_disconnect_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_connection
  FROM public.meta_ads_client_connections AS connection
  WHERE connection.organization_id = _organization_id
    AND connection.client_id = _client_id
  FOR UPDATE;

  IF v_connection.id IS NULL THEN RETURN; END IF;

  v_access_secret_id := v_connection.access_token_secret_id;

  UPDATE public.meta_ads_client_connections AS connection
  SET status = 'disconnected',
      access_token_secret_id = NULL,
      token_expires_at = NULL,
      disconnected_at = clock_timestamp(),
      disconnected_by = _actor_user_id,
      last_error_code = NULL
  WHERE connection.id = v_connection.id;

  IF v_access_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets AS secret WHERE secret.id = v_access_secret_id;
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Status com data e nome de quem desconectou. LANGUAGE sql (sem 42702).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_meta_ads_connection_status(UUID);
CREATE FUNCTION public.get_meta_ads_connection_status(
  _organization_id UUID
)
RETURNS TABLE (
  can_manage BOOLEAN,
  connection_status TEXT,
  meta_user_name TEXT,
  token_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_code TEXT,
  disconnected_at TIMESTAMPTZ,
  disconnected_by_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    public.meta_ads_can_manage(_organization_id, auth.uid()),
    COALESCE(connection.status, 'not_connected'),
    connection.meta_user_name,
    connection.token_expires_at,
    connection.connected_at,
    connection.last_verified_at,
    connection.last_error_code,
    CASE WHEN connection.status = 'disconnected' THEN connection.disconnected_at END,
    CASE WHEN connection.status = 'disconnected' THEN quem.full_name END
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.meta_ads_connections AS connection
    ON connection.organization_id = _organization_id
  LEFT JOIN public.profiles AS quem
    ON quem.id = connection.disconnected_by
  WHERE auth.uid() IS NOT NULL
    AND public.is_org_member(_organization_id, auth.uid())
$fn$;

DROP FUNCTION IF EXISTS public.get_meta_ads_client_connection_status(UUID, UUID);
CREATE FUNCTION public.get_meta_ads_client_connection_status(
  _organization_id UUID,
  _client_id UUID
)
RETURNS TABLE (
  can_manage BOOLEAN,
  connection_status TEXT,
  meta_user_name TEXT,
  token_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_code TEXT,
  disconnected_at TIMESTAMPTZ,
  disconnected_by_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    public.meta_ads_can_manage(_organization_id, auth.uid()),
    COALESCE(connection.status, 'not_connected'),
    connection.meta_user_name,
    connection.token_expires_at,
    connection.connected_at,
    connection.last_verified_at,
    connection.last_error_code,
    CASE WHEN connection.status = 'disconnected' THEN connection.disconnected_at END,
    CASE WHEN connection.status = 'disconnected' THEN quem.full_name END
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.meta_ads_client_connections AS connection
    ON connection.organization_id = _organization_id
   AND connection.client_id = _client_id
  LEFT JOIN public.profiles AS quem
    ON quem.id = connection.disconnected_by
  WHERE auth.uid() IS NOT NULL
    AND public.is_org_member(_organization_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.clients AS cliente
      WHERE cliente.id = _client_id
        AND cliente.organization_id = _organization_id
    )
$fn$;

-- ---------------------------------------------------------------------------
-- Privilégios. As de status foram recriadas: sem isto a tela perde o status.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_meta_ads_connection_status(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meta_ads_connection_status(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.get_meta_ads_client_connection_status(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meta_ads_client_connection_status(UUID, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.meta_ads_server_disconnect(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_disconnect(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.meta_ads_server_disconnect_client(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_disconnect_client(UUID, UUID, UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Conferência (uma consulta só). Devem vir 10 linhas, TODAS com `ok = true`.
-- ---------------------------------------------------------------------------
SELECT item, ok
FROM (
  SELECT 'coluna meta_ads_connections.disconnected_by' AS item,
    EXISTS (
      SELECT 1 FROM information_schema.columns AS coluna
      WHERE coluna.table_schema = 'public'
        AND coluna.table_name = 'meta_ads_connections'
        AND coluna.column_name = 'disconnected_by'
    ) AS ok
  UNION ALL
  SELECT 'coluna meta_ads_client_connections.disconnected_by',
    EXISTS (
      SELECT 1 FROM information_schema.columns AS coluna
      WHERE coluna.table_schema = 'public'
        AND coluna.table_name = 'meta_ads_client_connections'
        AND coluna.column_name = 'disconnected_by'
    )
  UNION ALL
  SELECT 'desconectar agência grava quem',
    pg_get_functiondef('public.meta_ads_server_disconnect(uuid,uuid)'::regprocedure)
      ILIKE '%disconnected_by = _actor_user_id%'
  UNION ALL
  SELECT 'desconectar cliente grava quem',
    pg_get_functiondef('public.meta_ads_server_disconnect_client(uuid,uuid,uuid)'::regprocedure)
      ILIKE '%disconnected_by = _actor_user_id%'
  UNION ALL
  SELECT 'service_role executa desconectar agência',
    has_function_privilege('service_role', 'public.meta_ads_server_disconnect(uuid,uuid)', 'EXECUTE')
  UNION ALL
  SELECT 'service_role executa desconectar cliente',
    has_function_privilege('service_role', 'public.meta_ads_server_disconnect_client(uuid,uuid,uuid)', 'EXECUTE')
  UNION ALL
  SELECT 'tela (authenticated) lê status da agência',
    has_function_privilege('authenticated', 'public.get_meta_ads_connection_status(uuid)', 'EXECUTE')
  UNION ALL
  SELECT 'tela (authenticated) lê status do cliente',
    has_function_privilege('authenticated', 'public.get_meta_ads_client_connection_status(uuid,uuid)', 'EXECUTE')
  UNION ALL
  SELECT 'status da agência executa',
    (SELECT count(*) = 0 FROM public.get_meta_ads_connection_status(gen_random_uuid()))
  UNION ALL
  SELECT 'status do cliente executa',
    (SELECT count(*) = 0 FROM public.get_meta_ads_client_connection_status(gen_random_uuid(), gen_random_uuid()))
) AS conferencia;

COMMIT;
