-- Google Business Profile: uma autorizacao por agencia e uma unidade por cliente.
-- Tokens ficam exclusivamente no Vault. O frontend recebe apenas status
-- sanitizado e opera por Edge Functions autenticadas.

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
    RAISE EXCEPTION 'Google Business Profile integration dependencies are missing';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_business_can_manage(
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

CREATE TABLE public.google_business_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  google_account_id TEXT NOT NULL,
  google_account_email TEXT NOT NULL,
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
  CONSTRAINT google_business_connections_status_valid CHECK (
    status IN ('active', 'reauth_required', 'disconnected', 'error')
  ),
  CONSTRAINT google_business_connections_active_tokens_required CHECK (
    status <> 'active'
    OR (access_token_secret_id IS NOT NULL AND refresh_token_secret_id IS NOT NULL)
  ),
  CONSTRAINT google_business_connections_error_code_sanitized CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_.:-]{1,100}$'
  )
);

CREATE TRIGGER update_google_business_connections_updated_at
BEFORE UPDATE ON public.google_business_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.google_business_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  requested_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  redirect_path TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT google_business_oauth_state_hash_valid CHECK (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT google_business_oauth_redirect_valid CHECK (
    redirect_path LIKE '/%'
    AND redirect_path NOT LIKE '//%'
    AND redirect_path !~ '[[:cntrl:]]'
  )
);

CREATE INDEX google_business_oauth_states_expiry_idx
  ON public.google_business_oauth_states (expires_at)
  WHERE used_at IS NULL;

CREATE TABLE public.google_business_client_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL
    REFERENCES public.google_business_connections(id) ON DELETE CASCADE,
  google_location_name TEXT NOT NULL,
  location_title TEXT NOT NULL,
  store_code TEXT,
  place_id TEXT,
  storefront_address JSONB,
  selected_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT google_business_client_location_name_valid CHECK (
    google_location_name ~ '^locations/[0-9]+$'
  ),
  CONSTRAINT google_business_client_location_client_unique
    UNIQUE (organization_id, client_id),
  CONSTRAINT google_business_client_location_google_unique
    UNIQUE (organization_id, google_location_name)
);

CREATE INDEX google_business_client_locations_connection_idx
  ON public.google_business_client_locations (connection_id);

CREATE TRIGGER update_google_business_client_locations_updated_at
BEFORE UPDATE ON public.google_business_client_locations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.google_business_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_business_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_business_client_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY google_business_connections_member_select
ON public.google_business_connections FOR SELECT TO authenticated
USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY google_business_client_locations_member_select
ON public.google_business_client_locations FOR SELECT TO authenticated
USING (public.is_org_member(organization_id, auth.uid()));

