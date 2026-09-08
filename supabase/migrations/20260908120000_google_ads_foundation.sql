-- ============================================================================
-- Google Ads: uma autorizacao por agencia e uma conta de anuncios por cliente.
--
-- POR QUE UMA CONEXAO SEPARADA DO PERFIL DA EMPRESA:
-- Seria tentador pendurar o escopo do Ads na conexao que ja existe
-- (google_business_connections) e ter "uma conexao Google" so. Duas razoes
-- contra, e as duas ja morderam projetos parecidos:
--
--   1. O Ads vive numa conta de ADMINISTRADOR (MCC). Na pratica de agencia,
--      quase nunca e o mesmo login que administra o Perfil da Empresa. Uma
--      conexao unica obrigaria as duas coisas a caberem na mesma conta Google.
--   2. Consentimento e por escopo. Se alguem reautorizasse so o Ads, o token
--      novo substituiria o antigo e o Perfil da Empresa cairia junto — uma
--      integracao derrubando a outra sem ninguem entender por que.
--
-- Tokens ficam exclusivamente no Vault. O frontend recebe apenas status
-- sanitizado e opera por Edge Functions autenticadas. Mesmo desenho da
-- 20260904145829_google_business_profile_foundation.sql, que ja esta em
-- producao — de proposito: e o padrao que a equipe ja sabe operar.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.organization_members') IS NULL
     OR to_regclass('public.clients') IS NULL
     OR to_regclass('vault.secrets') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('public.is_org_member(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_org_role(uuid,uuid)') IS NULL
     OR to_regprocedure('public.update_updated_at_column()') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Google Ads integration dependencies are missing';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_ads_can_manage(
  _organization_id UUID,
  _user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    AND public.get_org_role(_organization_id, _user_id)
      IN ('owner', 'admin', 'manager')
$$;

CREATE TABLE IF NOT EXISTS public.google_ads_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  google_account_id TEXT NOT NULL,
  google_account_email TEXT NOT NULL,
  -- Conta de administrador (MCC) usada como `login-customer-id` nas chamadas.
  -- Fica NULL ate a primeira listagem descobrir qual e.
  login_customer_id TEXT,
  access_token_secret_id UUID UNIQUE
    REFERENCES vault.secrets(id) ON DELETE RESTRICT,
  refresh_token_secret_id UUID UNIQUE
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
  CONSTRAINT google_ads_connections_status_valid CHECK (
    status IN ('active', 'reauth_required', 'disconnected', 'error')
  ),
  CONSTRAINT google_ads_connections_login_customer_valid CHECK (
    login_customer_id IS NULL OR login_customer_id ~ '^[0-9]{10}$'
  ),
  CONSTRAINT google_ads_connections_active_tokens_required CHECK (
    status <> 'active'
    OR (access_token_secret_id IS NOT NULL AND refresh_token_secret_id IS NOT NULL)
  ),
  CONSTRAINT google_ads_connections_error_code_sanitized CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_.:-]{1,100}$'
  )
);

DROP TRIGGER IF EXISTS update_google_ads_connections_updated_at
  ON public.google_ads_connections;
CREATE TRIGGER update_google_ads_connections_updated_at
BEFORE UPDATE ON public.google_ads_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.google_ads_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  requested_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  redirect_path TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT google_ads_oauth_state_hash_valid CHECK (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT google_ads_oauth_redirect_valid CHECK (
    redirect_path LIKE '/%'
    AND redirect_path NOT LIKE '//%'
    AND redirect_path !~ '[[:cntrl:]]'
  )
);

