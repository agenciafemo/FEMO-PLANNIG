-- ============================================================================
-- META ADS: conexão da agência pela tela, com token no Vault.
--
-- POR QUE: o relatório de tráfego pago lia anúncios com um token de usuário
-- de 60 dias colado à mão no secret META_ADS_SYSTEM_TOKEN. Em 14/09/2026 a Meta
-- recusou esse token antes do prazo (acontece quando a pessoa troca a senha ou
-- encerra sessões) e o relatório parou sem aviso — só dava para consertar com
-- acesso ao Supabase, gerando outro token no Graph API Explorer.
--
-- Agora: uma conexão Meta Ads por agência, feita pelo botão na seção de
-- Tráfego Pago. A tela mostra quem conectou, quando vence e pede reconexão
-- quando a Meta recusa.
--
-- SEPARADA de meta_connections (publicação dos clientes) de propósito:
-- reconectar o Ads não pode tocar em post programado nenhum.
--
-- Espelha a versão JÁ CORRIGIDA do Google Ads (20260908150000), não a fundação
-- original: tabelas com alias em toda consulta, e o status é LANGUAGE sql, que
-- não tem o problema de coluna de saída virar variável (42702).
--
-- Idempotente. Aplicar ANTES do merge/deploy do código.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.organization_members') IS NULL
     OR to_regclass('public.team_member_functions') IS NULL
     OR to_regclass('public.team_function_tags') IS NULL
     OR to_regclass('vault.secrets') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('public.is_org_member(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_org_role(uuid,uuid)') IS NULL
     OR to_regprocedure('public.update_updated_at_column()') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Meta Ads connection dependencies are missing';
  END IF;
END;
$$;

-- Quem pode conectar/desconectar: ADM, Head (manager) ou quem tem a função
-- "Tráfego Pago" — a mesma exceção que já vale para as conexões Meta.
CREATE OR REPLACE FUNCTION public.meta_ads_can_manage(
  _organization_id UUID,
  _user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    _user_id IS NOT NULL
    AND public.get_org_role(_organization_id, _user_id) IS NOT NULL
    AND (
      public.get_org_role(_organization_id, _user_id) IN ('owner', 'admin', 'manager')
      OR EXISTS (
        SELECT 1
        FROM public.team_member_functions AS member_function
        JOIN public.team_function_tags AS tag
          ON tag.id = member_function.tag_id
        WHERE member_function.organization_id = _organization_id
          AND member_function.user_id = _user_id
          AND tag.organization_id = _organization_id
          AND tag.name ~* 'tr[aá]fego'
      )
    ),
    FALSE
  )
$$;

CREATE TABLE IF NOT EXISTS public.meta_ads_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  meta_user_id TEXT NOT NULL,
  meta_user_name TEXT,
  access_token_secret_id UUID UNIQUE
    REFERENCES vault.secrets(id) ON DELETE RESTRICT,
  -- Token de usuário de longa duração: ~60 dias. A tela avisa antes.
  token_expires_at TIMESTAMPTZ,
  granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  connected_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meta_ads_connections_status_valid CHECK (
    status IN ('active', 'reauth_required', 'disconnected', 'error')
  ),
  CONSTRAINT meta_ads_connections_active_token_required CHECK (
    status <> 'active' OR access_token_secret_id IS NOT NULL
  ),
  CONSTRAINT meta_ads_connections_error_code_sanitized CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_.:-]{1,100}$'
  )
);

DROP TRIGGER IF EXISTS update_meta_ads_connections_updated_at
  ON public.meta_ads_connections;
CREATE TRIGGER update_meta_ads_connections_updated_at
BEFORE UPDATE ON public.meta_ads_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.meta_ads_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  requested_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  redirect_path TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meta_ads_oauth_state_hash_valid CHECK (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT meta_ads_oauth_redirect_valid CHECK (
    redirect_path LIKE '/%'
    AND redirect_path NOT LIKE '//%'
    AND redirect_path !~ '[[:cntrl:]]'
  )
);

CREATE INDEX IF NOT EXISTS meta_ads_oauth_states_expiry_idx
  ON public.meta_ads_oauth_states (expires_at)
  WHERE used_at IS NULL;