-- Status sanitizado para a ficha do cliente. Nunca retorna tokens ou IDs do Vault.
CREATE OR REPLACE FUNCTION public.get_google_business_connection_status(
  _organization_id UUID,
  _client_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  client_id UUID,
  can_manage BOOLEAN,
  connection_status TEXT,
  google_account_email TEXT,
  google_location_name TEXT,
  location_title TEXT,
  store_code TEXT,
  place_id TEXT,
  selected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_code TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    public.google_business_can_manage(_organization_id, auth.uid()),
    COALESCE(connection.status, 'not_connected'),
    connection.google_account_email,
    location.google_location_name,
    location.location_title,
    location.store_code,
    location.place_id,
    location.selected_at,
    connection.last_verified_at,
    connection.last_error_code
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.google_business_connections AS connection
    ON connection.organization_id = _organization_id
  LEFT JOIN public.google_business_client_locations AS location
    ON location.organization_id = _organization_id
   AND location.client_id = _client_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_business_server_create_oauth_state(
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
     OR NOT public.google_business_can_manage(_organization_id, _requested_by) THEN
    RAISE EXCEPTION 'google_business_oauth_start_forbidden'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.google_business_oauth_states
  WHERE organization_id = _organization_id
    AND requested_by = _requested_by
    AND used_at IS NULL;

  INSERT INTO public.google_business_oauth_states (
    organization_id, requested_by, state_hash, requested_scopes,
    redirect_path, expires_at
  ) VALUES (
    _organization_id, _requested_by, _state_hash,
    COALESCE(_requested_scopes, ARRAY[]::TEXT[]), _redirect_path, _expires_at
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_business_server_consume_oauth_state(
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
  UPDATE public.google_business_oauth_states AS oauth_state
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

CREATE OR REPLACE FUNCTION public.google_business_server_upsert_connection(
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
  v_state public.google_business_oauth_states%ROWTYPE;
  v_connection public.google_business_connections%ROWTYPE;
  v_connection_id UUID;
  v_access_secret_id UUID;
  v_refresh_secret_id UUID;
BEGIN
  IF btrim(COALESCE(_google_account_id, '')) = ''
     OR btrim(COALESCE(_google_account_email, '')) = ''
     OR btrim(COALESCE(_access_token, '')) = '' THEN
    RAISE EXCEPTION 'google_business_connection_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state
  FROM public.google_business_oauth_states
  WHERE id = _oauth_state_id
    AND used_at IS NOT NULL
    AND used_at > clock_timestamp() - interval '10 minutes'
  FOR UPDATE;

  IF v_state.id IS NULL
     OR NOT public.google_business_can_manage(v_state.organization_id, v_state.requested_by) THEN
    RAISE EXCEPTION 'google_business_oauth_state_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_connection
  FROM public.google_business_connections
  WHERE organization_id = v_state.organization_id
  FOR UPDATE;

  v_connection_id := COALESCE(v_connection.id, gen_random_uuid());

  IF v_connection.access_token_secret_id IS NULL THEN
    v_access_secret_id := vault.create_secret(
      _access_token,
      'google_business_' || v_connection_id::TEXT || '_access_token',
      'norteia_google_business:' || v_connection_id::TEXT,
      NULL::UUID
    );
  ELSE
    v_access_secret_id := v_connection.access_token_secret_id;
    PERFORM vault.update_secret(
      v_access_secret_id,
      _access_token,
      'google_business_' || v_connection_id::TEXT || '_access_token',
      'norteia_google_business:' || v_connection_id::TEXT,
      NULL::UUID
    );
  END IF;

  IF btrim(COALESCE(_refresh_token, '')) <> '' THEN
    IF v_connection.refresh_token_secret_id IS NULL THEN
      v_refresh_secret_id := vault.create_secret(
        _refresh_token,
        'google_business_' || v_connection_id::TEXT || '_refresh_token',
        'norteia_google_business:' || v_connection_id::TEXT,
        NULL::UUID
      );
    ELSE
      v_refresh_secret_id := v_connection.refresh_token_secret_id;
      PERFORM vault.update_secret(
        v_refresh_secret_id,
        _refresh_token,
        'google_business_' || v_connection_id::TEXT || '_refresh_token',
        'norteia_google_business:' || v_connection_id::TEXT,
        NULL::UUID
      );
    END IF;
  ELSE
    v_refresh_secret_id := v_connection.refresh_token_secret_id;
  END IF;

  IF v_refresh_secret_id IS NULL THEN
    RAISE EXCEPTION 'google_business_refresh_token_missing'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.google_business_connections (
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

  DELETE FROM public.google_business_oauth_states WHERE id = v_state.id;
  RETURN v_connection_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_business_server_get_credentials(
  _organization_id UUID
)
RETURNS TABLE (
  connection_id UUID,
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
    access_secret.decrypted_secret,
    refresh_secret.decrypted_secret,
    connection.token_expires_at
  FROM public.google_business_connections AS connection
  JOIN vault.decrypted_secrets AS access_secret
    ON access_secret.id = connection.access_token_secret_id
  JOIN vault.decrypted_secrets AS refresh_secret
    ON refresh_secret.id = connection.refresh_token_secret_id
  WHERE connection.organization_id = _organization_id
    AND connection.status = 'active'
$$;

CREATE OR REPLACE FUNCTION public.google_business_server_refresh_access_token(
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
  v_connection public.google_business_connections%ROWTYPE;
BEGIN
  IF btrim(COALESCE(_access_token, '')) = '' THEN
    RAISE EXCEPTION 'google_business_access_token_missing'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_connection
  FROM public.google_business_connections
  WHERE id = _connection_id
  FOR UPDATE;

  IF v_connection.id IS NULL OR v_connection.access_token_secret_id IS NULL THEN
    RAISE EXCEPTION 'google_business_connection_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM vault.update_secret(
    v_connection.access_token_secret_id,
    _access_token,
    'google_business_' || v_connection.id::TEXT || '_access_token',
    'norteia_google_business:' || v_connection.id::TEXT,
    NULL::UUID
  );

  UPDATE public.google_business_connections
  SET token_expires_at = _token_expires_at,
      status = 'active',
      last_verified_at = clock_timestamp(),
      last_error_code = NULL
  WHERE id = v_connection.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_business_server_mark_result(
  _connection_id UUID,
  _status TEXT,
  _reason_code TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _status NOT IN ('active', 'reauth_required', 'error')
     OR (_reason_code IS NOT NULL AND _reason_code !~ '^[a-z0-9_.:-]{1,100}$') THEN
    RAISE EXCEPTION 'google_business_result_invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.google_business_connections
  SET status = _status,
      last_error_code = _reason_code,
      last_verified_at = clock_timestamp()
  WHERE id = _connection_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_business_server_select_location(
  _organization_id UUID,
  _client_id UUID,
  _actor_user_id UUID,
  _google_location_name TEXT,
  _location_title TEXT,
  _store_code TEXT,
  _place_id TEXT,
  _storefront_address JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection_id UUID;
  v_id UUID;
BEGIN
  IF NOT public.google_business_can_manage(_organization_id, _actor_user_id) THEN
    RAISE EXCEPTION 'google_business_location_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = _client_id AND organization_id = _organization_id
  ) THEN
    RAISE EXCEPTION 'google_business_client_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF _google_location_name !~ '^locations/[0-9]+$'
     OR btrim(COALESCE(_location_title, '')) = '' THEN
    RAISE EXCEPTION 'google_business_location_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_connection_id
  FROM public.google_business_connections
  WHERE organization_id = _organization_id AND status = 'active';

  IF v_connection_id IS NULL THEN
    RAISE EXCEPTION 'google_business_not_connected'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.google_business_client_locations (
    organization_id, client_id, connection_id, google_location_name,
    location_title, store_code, place_id, storefront_address, selected_by
  ) VALUES (
    _organization_id, _client_id, v_connection_id, _google_location_name,
    btrim(_location_title), NULLIF(btrim(COALESCE(_store_code, '')), ''),
    NULLIF(btrim(COALESCE(_place_id, '')), ''), _storefront_address,
    _actor_user_id
  )
  ON CONFLICT (organization_id, client_id) DO UPDATE SET
    connection_id = EXCLUDED.connection_id,
    google_location_name = EXCLUDED.google_location_name,
    location_title = EXCLUDED.location_title,
    store_code = EXCLUDED.store_code,
    place_id = EXCLUDED.place_id,
    storefront_address = EXCLUDED.storefront_address,
    selected_by = EXCLUDED.selected_by,
    selected_at = clock_timestamp()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_business_server_disconnect(
  _organization_id UUID,
  _actor_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.google_business_connections%ROWTYPE;
  v_access_secret_id UUID;
  v_refresh_secret_id UUID;
BEGIN
  IF NOT public.google_business_can_manage(_organization_id, _actor_user_id) THEN
    RAISE EXCEPTION 'google_business_disconnect_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_connection
  FROM public.google_business_connections
  WHERE organization_id = _organization_id
  FOR UPDATE;

  IF v_connection.id IS NULL THEN RETURN; END IF;

  v_access_secret_id := v_connection.access_token_secret_id;
  v_refresh_secret_id := v_connection.refresh_token_secret_id;

  UPDATE public.google_business_connections
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

REVOKE ALL ON TABLE public.google_business_connections
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.google_business_oauth_states
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.google_business_client_locations
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.google_business_connections TO service_role;
GRANT ALL ON TABLE public.google_business_oauth_states TO service_role;
GRANT ALL ON TABLE public.google_business_client_locations TO service_role;

REVOKE ALL ON FUNCTION public.google_business_can_manage(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.google_business_can_manage(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_google_business_connection_status(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_google_business_connection_status(UUID, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.google_business_server_create_oauth_state(UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_business_server_consume_oauth_state(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_business_server_upsert_connection(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_business_server_get_credentials(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_business_server_refresh_access_token(UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_business_server_mark_result(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_business_server_select_location(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.google_business_server_disconnect(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.google_business_server_create_oauth_state(UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_business_server_consume_oauth_state(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_business_server_upsert_connection(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_business_server_get_credentials(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_business_server_refresh_access_token(UUID, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_business_server_mark_result(UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_business_server_select_location(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.google_business_server_disconnect(UUID, UUID)
  TO service_role;

COMMIT;
