-- ============================================================================
-- GOOGLE CALENDAR — conexão por organização e sincronização Norteia -> Google.
--
-- Esta migration cria somente a fundação de banco. Ela NÃO habilita a API no
-- Google Cloud, NÃO grava credenciais e NÃO faz deploy de Edge Functions.
-- Tokens OAuth ficam no Supabase Vault; tabelas públicas guardam apenas UUIDs
-- das secrets e nunca são expostas diretamente a anon/authenticated.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.organization_members') IS NULL
     OR to_regclass('public.calendar_events') IS NULL
     OR to_regclass('vault.secrets') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('public.is_org_member(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_org_role(uuid,uuid)') IS NULL
     OR to_regprocedure('public.update_updated_at_column()') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Google Calendar integration dependencies are missing';
  END IF;
END;
$$;

-- Head é representado pelo papel manager no modelo atual da organização.
CREATE OR REPLACE FUNCTION public.google_calendar_can_manage(
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

-- Uma conexão ativa por organização. O Calendar escolhido nesta primeira fase
-- é o calendário principal da conta que autorizou o Norteia.
CREATE TABLE public.google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  google_account_id TEXT NOT NULL,
  google_account_email TEXT NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  calendar_name TEXT NOT NULL DEFAULT 'Calendário principal',
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
  last_synced_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT google_calendar_connections_status_valid CHECK (
    status IN ('active', 'reauth_required', 'disconnected', 'error')
  ),
  CONSTRAINT google_calendar_connections_active_tokens_required CHECK (
    status <> 'active'
    OR (access_token_secret_id IS NOT NULL AND refresh_token_secret_id IS NOT NULL)
  ),
  CONSTRAINT google_calendar_connections_error_code_sanitized CHECK (
    last_error_code IS NULL
    OR last_error_code ~ '^[a-z0-9_.:-]{1,100}$'
  )
);

COMMENT ON TABLE public.google_calendar_connections IS
  'Conexão Google Calendar gerenciada apenas pelo servidor. Tokens ficam no Vault e nunca são retornados ao frontend.';

CREATE INDEX google_calendar_connections_status_idx
  ON public.google_calendar_connections (organization_id, status);

CREATE TRIGGER update_google_calendar_connections_updated_at
BEFORE UPDATE ON public.google_calendar_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- State OAuth de uso único. Apenas o hash SHA-256 é persistido.
CREATE TABLE public.google_calendar_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  requested_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  redirect_path TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT google_calendar_oauth_state_hash_valid CHECK (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT google_calendar_oauth_redirect_valid CHECK (
    redirect_path LIKE '/%'
    AND redirect_path NOT LIKE '//%'
    AND redirect_path !~ '[[:cntrl:]]'
  )
);

CREATE INDEX google_calendar_oauth_states_expiry_idx
  ON public.google_calendar_oauth_states (expires_at)
  WHERE used_at IS NULL;

-- O UUID do evento Norteia é mantido mesmo após a exclusão local. Isso permite
-- repetir a remoção no Google caso a primeira tentativa falhe.
CREATE TABLE public.google_calendar_event_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.google_calendar_connections(id) ON DELETE CASCADE,
  calendar_event_id UUID NOT NULL,
  google_calendar_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  google_etag TEXT,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  last_synced_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT google_calendar_event_links_event_unique
    UNIQUE (organization_id, calendar_event_id),
  CONSTRAINT google_calendar_event_links_google_unique
    UNIQUE (connection_id, google_calendar_id, google_event_id),
  CONSTRAINT google_calendar_event_links_status_valid CHECK (
    sync_status IN ('pending', 'synced', 'error', 'deleted')
  ),
  CONSTRAINT google_calendar_event_links_error_code_sanitized CHECK (
    last_error_code IS NULL
    OR last_error_code ~ '^[a-z0-9_.:-]{1,100}$'
  )
);

CREATE INDEX google_calendar_event_links_sync_idx
  ON public.google_calendar_event_links (organization_id, sync_status, updated_at);

CREATE TRIGGER update_google_calendar_event_links_updated_at
BEFORE UPDATE ON public.google_calendar_event_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_event_links ENABLE ROW LEVEL SECURITY;

-- Defesa em profundidade. As tabelas continuam sem grants diretos abaixo.
CREATE POLICY google_calendar_connections_member_select
ON public.google_calendar_connections
FOR SELECT TO authenticated
USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY google_calendar_event_links_member_select
ON public.google_calendar_event_links
FOR SELECT TO authenticated
USING (public.is_org_member(organization_id, auth.uid()));

-- OAuth states não possuem policy: são exclusivamente server-side.