-- Sem policy de SELECT: o navegador só enxerga o status sanitizado abaixo.
ALTER TABLE public.meta_ads_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_oauth_states ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Status para a tela. Nunca retorna token nem id do Vault.
-- LANGUAGE sql de propósito (ver cabeçalho: evita o 42702 do plpgsql).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_meta_ads_connection_status(
  _organization_id UUID
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
  LEFT JOIN public.meta_ads_connections AS connection
    ON connection.organization_id = _organization_id
  WHERE auth.uid() IS NOT NULL
    AND public.is_org_member(_organization_id, auth.uid())
$fn$;

CREATE OR REPLACE FUNCTION public.meta_ads_server_create_oauth_state(
  _organization_id UUID,
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
     OR _state_hash !~ '^[0-9a-f]{64}$'
     OR _expires_at <= clock_timestamp()
     OR _expires_at > clock_timestamp() + interval '15 minutes'
     OR _redirect_path NOT LIKE '/%'
     OR _redirect_path LIKE '//%'
     OR _redirect_path ~ '[[:cntrl:]]'
     OR NOT public.meta_ads_can_manage(_organization_id, _requested_by) THEN
    RAISE EXCEPTION 'meta_ads_oauth_start_forbidden'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.meta_ads_oauth_states AS oauth_state
  WHERE oauth_state.organization_id = _organization_id
    AND oauth_state.requested_by = _requested_by
    AND oauth_state.used_at IS NULL;

  INSERT INTO public.meta_ads_oauth_states (
    organization_id, requested_by, state_hash, requested_scopes,
    redirect_path, expires_at
  ) VALUES (
    _organization_id, _requested_by, _state_hash,
    COALESCE(_requested_scopes, ARRAY[]::TEXT[]), _redirect_path, _expires_at
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.meta_ads_server_consume_oauth_state(
  _state_hash TEXT
)
RETURNS TABLE (
  oauth_state_id UUID,
  organization_id UUID,
  requested_by UUID,
  requested_scopes TEXT[],
  redirect_path TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  UPDATE public.meta_ads_oauth_states AS oauth_state
  SET used_at = clock_timestamp()
  WHERE oauth_state.state_hash = _state_hash
    AND oauth_state.used_at IS NULL
    AND oauth_state.expires_at > clock_timestamp()
  RETURNING
    oauth_state.id,
    oauth_state.organization_id,
    oauth_state.requested_by,
    oauth_state.requested_scopes,
    oauth_state.redirect_path
$fn$;

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

CREATE OR REPLACE FUNCTION public.meta_ads_server_get_credentials(
  _organization_id UUID
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
  FROM public.meta_ads_connections AS connection
  JOIN vault.decrypted_secrets AS access_secret
    ON access_secret.id = connection.access_token_secret_id
  WHERE connection.organization_id = _organization_id
    AND connection.status = 'active'
$fn$;

CREATE OR REPLACE FUNCTION public.meta_ads_server_mark_result(
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

  -- Nunca "ressuscita" uma conexão desconectada: uma resposta atrasada de
  -- relatório não pode marcar como ativa algo que alguém acabou de desligar.
  UPDATE public.meta_ads_connections AS connection
  SET status = _status,
      last_error_code = _reason_code,
      last_verified_at = clock_timestamp()
  WHERE connection.id = _connection_id
    AND connection.status <> 'disconnected'
    AND connection.access_token_secret_id IS NOT NULL;
END;
$fn$;

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
      last_error_code = NULL
  WHERE connection.id = v_connection.id;

  IF v_access_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets AS secret WHERE secret.id = v_access_secret_id;
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Privilégios. Tabelas só pelo service_role; o navegador vê apenas o status.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.meta_ads_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.meta_ads_oauth_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.meta_ads_connections TO service_role;
GRANT ALL ON TABLE public.meta_ads_oauth_states TO service_role;

REVOKE ALL ON FUNCTION public.meta_ads_can_manage(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_can_manage(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_meta_ads_connection_status(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meta_ads_connection_status(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.meta_ads_server_create_oauth_state(UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_ads_server_consume_oauth_state(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_ads_server_upsert_connection(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_ads_server_get_credentials(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_ads_server_mark_result(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_ads_server_disconnect(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.meta_ads_server_create_oauth_state(UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_consume_oauth_state(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_upsert_connection(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_get_credentials(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_mark_result(UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_server_disconnect(UUID, UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Conferência (uma consulta só, porque o SQL Editor mostra apenas o último
-- resultado). Devem vir 8 linhas, TODAS com `ok = true`:
--   * 7 funções que o service_role precisa executar;
--   * a do status, que prova que ela EXECUTA (no SQL Editor não há usuário,
--     então ela devolve zero linhas — e é isso que se confere).
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
) AS conferencia
ORDER BY funcao;

COMMIT;