CREATE INDEX IF NOT EXISTS google_ads_oauth_states_expiry_idx
  ON public.google_ads_oauth_states (expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS public.google_ads_client_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL
    REFERENCES public.google_ads_connections(id) ON DELETE CASCADE,
  -- Customer ID de 10 digitos, SEM os hifens que a interface do Google mostra.
  customer_id TEXT NOT NULL,
  descriptive_name TEXT NOT NULL,
  -- Moeda e fuso sao POR CONTA no Google Ads, nao por agencia. Guardar aqui
  -- evita formatar um relatorio em BRL quando a conta fatura em USD.
  currency_code TEXT,
  time_zone TEXT,
  selected_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT google_ads_client_account_customer_valid CHECK (
    customer_id ~ '^[0-9]{10}$'
  ),
  CONSTRAINT google_ads_client_account_currency_valid CHECK (
    currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'
  ),
  CONSTRAINT google_ads_client_account_client_unique
    UNIQUE (organization_id, client_id),
  CONSTRAINT google_ads_client_account_customer_unique
    UNIQUE (organization_id, customer_id)
);

CREATE INDEX IF NOT EXISTS google_ads_client_accounts_connection_idx
  ON public.google_ads_client_accounts (connection_id);

DROP TRIGGER IF EXISTS update_google_ads_client_accounts_updated_at
  ON public.google_ads_client_accounts;
CREATE TRIGGER update_google_ads_client_accounts_updated_at
BEFORE UPDATE ON public.google_ads_client_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.google_ads_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_client_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_ads_connections_member_select
  ON public.google_ads_connections;
CREATE POLICY google_ads_connections_member_select
ON public.google_ads_connections FOR SELECT TO authenticated
USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS google_ads_client_accounts_member_select
  ON public.google_ads_client_accounts;