-- Status sanitizado para a UI. Nunca retorna UUIDs do Vault ou tokens.
CREATE OR REPLACE FUNCTION public.get_google_calendar_connection_status(
  _organization_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  can_manage BOOLEAN,
  connection_id UUID,
  connection_status TEXT,
  google_account_email TEXT,
  calendar_id TEXT,
  calendar_name TEXT,
  connected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_error_code TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_org_member(_organization_id, auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    _organization_id,
    public.google_calendar_can_manage(_organization_id, auth.uid()),
    connection.id,
    COALESCE(connection.status, 'not_connected'),
    connection.google_account_email,
    connection.calendar_id,
    connection.calendar_name,
    connection.connected_at,
    connection.last_verified_at,
    connection.last_synced_at,
    connection.last_error_code
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.google_calendar_connections AS connection
    ON connection.organization_id = _organization_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Funções server-only usadas pelas Edge Functions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.google_calendar_server_create_oauth_state(
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
AS $$
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
     OR NOT public.google_calendar_can_manage(_organization_id, _requested_by) THEN
    RAISE EXCEPTION 'google_calendar_oauth_start_forbidden'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.google_calendar_oauth_states
  WHERE organization_id = _organization_id
    AND requested_by = _requested_by
    AND used_at IS NULL;

  INSERT INTO public.google_calendar_oauth_states (
    organization_id, requested_by, state_hash, requested_scopes,
    redirect_path, expires_at
  ) VALUES (
    _organization_id, _requested_by, _state_hash,
    COALESCE(_requested_scopes, ARRAY[]::TEXT[]), _redirect_path, _expires_at
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_calendar_server_consume_oauth_state(
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
AS $$
  UPDATE public.google_calendar_oauth_states AS oauth_state
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
$$;

CREATE OR REPLACE FUNCTION public.google_calendar_server_upsert_connection(
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
AS $$
DECLARE
  v_state public.google_calendar_oauth_states%ROWTYPE;
  v_connection public.google_calendar_connections%ROWTYPE;
  v_connection_id UUID;
  v_access_secret_id UUID;
  v_refresh_secret_id UUID;
BEGIN
  IF btrim(COALESCE(_google_account_id, '')) = ''
     OR btrim(COALESCE(_google_account_email, '')) = ''
     OR btrim(COALESCE(_access_token, '')) = ''
     OR btrim(COALESCE(_refresh_token, '')) = '' THEN
    RAISE EXCEPTION 'google_calendar_connection_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state
  FROM public.google_calendar_oauth_states
  WHERE id = _oauth_state_id
    AND used_at IS NOT NULL
    AND used_at > clock_timestamp() - interval '10 minutes'
  FOR UPDATE;

  IF v_state.id IS NULL
     OR NOT public.google_calendar_can_manage(v_state.organization_id, v_state.requested_by) THEN
    RAISE EXCEPTION 'google_calendar_oauth_state_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_connection
  FROM public.google_calendar_connections
  WHERE organization_id = v_state.organization_id
  FOR UPDATE;

  v_connection_id := COALESCE(v_connection.id, gen_random_uuid());

  IF v_connection.access_token_secret_id IS NULL THEN
    v_access_secret_id := vault.create_secret(
      _access_token,
      'google_calendar_' || v_connection_id::TEXT || '_access_token',
      'norteia_google_calendar:' || v_connection_id::TEXT,
      NULL::UUID
    );
  ELSE
    v_access_secret_id := v_connection.access_token_secret_id;
    PERFORM vault.update_secret(
      v_access_secret_id,
      _access_token,
      'google_calendar_' || v_connection_id::TEXT || '_access_token',
      'norteia_google_calendar:' || v_connection_id::TEXT,
      NULL::UUID
    );
  END IF;

  IF v_connection.refresh_token_secret_id IS NULL THEN
    v_refresh_secret_id := vault.create_secret(
      _refresh_token,
      'google_calendar_' || v_connection_id::TEXT || '_refresh_token',
      'norteia_google_calendar:' || v_connection_id::TEXT,
      NULL::UUID
    );
  ELSE
    v_refresh_secret_id := v_connection.refresh_token_secret_id;
    PERFORM vault.update_secret(
      v_refresh_secret_id,
      _refresh_token,
      'google_calendar_' || v_connection_id::TEXT || '_refresh_token',
      'norteia_google_calendar:' || v_connection_id::TEXT,
      NULL::UUID
    );
  END IF;

  INSERT INTO public.google_calendar_connections (
    id, organization_id, status, google_account_id, google_account_email,
    calendar_id, calendar_name, access_token_secret_id,
    refresh_token_secret_id, token_expires_at, granted_scopes,
    connected_by, connected_at, disconnected_at, last_verified_at,
    last_error_code
  ) VALUES (
    v_connection_id, v_state.organization_id, 'active',
    btrim(_google_account_id), lower(btrim(_google_account_email)),
    'primary', 'Calendário principal', v_access_secret_id,
    v_refresh_secret_id, _token_expires_at,
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

  DELETE FROM public.google_calendar_oauth_states WHERE id = v_state.id;
  RETURN v_connection_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_calendar_server_get_credentials(
  _organization_id UUID
)
RETURNS TABLE (
  connection_id UUID,
  calendar_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    connection.id,
    connection.calendar_id,
    access_secret.decrypted_secret,
    refresh_secret.decrypted_secret,
    connection.token_expires_at
  FROM public.google_calendar_connections AS connection
  JOIN vault.decrypted_secrets AS access_secret
    ON access_secret.id = connection.access_token_secret_id
  JOIN vault.decrypted_secrets AS refresh_secret
    ON refresh_secret.id = connection.refresh_token_secret_id
  WHERE connection.organization_id = _organization_id
    AND connection.status = 'active'
$$;

CREATE OR REPLACE FUNCTION public.google_calendar_server_refresh_access_token(
  _connection_id UUID,
  _access_token TEXT,
  _token_expires_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.google_calendar_connections%ROWTYPE;
BEGIN
  IF btrim(COALESCE(_access_token, '')) = '' THEN
    RAISE EXCEPTION 'google_calendar_access_token_missing'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_connection
  FROM public.google_calendar_connections
  WHERE id = _connection_id
  FOR UPDATE;

  IF v_connection.id IS NULL OR v_connection.access_token_secret_id IS NULL THEN
    RAISE EXCEPTION 'google_calendar_connection_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM vault.update_secret(
    v_connection.access_token_secret_id,
    _access_token,
    'google_calendar_' || v_connection.id::TEXT || '_access_token',
    'norteia_google_calendar:' || v_connection.id::TEXT,
    NULL::UUID
  );

  UPDATE public.google_calendar_connections
  SET token_expires_at = _token_expires_at,
      status = 'active',
      last_verified_at = clock_timestamp(),
      last_error_code = NULL
  WHERE id = v_connection.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_calendar_server_mark_result(
  _connection_id UUID,
  _status TEXT,
  _reason_code TEXT DEFAULT NULL,
  _synced BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _status NOT IN ('active', 'reauth_required', 'error')
     OR (_reason_code IS NOT NULL AND _reason_code !~ '^[a-z0-9_.:-]{1,100}$') THEN
    RAISE EXCEPTION 'google_calendar_result_invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.google_calendar_connections
  SET status = _status,
      last_error_code = _reason_code,
      last_verified_at = clock_timestamp(),
      last_synced_at = CASE WHEN _synced THEN clock_timestamp() ELSE last_synced_at END
  WHERE id = _connection_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_calendar_server_disconnect(
  _organization_id UUID,
  _actor_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.google_calendar_connections%ROWTYPE;
  v_access_secret_id UUID;
  v_refresh_secret_id UUID;
BEGIN
  IF NOT public.google_calendar_can_manage(_organization_id, _actor_user_id) THEN
    RAISE EXCEPTION 'google_calendar_disconnect_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_connection
  FROM public.google_calendar_connections
  WHERE organization_id = _organization_id
  FOR UPDATE;

  IF v_connection.id IS NULL THEN RETURN; END IF;

  v_access_secret_id := v_connection.access_token_secret_id;
  v_refresh_secret_id := v_connection.refresh_token_secret_id;

  UPDATE public.google_calendar_connections
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
$$;

-- Sem grants diretos para usuários da API.
REVOKE ALL ON TABLE public.google_calendar_connections
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.google_calendar_oauth_states
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.google_calendar_event_links
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.google_calendar_connections TO service_role;
GRANT ALL ON TABLE public.google_calendar_oauth_states TO service_role;
GRANT ALL ON TABLE public.google_calendar_event_links TO service_role;

REVOKE ALL ON FUNCTION public.google_calendar_can_manage(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.google_calendar_can_manage(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_google_calendar_connection_status(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_google_calendar_connection_status(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.google_calendar_server_create_oauth_state(UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_calendar_server_consume_oauth_state(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_calendar_server_upsert_connection(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_calendar_server_get_credentials(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_calendar_server_refresh_access_token(UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_calendar_server_mark_result(UUID, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_calendar_server_disconnect(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.google_calendar_server_create_oauth_state(UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_calendar_server_consume_oauth_state(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_calendar_server_upsert_connection(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_calendar_server_get_credentials(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_calendar_server_refresh_access_token(UUID, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_calendar_server_mark_result(UUID, TEXT, TEXT, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_calendar_server_disconnect(UUID, UUID)
  TO service_role;

COMMIT;
