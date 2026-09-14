-- ============================================================================
-- META ADS: conexão com o PERFIL DO CLIENTE, por cliente.
--
-- A conexão da agência (20260914150000) lê as contas de anúncios que o login
-- da agência enxerga. Há clientes cuja conta só aparece para o próprio
-- cliente. Esta migration permite conectar o Meta Ads com o Facebook do
-- cliente, POR CLIENTE, e essa conexão tem prioridade sobre a da agência no
-- relatório daquele cliente.
--
-- LIMITE DA META: com acesso padrão a `ads_read`, só perfis com papel no app
-- (administrador, desenvolvedor, testador) conseguem conceder a permissão.
-- Para qualquer cliente, o app precisa de acesso avançado (análise da Meta).
--
-- Separada de meta_connections (publicação): não toca em post programado.
-- Mesmo desenho já corrigido da conexão da agência: status em LANGUAGE sql,
-- alias em toda consulta, GRANT reemitido.
--
-- Idempotente. Depende da 20260914150000. Aplicar ANTES do deploy/merge.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.meta_ads_connections') IS NULL
     OR to_regclass('public.meta_ads_oauth_states') IS NULL
     OR to_regclass('public.clients') IS NULL
     OR to_regprocedure('public.meta_ads_can_manage(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Aplique antes a 20260914150000_meta_ads_connection.sql';
  END IF;
END;
$$;

-- O state passa a saber se a autorização é de um cliente. NULL = agência.
ALTER TABLE public.meta_ads_oauth_states
  ADD COLUMN IF NOT EXISTS client_id UUID
    REFERENCES public.clients(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.meta_ads_client_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  meta_user_id TEXT NOT NULL,
  meta_user_name TEXT,
  access_token_secret_id UUID UNIQUE
    REFERENCES vault.secrets(id) ON DELETE RESTRICT,
  token_expires_at TIMESTAMPTZ,
  granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  connected_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meta_ads_client_connections_client_unique
    UNIQUE (organization_id, client_id),
  CONSTRAINT meta_ads_client_connections_status_valid CHECK (
    status IN ('active', 'reauth_required', 'disconnected', 'error')
  ),
  CONSTRAINT meta_ads_client_connections_active_token_required CHECK (
    status <> 'active' OR access_token_secret_id IS NOT NULL
  ),
  CONSTRAINT meta_ads_client_connections_error_code_sanitized CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_.:-]{1,100}$'
  )
);

DROP TRIGGER IF EXISTS update_meta_ads_client_connections_updated_at
  ON public.meta_ads_client_connections;