CREATE POLICY google_ads_client_accounts_member_select
ON public.google_ads_client_accounts FOR SELECT TO authenticated
USING (public.is_org_member(organization_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- Status sanitizado para a tela. Nunca retorna tokens nem IDs do Vault.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_google_ads_connection_status(
  _organization_id UUID,
  _client_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  client_id UUID,
  can_manage BOOLEAN,
  connection_status TEXT,
  google_account_email TEXT,
  customer_id TEXT,
  descriptive_name TEXT,
  currency_code TEXT,
  time_zone TEXT,
  selected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_code TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_org_member(_organization_id, auth.uid())
     OR NOT EXISTS (
       SELECT 1 FROM public.clients
       WHERE id = _client_id AND organization_id = _organization_id
     ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    _organization_id,
    _client_id,
    public.google_ads_can_manage(_organization_id, auth.uid()),
    COALESCE(connection.status, 'not_connected'),
    connection.google_account_email,
    account.customer_id,
    account.descriptive_name,
    account.currency_code,
    account.time_zone,
    account.selected_at,
    connection.last_verified_at,
    connection.last_error_code
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.google_ads_connections AS connection
    ON connection.organization_id = _organization_id
  LEFT JOIN public.google_ads_client_accounts AS account
    ON account.organization_id = _organization_id
   AND account.client_id = _client_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.google_ads_server_create_oauth_state(
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
     OR NOT public.google_ads_can_manage(_organization_id, _requested_by) THEN
    RAISE EXCEPTION 'google_ads_oauth_start_forbidden'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.google_ads_oauth_states
  WHERE organization_id = _organization_id
    AND requested_by = _requested_by
    AND used_at IS NULL;

  INSERT INTO public.google_ads_oauth_states (
    organization_id, requested_by, state_hash, requested_scopes,
    redirect_path, expires_at
  ) VALUES (
    _organization_id, _requested_by, _state_hash,
    COALESCE(_requested_scopes, ARRAY[]::TEXT[]), _redirect_path, _expires_at
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.google_ads_server_consume_oauth_state(
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
  UPDATE public.google_ads_oauth_states AS oauth_state
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

CREATE OR REPLACE FUNCTION public.google_ads_server_upsert_connection(
  _oauth_state_id UUID,
  _google_account_id TEXT,
  _google_account_email TEXT,
  _access_token TEXT,
  _refresh_token TEXT,
  _token_expires_at TIMESTAMPTZ,
  _granted_scopes TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_state public.google_ads_oauth_states%ROWTYPE;
  v_connection public.google_ads_connections%ROWTYPE;
  v_connection_id UUID;
  v_access_secret_id UUID;
  v_refresh_secret_id UUID;
BEGIN
  IF btrim(COALESCE(_google_account_id, '')) = ''
     OR btrim(COALESCE(_google_account_email, '')) = ''
     OR btrim(COALESCE(_access_token, '')) = '' THEN
    RAISE EXCEPTION 'google_ads_connection_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state
  FROM public.google_ads_oauth_states
  WHERE id = _oauth_state_id
    AND used_at IS NOT NULL
    AND used_at > clock_timestamp() - interval '10 minutes'
  FOR UPDATE;

  IF v_state.id IS NULL
     OR NOT public.google_ads_can_manage(v_state.organization_id, v_state.requested_by) THEN
    RAISE EXCEPTION 'google_ads_oauth_state_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_connection
  FROM public.google_ads_connections
  WHERE organization_id = v_state.organization_id
  FOR UPDATE;

  v_connection_id := COALESCE(v_connection.id, gen_random_uuid());

  IF v_connection.access_token_secret_id IS NULL THEN
    v_access_secret_id := vault.create_secret(
      _access_token,
      'google_ads_' || v_connection_id::TEXT || '_access_token',
      'norteia_google_ads:' || v_connection_id::TEXT,
      NULL::UUID
    );
  ELSE
    v_access_secret_id := v_connection.access_token_secret_id;
    PERFORM vault.update_secret(
      v_access_secret_id,
      _access_token,
      'google_ads_' || v_connection_id::TEXT || '_access_token',
      'norteia_google_ads:' || v_connection_id::TEXT,
      NULL::UUID
    );
  END IF;

  IF btrim(COALESCE(_refresh_token, '')) <> '' THEN
    IF v_connection.refresh_token_secret_id IS NULL THEN
      v_refresh_secret_id := vault.create_secret(
        _refresh_token,
        'google_ads_' || v_connection_id::TEXT || '_refresh_token',
        'norteia_google_ads:' || v_connection_id::TEXT,
        NULL::UUID
      );
    ELSE
      v_refresh_secret_id := v_connection.refresh_token_secret_id;
      PERFORM vault.update_secret(
        v_refresh_secret_id,
        _refresh_token,
        'google_ads_' || v_connection_id::TEXT || '_refresh_token',
        'norteia_google_ads:' || v_connection_id::TEXT,
        NULL::UUID
      );
    END IF;
  ELSE
    v_refresh_secret_id := v_connection.refresh_token_secret_id;
  END IF;

  -- Sem refresh token a conexao morre na primeira expiracao (1h) e ninguem
  -- entende por que "parou sozinha". Falhar agora e mais honesto.
  IF v_refresh_secret_id IS NULL THEN
    RAISE EXCEPTION 'google_ads_refresh_token_missing'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.google_ads_connections (
    id, organization_id, status, google_account_id, google_account_email,
    access_token_secret_id, refresh_token_secret_id, token_expires_at,
    granted_scopes, connected_by, connected_at, disconnected_at,
    last_verified_at, last_error_code
  ) VALUES (
    v_connection_id, v_state.organization_id, 'active',
    btrim(_google_account_id), lower(btrim(_google_account_email)),
    v_access_secret_id, v_refresh_secret_id, _token_expires_at,
    COALESCE(_granted_scopes, ARRAY[]::TEXT[]), v_state.requested_by,
    clock_timestamp(), NULL, clock_timestamp(), NULL
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    status = 'active',
    google_account_id = EXCLUDED.google_account_id,
    google_account_email = EXCLUDED.google_account_email,
    access_token_secret_id = EXCLUDED.access_token_secret_id,
    refresh_token_secret_id = EXCLUDED.refresh_token_secret_id,
    token_expires_at = EXCLUDED.token_expires_at,
    granted_scopes = EXCLUDED.granted_scopes,
    connected_by = EXCLUDED.connected_by,
    connected_at = EXCLUDED.connected_at,
    disconnected_at = NULL,
    last_verified_at = EXCLUDED.last_verified_at,
    last_error_code = NULL
  RETURNING id INTO v_connection_id;

  DELETE FROM public.google_ads_oauth_states WHERE id = v_state.id;
  RETURN v_connection_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.google_ads_server_get_credentials(
  _organization_id UUID
)
RETURNS TABLE (
  connection_id UUID,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  login_customer_id TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    connection.id,
    access_secret.decrypted_secret,
    refresh_secret.decrypted_secret,
    connection.token_expires_at,
    connection.login_customer_id
  FROM public.google_ads_connections AS connection
  JOIN vault.decrypted_secrets AS access_secret
    ON access_secret.id = connection.access_token_secret_id
  JOIN vault.decrypted_secrets AS refresh_secret
    ON refresh_secret.id = connection.refresh_token_secret_id
  WHERE connection.organization_id = _organization_id
    AND connection.status = 'active'
$fn$;

CREATE OR REPLACE FUNCTION public.google_ads_server_refresh_access_token(
  _connection_id UUID,
  _access_token TEXT,
  _token_expires_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_connection public.google_ads_connections%ROWTYPE;
BEGIN
  IF btrim(COALESCE(_access_token, '')) = '' THEN
    RAISE EXCEPTION 'google_ads_access_token_missing'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_connection
  FROM public.google_ads_connections
  WHERE id = _connection_id
  FOR UPDATE;

  IF v_connection.id IS NULL OR v_connection.access_token_secret_id IS NULL THEN
    RAISE EXCEPTION 'google_ads_connection_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM vault.update_secret(
    v_connection.access_token_secret_id,
    _access_token,
    'google_ads_' || v_connection.id::TEXT || '_access_token',
    'norteia_google_ads:' || v_connection.id::TEXT,
    NULL::UUID
  );

  UPDATE public.google_ads_connections
  SET token_expires_at = _token_expires_at,
      status = 'active',
      last_verified_at = clock_timestamp(),
      last_error_code = NULL
  WHERE id = v_connection.id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.google_ads_server_mark_result(
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
    RAISE EXCEPTION 'google_ads_result_invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.google_ads_connections
  SET status = _status,
      last_error_code = _reason_code,
      last_verified_at = clock_timestamp()
  WHERE id = _connection_id;
END;
$fn$;

-- A conta de administrador (MCC) so e conhecida depois da primeira listagem.
CREATE OR REPLACE FUNCTION public.google_ads_server_set_login_customer(
  _connection_id UUID,
  _login_customer_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF _login_customer_id IS NOT NULL AND _login_customer_id !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'google_ads_login_customer_invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.google_ads_connections
  SET login_customer_id = _login_customer_id
  WHERE id = _connection_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.google_ads_server_select_account(
  _organization_id UUID,
  _client_id UUID,
  _actor_user_id UUID,
  _customer_id TEXT,
  _descriptive_name TEXT,
  _currency_code TEXT,
  _time_zone TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_connection_id UUID;
  v_id UUID;
BEGIN
  IF NOT public.google_ads_can_manage(_organization_id, _actor_user_id) THEN
    RAISE EXCEPTION 'google_ads_account_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = _client_id AND organization_id = _organization_id
  ) THEN
    RAISE EXCEPTION 'google_ads_client_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF _customer_id !~ '^[0-9]{10}$'
     OR btrim(COALESCE(_descriptive_name, '')) = '' THEN
    RAISE EXCEPTION 'google_ads_account_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_connection_id
  FROM public.google_ads_connections
  WHERE organization_id = _organization_id AND status = 'active';

  IF v_connection_id IS NULL THEN
    RAISE EXCEPTION 'google_ads_not_connected'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.google_ads_client_accounts (
    organization_id, client_id, connection_id, customer_id,
    descriptive_name, currency_code, time_zone, selected_by
  ) VALUES (
    _organization_id, _client_id, v_connection_id, _customer_id,
    btrim(_descriptive_name),
    NULLIF(btrim(COALESCE(_currency_code, '')), ''),
    NULLIF(btrim(COALESCE(_time_zone, '')), ''),
    _actor_user_id
  )
  ON CONFLICT (organization_id, client_id) DO UPDATE SET
    connection_id = EXCLUDED.connection_id,
    customer_id = EXCLUDED.customer_id,
    descriptive_name = EXCLUDED.descriptive_name,
    currency_code = EXCLUDED.currency_code,
    time_zone = EXCLUDED.time_zone,
    selected_by = EXCLUDED.selected_by,
    selected_at = clock_timestamp()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.google_ads_server_get_client_account(
  _organization_id UUID,
  _client_id UUID
)
RETURNS TABLE (
  customer_id TEXT,
  descriptive_name TEXT,
  currency_code TEXT,
  time_zone TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT customer_id, descriptive_name, currency_code, time_zone
  FROM public.google_ads_client_accounts
  WHERE organization_id = _organization_id
    AND client_id = _client_id
$fn$;

CREATE OR REPLACE FUNCTION public.google_ads_server_disconnect(
  _organization_id UUID,
  _actor_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_connection public.google_ads_connections%ROWTYPE;
  v_access_secret_id UUID;
  v_refresh_secret_id UUID;
BEGIN
  IF NOT public.google_ads_can_manage(_organization_id, _actor_user_id) THEN
    RAISE EXCEPTION 'google_ads_disconnect_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_connection
  FROM public.google_ads_connections
  WHERE organization_id = _organization_id
  FOR UPDATE;

  IF v_connection.id IS NULL THEN RETURN; END IF;

  v_access_secret_id := v_connection.access_token_secret_id;
  v_refresh_secret_id := v_connection.refresh_token_secret_id;

  UPDATE public.google_ads_connections
  SET status = 'disconnected',
      access_token_secret_id = NULL,
      refresh_token_secret_id = NULL,
      token_expires_at = NULL,
      disconnected_at = clock_timestamp(),
      last_error_code = NULL
  WHERE id = v_connection.id;

  DELETE FROM vault.secrets
  WHERE id IN (v_access_secret_id, v_refresh_secret_id);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Privilegios. As tabelas so sao alcancaveis pelo service_role; o navegador
-- enxerga apenas o SELECT filtrado por RLS e o status sanitizado.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.google_ads_connections
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.google_ads_oauth_states
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.google_ads_client_accounts
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.google_ads_connections TO service_role;
GRANT ALL ON TABLE public.google_ads_oauth_states TO service_role;
GRANT ALL ON TABLE public.google_ads_client_accounts TO service_role;

GRANT SELECT ON TABLE public.google_ads_connections TO authenticated;
GRANT SELECT ON TABLE public.google_ads_client_accounts TO authenticated;

REVOKE ALL ON FUNCTION public.google_ads_can_manage(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.google_ads_can_manage(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_google_ads_connection_status(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_google_ads_connection_status(UUID, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.google_ads_server_create_oauth_state(UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_ads_server_consume_oauth_state(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_ads_server_upsert_connection(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_ads_server_get_credentials(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_ads_server_refresh_access_token(UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_ads_server_mark_result(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_ads_server_set_login_customer(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_ads_server_select_account(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_ads_server_get_client_account(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_ads_server_disconnect(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.google_ads_server_create_oauth_state(UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_ads_server_consume_oauth_state(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_ads_server_upsert_connection(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_ads_server_get_credentials(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_ads_server_refresh_access_token(UUID, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_ads_server_mark_result(UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_ads_server_set_login_customer(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_ads_server_select_account(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_ads_server_get_client_account(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_ads_server_disconnect(UUID, UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Conferencia: as tres tabelas existem e as funcoes internas estao acessiveis
-- ao service_role (um REVOKE sem o GRANT correspondente ja derrubou a conexao
-- Meta uma vez, e o sintoma foi um 500 sem explicacao).
-- ---------------------------------------------------------------------------
SELECT
  p.proname                                                AS funcao,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_executa
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'google_ads_server_%'
ORDER BY p.proname;

COMMIT;