CREATE TRIGGER update_meta_ads_client_connections_updated_at
BEFORE UPDATE ON public.meta_ads_client_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Sem policy: o navegador só enxerga o status sanitizado.
ALTER TABLE public.meta_ads_client_connections ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Status do perfil do cliente para a tela. Nunca retorna token.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_meta_ads_client_connection_status(
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
  last_error_code TEXT
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
    connection.last_error_code
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.meta_ads_client_connections AS connection
    ON connection.organization_id = _organization_id
   AND connection.client_id = _client_id
  WHERE auth.uid() IS NOT NULL
    AND public.is_org_member(_organization_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.clients AS cliente
      WHERE cliente.id = _client_id
        AND cliente.organization_id = _organization_id
    )
$fn$;

CREATE OR REPLACE FUNCTION public.meta_ads_server_create_client_oauth_state(
  _organization_id UUID,
  _client_id UUID,
  _requested_by UUID,
  _state_hash TEXT,
  _requested_scopes TEXT[],
  _redirect_path TEXT,
  _expires_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id UUID;
BEGIN
  IF _requested_by IS NULL
     OR _client_id IS NULL
     OR _state_hash !~ '^[0-9a-f]{64}$'
     OR _expires_at <= clock_timestamp()
     OR _expires_at > clock_timestamp() + interval '15 minutes'
     OR _redirect_path NOT LIKE '/%'
     OR _redirect_path LIKE '//%'
     OR _redirect_path ~ '[[:cntrl:]]'
     OR NOT public.meta_ads_can_manage(_organization_id, _requested_by)
     OR NOT EXISTS (
       SELECT 1 FROM public.clients AS cliente
       WHERE cliente.id = _client_id
         AND cliente.organization_id = _organization_id
     ) THEN
    RAISE EXCEPTION 'meta_ads_oauth_start_forbidden'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.meta_ads_oauth_states AS oauth_state
  WHERE oauth_state.organization_id = _organization_id
    AND oauth_state.requested_by = _requested_by
    AND oauth_state.used_at IS NULL;

  INSERT INTO public.meta_ads_oauth_states (
    organization_id, client_id, requested_by, state_hash, requested_scopes,
    redirect_path, expires_at
  ) VALUES (
    _organization_id, _client_id, _requested_by, _state_hash,
    COALESCE(_requested_scopes, ARRAY[]::TEXT[]), _redirect_path, _expires_at
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.meta_ads_server_upsert_client_connection(
  _oauth_state_id UUID,
  _meta_user_id TEXT,
  _meta_user_name TEXT,
  _access_token TEXT,
  _token_expires_at TIMESTAMPTZ,
  _granted_scopes TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_state public.meta_ads_oauth_states%ROWTYPE;
  v_connection public.meta_ads_client_connections%ROWTYPE;
  v_connection_id UUID;
  v_access_secret_id UUID;
BEGIN
  IF btrim(COALESCE(_meta_user_id, '')) = ''
     OR btrim(COALESCE(_access_token, '')) = '' THEN
    RAISE EXCEPTION 'meta_ads_connection_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state
  FROM public.meta_ads_oauth_states AS oauth_state
  WHERE oauth_state.id = _oauth_state_id
    AND oauth_state.client_id IS NOT NULL
    AND oauth_state.used_at IS NOT NULL
    AND oauth_state.used_at > clock_timestamp() - interval '10 minutes'
  FOR UPDATE;

  IF v_state.id IS NULL
     OR NOT public.meta_ads_can_manage(v_state.organization_id, v_state.requested_by)
     OR NOT EXISTS (
       SELECT 1 FROM public.clients AS cliente
       WHERE cliente.id = v_state.client_id
         AND cliente.organization_id = v_state.organization_id
     ) THEN
    RAISE EXCEPTION 'meta_ads_oauth_state_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_connection
  FROM public.meta_ads_client_connections AS connection
  WHERE connection.organization_id = v_state.organization_id
    AND connection.client_id = v_state.client_id
  FOR UPDATE;

  v_connection_id := COALESCE(v_connection.id, gen_random_uuid());

  IF v_connection.access_token_secret_id IS NULL THEN
    v_access_secret_id := vault.create_secret(
      _access_token,
      'meta_ads_client_' || v_connection_id::TEXT || '_access_token',
      'norteia_meta_ads_client:' || v_connection_id::TEXT,
      NULL::UUID
    );
  ELSE
    v_access_secret_id := v_connection.access_token_secret_id;
    PERFORM vault.update_secret(
      v_access_secret_id,
      _access_token,
      'meta_ads_client_' || v_connection_id::TEXT || '_access_token',
      'norteia_meta_ads_client:' || v_connection_id::TEXT,
      NULL::UUID
    );
  END IF;

  INSERT INTO public.meta_ads_client_connections (
    id, organization_id, client_id, status, meta_user_id, meta_user_name,
    access_token_secret_id, token_expires_at, granted_scopes, connected_by,
    connected_at, disconnected_at, last_verified_at, last_error_code
  ) VALUES (
    v_connection_id, v_state.organization_id, v_state.client_id, 'active',
    btrim(_meta_user_id), NULLIF(btrim(COALESCE(_meta_user_name, '')), ''),
    v_access_secret_id, _token_expires_at,
    COALESCE(_granted_scopes, ARRAY[]::TEXT[]), v_state.requested_by,
    clock_timestamp(), NULL, clock_timestamp(), NULL
  )
  ON CONFLICT (organization_id, client_id) DO UPDATE SET
    status = 'active',
    meta_user_id = EXCLUDED.meta_user_id,
    meta_user_name = EXCLUDED.meta_user_name,
    access_token_secret_id = EXCLUDED.access_token_secret_id,
    token_expires_at = EXCLUDED.token_expires_at,
    granted_scopes = EXCLUDED.granted_scopes,
    connected_by = EXCLUDED.connected_by,
    connected_at = EXCLUDED.connected_at,
    disconnected_at = NULL,
    last_verified_at = EXCLUDED.last_verified_at,
    last_error_code = NULL
  RETURNING id INTO v_connection_id;

  DELETE FROM public.meta_ads_oauth_states AS oauth_state
  WHERE oauth_state.id = v_state.id;
  RETURN v_connection_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.meta_ads_server_get_client_credentials(
  _organization_id UUID,
  _client_id UUID
)
RETURNS TABLE (
  connection_id UUID,
  access_token TEXT,
  token_expires_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    connection.id,
    access_secret.decrypted_secret,
    connection.token_expires_at
  FROM public.meta_ads_client_connections AS connection
  JOIN vault.decrypted_secrets AS access_secret
    ON access_secret.id = connection.access_token_secret_id
  WHERE connection.organization_id = _organization_id
    AND connection.client_id = _client_id
    AND connection.status = 'active'
$fn$;

CREATE OR REPLACE FUNCTION public.meta_ads_server_mark_client_result(
  _connection_id UUID,
  _status TEXT,
  _reason_code TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF _status NOT IN ('active', 'reauth_required', 'error')
     OR (_reason_code IS NOT NULL AND _reason_code !~ '^[a-z0-9_.:-]{1,100}$') THEN
    RAISE EXCEPTION 'meta_ads_result_invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.meta_ads_client_connections AS connection
  SET status = _status,
      last_error_code = _reason_code,
      last_verified_at = clock_timestamp()
  WHERE connection.id = _connection_id
    AND connection.status <> 'disconnected'
    AND connection.access_token_secret_id IS NOT NULL;
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
      last_error_code = NULL
  WHERE connection.id = v_connection.id;

  IF v_access_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets AS secret WHERE secret.id = v_access_secret_id;
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Trava na conexão da AGÊNCIA: nunca aceitar um state de cliente. Hoje o
-- callback já separa os dois; isto impede que um erro futuro nele grave o
-- token de um cliente como se fosse o da agência inteira.
-- Mesma assinatura: CREATE OR REPLACE preserva os privilégios.
-- Única mudança em relação à 20260914150000: `oauth_state.client_id IS NULL`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meta_ads_server_upsert_connection(
  _oauth_state_id UUID,
  _meta_user_id TEXT,
  _meta_user_name TEXT,
  _access_token TEXT,
  _token_expires_at TIMESTAMPTZ,
  _granted_scopes TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_state public.meta_ads_oauth_states%ROWTYPE;
  v_connection public.meta_ads_connections%ROWTYPE;
  v_connection_id UUID;
  v_access_secret_id UUID;
BEGIN
  IF btrim(COALESCE(_meta_user_id, '')) = ''
     OR btrim(COALESCE(_access_token, '')) = '' THEN
    RAISE EXCEPTION 'meta_ads_connection_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state
  FROM public.meta_ads_oauth_states AS oauth_state
  WHERE oauth_state.id = _oauth_state_id
    AND oauth_state.client_id IS NULL
    AND oauth_state.used_at IS NOT NULL
    AND oauth_state.used_at > clock_timestamp() - interval '10 minutes'
  FOR UPDATE;

  IF v_state.id IS NULL
     OR NOT public.meta_ads_can_manage(v_state.organization_id, v_state.requested_by) THEN
    RAISE EXCEPTION 'meta_ads_oauth_state_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_connection
  FROM public.meta_ads_connections AS connection
  WHERE connection.organization_id = v_state.organization_id
  FOR UPDATE;

  v_connection_id := COALESCE(v_connection.id, gen_random_uuid());

  IF v_connection.access_token_secret_id IS NULL THEN
    v_access_secret_id := vault.create_secret(
      _access_token,
      'meta_ads_' || v_connection_id::TEXT || '_access_token',
      'norteia_meta_ads:' || v_connection_id::TEXT,
      NULL::UUID
    );
  ELSE
    v_access_secret_id := v_connection.access_token_secret_id;
    PERFORM vault.update_secret(
      v_access_secret_id,
      _access_token,
      'meta_ads_' || v_connection_id::TEXT || '_access_token',
      'norteia_meta_ads:' || v_connection_id::TEXT,
      NULL::UUID
    );
  END IF;

  INSERT INTO public.meta_ads_connections (
    id, organization_id, status, meta_user_id, meta_user_name,
    access_token_secret_id, token_expires_at, granted_scopes, connected_by,
    connected_at, disconnected_at, last_verified_at, last_error_code
  ) VALUES (
    v_connection_id, v_state.organization_id, 'active',
    btrim(_meta_user_id), NULLIF(btrim(COALESCE(_meta_user_name, '')), ''),
    v_access_secret_id, _token_expires_at,
    COALESCE(_granted_scopes, ARRAY[]::TEXT[]), v_state.requested_by,
    clock_timestamp(), NULL, clock_timestamp(), NULL
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    status = 'active',
    meta_user_id = EXCLUDED.meta_user_id,
    meta_user_name = EXCLUDED.meta_user_name,
    access_token_secret_id = EXCLUDED.access_token_secret_id,
    token_expires_at = EXCLUDED.token_expires_at,
    granted_scopes = EXCLUDED.granted_scopes,
    connected_by = EXCLUDED.connected_by,
    connected_at = EXCLUDED.connected_at,
    disconnected_at = NULL,
    last_verified_at = EXCLUDED.last_verified_at,
    last_error_code = NULL
  RETURNING id INTO v_connection_id;

  DELETE FROM public.meta_ads_oauth_states AS oauth_state
  WHERE oauth_state.id = v_state.id;
  RETURN v_connection_id;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Privilégios.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.meta_ads_client_connections
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.meta_ads_client_connections TO service_role;

REVOKE ALL ON FUNCTION public.get_meta_ads_client_connection_status(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meta_ads_client_connection_status(UUID, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.meta_ads_server_create_client_oauth_state(UUID, UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_ads_server_upsert_client_connection(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_ads_server_get_client_credentials(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_ads_server_mark_client_result(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_ads_server_disconnect_client(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_ads_server_upsert_connection(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.meta_ads_server_create_client_oauth_state(UUID, UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_upsert_client_connection(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_get_client_credentials(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_mark_client_result(UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_disconnect_client(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_upsert_connection(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- Conferência (uma consulta só). Devem vir 16 linhas, TODAS com `ok = true`:
--   * 11 funções meta_ads_server_* + meta_ads_can_manage executáveis pelo
--     service_role (as 6 da agência continuam lá);
--   * as duas funções de status EXECUTAM (sem usuário no SQL Editor, voltam
--     zero linhas — é isso que se confere);
--   * a coluna client_id existe nos states;
--   * a trava da conexão da agência está no ar.
-- ---------------------------------------------------------------------------
SELECT funcao, ok
FROM (
  SELECT
    p.proname::TEXT AS funcao,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS ok
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.proname LIKE 'meta_ads_server_%' OR p.proname = 'meta_ads_can_manage')
  UNION ALL
  SELECT
    'get_meta_ads_connection_status (executa)',
    (SELECT count(*) = 0 FROM public.get_meta_ads_connection_status(gen_random_uuid()))
  UNION ALL
  SELECT
    'get_meta_ads_client_connection_status (executa)',
    (SELECT count(*) = 0 FROM public.get_meta_ads_client_connection_status(gen_random_uuid(), gen_random_uuid()))
  UNION ALL
  SELECT
    'meta_ads_oauth_states.client_id (coluna)',
    EXISTS (
      SELECT 1 FROM information_schema.columns AS coluna
      WHERE coluna.table_schema = 'public'
        AND coluna.table_name = 'meta_ads_oauth_states'
        AND coluna.column_name = 'client_id'
    )
  UNION ALL
  SELECT
    'agência recusa state de cliente (trava)',
    pg_get_functiondef('public.meta_ads_server_upsert_connection(uuid,text,text,text,timestamptz,text[])'::regprocedure)
      ILIKE '%oauth_state.client_id IS NULL%'
) AS conferencia
ORDER BY funcao;

COMMIT;
