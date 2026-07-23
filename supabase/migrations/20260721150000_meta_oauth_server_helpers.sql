-- ============================================================================
-- META OAUTH - SERVER-SIDE HELPERS ONLY
--
-- Trusted Edge Functions call these RPCs with service_role. This migration
-- creates no OAuth state, connection, token, Vault secret, channel, cron job,
-- publication, or external request. Raw OAuth state, authorization codes and
-- the Meta App Secret are never accepted or stored by these functions.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.meta_connections') IS NULL
     OR to_regclass('public.meta_connection_channels') IS NULL
     OR to_regclass('public.meta_oauth_states') IS NULL
     OR to_regclass('public.meta_connection_audit_logs') IS NULL
     OR to_regclass('vault.secrets') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL
     OR to_regprocedure('public.meta_can_manage_connection(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'meta_oauth_server_helper_dependencies_missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'service_role_missing';
  END IF;
END;
$$;

-- Creates a one-time state hash and its sanitized oauth_started audit row in
-- the same transaction. The raw state is generated and retained only by the
-- Edge Function; this function accepts only its lowercase SHA-256 hex digest.
CREATE OR REPLACE FUNCTION public.meta_server_create_oauth_state(
  _client_id UUID,
  _requested_by UUID,
  _state_hash TEXT,
  _requested_scopes TEXT[],
  _redirect_path TEXT,
  _expires_at TIMESTAMPTZ,
  _request_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_organization_id UUID;
  v_state_id UUID;
BEGIN
  IF _requested_by IS NULL
     OR _state_hash !~ '^[0-9a-f]{64}$'
     OR _expires_at <= clock_timestamp()
     OR _expires_at > clock_timestamp() + interval '15 minutes'
     OR _redirect_path IS NULL
     OR _redirect_path NOT LIKE '/%'
     OR _redirect_path LIKE '//%'
     OR _redirect_path ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'meta_oauth_state_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT c.organization_id
  INTO v_organization_id
  FROM public.clients c
  WHERE c.id = _client_id;

  IF v_organization_id IS NULL
     OR NOT public.meta_can_manage_connection(v_organization_id, _requested_by) THEN
    RAISE EXCEPTION 'meta_oauth_start_forbidden'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.meta_oauth_states
  WHERE client_id = _client_id
    AND requested_by = _requested_by
    AND used_at IS NULL;

  INSERT INTO public.meta_oauth_states (
    organization_id,
    client_id,
    requested_by,
    state_hash,
    requested_scopes,
    redirect_path,
    expires_at
  )
  VALUES (
    v_organization_id,
    _client_id,
    _requested_by,
    _state_hash,
    COALESCE(_requested_scopes, ARRAY[]::TEXT[]),
    _redirect_path,
    _expires_at
  )
  RETURNING id INTO v_state_id;

  INSERT INTO public.meta_connection_audit_logs (
    organization_id, client_id, actor_user_id,
    action, result, request_id
  ) VALUES (
    v_organization_id, _client_id, _requested_by,
    'oauth_started', 'pending', _request_id
  );

  RETURN v_state_id;
END;
$$;

-- Atomically claims a valid hash once. Invalid, expired and reused hashes all
-- return zero rows, intentionally avoiding a state-enumeration oracle.
CREATE OR REPLACE FUNCTION public.meta_server_consume_oauth_state(_state_hash TEXT)
RETURNS TABLE (
  oauth_state_id UUID,
  organization_id UUID,
  client_id UUID,
  requested_by UUID,
  requested_scopes TEXT[],
  redirect_path TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.meta_oauth_states
  SET used_at = clock_timestamp()
  WHERE state_hash = _state_hash
    AND used_at IS NULL
    AND expires_at > clock_timestamp()
  RETURNING
    id,
    organization_id,
    client_id,
    requested_by,
    requested_scopes,
    redirect_path
$$;

-- Creates a pending connection and its Vault secret atomically after the state
-- has been claimed. The secret UUID stays internal and only the connection UUID
-- is returned to the trusted caller. The consumed state row is then removed so
-- it cannot bootstrap another connection later.
CREATE OR REPLACE FUNCTION public.meta_server_create_pending_connection(
  _oauth_state_id UUID,
  _meta_user_id TEXT,
  _access_token TEXT,
  _token_expires_at TIMESTAMPTZ,
  _granted_scopes TEXT[],
  _request_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state public.meta_oauth_states%ROWTYPE;
  v_connection_id UUID := gen_random_uuid();
  v_secret_id UUID;
BEGIN
  IF btrim(COALESCE(_access_token, '')) = ''
     OR btrim(COALESCE(_meta_user_id, '')) = '' THEN
    RAISE EXCEPTION 'meta_pending_connection_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state
  FROM public.meta_oauth_states
  WHERE id = _oauth_state_id
    AND used_at IS NOT NULL
    AND used_at > clock_timestamp() - interval '10 minutes'
  FOR UPDATE;

  IF v_state.id IS NULL
     OR NOT public.meta_can_manage_connection(v_state.organization_id, v_state.requested_by) THEN
    RAISE EXCEPTION 'meta_consumed_state_invalid_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.meta_connections mc
    WHERE mc.client_id = v_state.client_id
      AND mc.status IN ('pending', 'active', 'reauth_required', 'error')
  ) THEN
    RAISE EXCEPTION 'meta_live_connection_already_exists'
      USING ERRCODE = '23505';
  END IF;

  v_secret_id := vault.create_secret(
    _access_token,
    'meta_connection_' || v_connection_id::TEXT || '_access_token',
    'norteia_meta_connection:' || v_connection_id::TEXT,
    NULL::UUID
  );

  INSERT INTO public.meta_connections (
    id, organization_id, client_id, status, meta_user_id,
    access_token_secret_id, token_expires_at, granted_scopes, connected_by
  ) VALUES (
    v_connection_id, v_state.organization_id, v_state.client_id, 'pending',
    _meta_user_id, v_secret_id, _token_expires_at,
    COALESCE(_granted_scopes, ARRAY[]::TEXT[]), v_state.requested_by
  );

  INSERT INTO public.meta_connection_audit_logs (
    organization_id, client_id, connection_id, actor_user_id,
    action, result, request_id
  ) VALUES (
    v_state.organization_id, v_state.client_id, v_connection_id,
    v_state.requested_by, 'oauth_completed', 'success', _request_id
  );

  DELETE FROM public.meta_oauth_states WHERE id = v_state.id;

  RETURN v_connection_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.meta_server_replace_connection_token(
  _connection_id UUID,
  _actor_user_id UUID,
  _access_token TEXT,
  _token_expires_at TIMESTAMPTZ,
  _request_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.meta_connections%ROWTYPE;
BEGIN
  IF btrim(COALESCE(_access_token, '')) = '' THEN
    RAISE EXCEPTION 'meta_access_token_missing' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_connection
  FROM public.meta_connections
  WHERE id = _connection_id
  FOR UPDATE;

  IF v_connection.id IS NULL
     OR v_connection.access_token_secret_id IS NULL
     OR NOT public.meta_can_manage_connection(v_connection.organization_id, _actor_user_id) THEN
    RAISE EXCEPTION 'meta_token_replace_forbidden'
      USING ERRCODE = '42501';
  END IF;

  PERFORM vault.update_secret(
    v_connection.access_token_secret_id,
    _access_token,
    'meta_connection_' || v_connection.id::TEXT || '_access_token',
    'norteia_meta_connection:' || v_connection.id::TEXT,
    NULL::UUID
  );

  UPDATE public.meta_connections
  SET token_expires_at = _token_expires_at,
      last_error_code = NULL
  WHERE id = v_connection.id;

  INSERT INTO public.meta_connection_audit_logs (
    organization_id, client_id, connection_id, actor_user_id,
    action, result, reason_code, request_id
  ) VALUES (
    v_connection.organization_id, v_connection.client_id, v_connection.id,
    _actor_user_id, 'health_checked', 'success', 'token_replaced', _request_id
  );
END;
$$;

-- This is the only helper that returns decrypted token material. It is granted
-- solely to service_role and must only be called inside trusted Edge Functions.
CREATE OR REPLACE FUNCTION public.meta_server_get_connection_token(_connection_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ds.decrypted_secret
  FROM public.meta_connections mc
  JOIN vault.decrypted_secrets ds
    ON ds.id = mc.access_token_secret_id
  WHERE mc.id = _connection_id
    AND mc.status IN ('pending', 'active', 'reauth_required', 'error')
$$;

CREATE OR REPLACE FUNCTION public.meta_server_remove_connection_token(
  _connection_id UUID,
  _actor_user_id UUID,
  _reason_code TEXT DEFAULT 'token_removed',
  _request_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.meta_connections%ROWTYPE;
  v_secret_id UUID;
BEGIN
  SELECT * INTO v_connection
  FROM public.meta_connections
  WHERE id = _connection_id
  FOR UPDATE;

  IF v_connection.id IS NULL
     OR NOT public.meta_can_manage_connection(v_connection.organization_id, _actor_user_id) THEN
    RAISE EXCEPTION 'meta_token_remove_forbidden'
      USING ERRCODE = '42501';
  END IF;

  v_secret_id := v_connection.access_token_secret_id;

  UPDATE public.meta_connections
  SET status = 'reauth_required',
      access_token_secret_id = NULL,
      token_expires_at = NULL,
      last_error_code = COALESCE(_reason_code, 'token_removed')
  WHERE id = v_connection.id;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;

  INSERT INTO public.meta_connection_audit_logs (
    organization_id, client_id, connection_id, actor_user_id,
    action, result, reason_code, request_id
  ) VALUES (
    v_connection.organization_id, v_connection.client_id, v_connection.id,
    _actor_user_id, 'reauth_required', 'success',
    COALESCE(_reason_code, 'token_removed'), _request_id
  );
END;
$$;

-- Finalizes one explicitly selected Facebook Page and, optionally, its linked
-- Instagram professional account. Parameters are sanitized metadata only.
CREATE OR REPLACE FUNCTION public.meta_server_finalize_connection(
  _connection_id UUID,
  _actor_user_id UUID,
  _facebook_page_id TEXT,
  _facebook_page_name TEXT,
  _page_tasks TEXT[] DEFAULT ARRAY[]::TEXT[],
  _instagram_account_id TEXT DEFAULT NULL,
  _instagram_display_name TEXT DEFAULT NULL,
  _instagram_username TEXT DEFAULT NULL,
  _instagram_account_type TEXT DEFAULT NULL,
  _request_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.meta_connections%ROWTYPE;
BEGIN
  SELECT * INTO v_connection
  FROM public.meta_connections
  WHERE id = _connection_id
  FOR UPDATE;

  IF v_connection.id IS NULL
     OR v_connection.status <> 'pending'
     OR v_connection.access_token_secret_id IS NULL
     OR NOT public.meta_can_manage_connection(v_connection.organization_id, _actor_user_id) THEN
    RAISE EXCEPTION 'meta_connection_finalize_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF btrim(COALESCE(_facebook_page_id, '')) = ''
     OR btrim(COALESCE(_facebook_page_name, '')) = ''
     OR ((_instagram_account_id IS NULL) <> (_instagram_display_name IS NULL)) THEN
    RAISE EXCEPTION 'meta_channel_selection_invalid'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.meta_connection_channels
  WHERE connection_id = v_connection.id;

  INSERT INTO public.meta_connection_channels (
    connection_id, organization_id, client_id, channel_type,
    external_account_id, display_name, page_tasks, status
  ) VALUES (
    v_connection.id, v_connection.organization_id, v_connection.client_id,
    'facebook_page', _facebook_page_id, _facebook_page_name,
    COALESCE(_page_tasks, ARRAY[]::TEXT[]), 'active'
  );

  IF _instagram_account_id IS NOT NULL THEN
    INSERT INTO public.meta_connection_channels (
      connection_id, organization_id, client_id, channel_type,
      external_account_id, display_name, username, account_type, status
    ) VALUES (
      v_connection.id, v_connection.organization_id, v_connection.client_id,
      'instagram', _instagram_account_id, _instagram_display_name,
      _instagram_username, _instagram_account_type, 'active'
    );
  END IF;

  UPDATE public.meta_connections
  SET status = 'active',
      connected_at = clock_timestamp(),
      disconnected_at = NULL,
      last_verified_at = clock_timestamp(),
      last_error_code = NULL
  WHERE id = v_connection.id;

  INSERT INTO public.meta_connection_audit_logs (
    organization_id, client_id, connection_id, actor_user_id,
    action, result, request_id
  ) VALUES (
    v_connection.organization_id, v_connection.client_id, v_connection.id,
    _actor_user_id, 'connection_activated', 'success', _request_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.meta_server_disconnect_connection(
  _connection_id UUID,
  _actor_user_id UUID,
  _reason_code TEXT DEFAULT 'user_requested',
  _request_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.meta_connections%ROWTYPE;
  v_secret_id UUID;
BEGIN
  SELECT * INTO v_connection
  FROM public.meta_connections
  WHERE id = _connection_id
  FOR UPDATE;

  IF v_connection.id IS NULL
     OR NOT public.meta_can_manage_connection(v_connection.organization_id, _actor_user_id) THEN
    RAISE EXCEPTION 'meta_disconnect_forbidden'
      USING ERRCODE = '42501';
  END IF;

  v_secret_id := v_connection.access_token_secret_id;

  UPDATE public.meta_connections
  SET status = 'disconnected',
      access_token_secret_id = NULL,
      token_expires_at = NULL,
      disconnected_at = clock_timestamp(),
      last_error_code = NULL
  WHERE id = v_connection.id;

  UPDATE public.meta_connection_channels
  SET status = 'disconnected'
  WHERE connection_id = v_connection.id;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;

  INSERT INTO public.meta_connection_audit_logs (
    organization_id, client_id, connection_id, actor_user_id,
    action, result, reason_code, request_id
  ) VALUES (
    v_connection.organization_id, v_connection.client_id, v_connection.id,
    _actor_user_id, 'disconnected', 'success',
    COALESCE(_reason_code, 'user_requested'), _request_id
  );
END;
$$;

-- Sanitized audit entry point for callback failures and health checks. It has
-- no payload parameter and derives organization scope from the client/connection.
CREATE OR REPLACE FUNCTION public.meta_server_record_audit(
  _client_id UUID,
  _connection_id UUID,
  _actor_user_id UUID,
  _action TEXT,
  _result TEXT,
  _reason_code TEXT DEFAULT NULL,
  _request_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_organization_id UUID;
  v_log_id UUID;
BEGIN
  SELECT c.organization_id INTO v_organization_id
  FROM public.clients c
  WHERE c.id = _client_id;

  IF v_organization_id IS NULL
     OR (_actor_user_id IS NOT NULL
         AND NOT public.meta_can_manage_connection(v_organization_id, _actor_user_id))
     OR (_connection_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.meta_connections mc
       WHERE mc.id = _connection_id
         AND mc.client_id = _client_id
         AND mc.organization_id = v_organization_id
     )) THEN
    RAISE EXCEPTION 'meta_audit_forbidden'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.meta_connection_audit_logs (
    organization_id, client_id, connection_id, actor_user_id,
    action, result, reason_code, request_id
  ) VALUES (
    v_organization_id, _client_id, _connection_id, _actor_user_id,
    _action, _result, _reason_code, _request_id
  ) RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

COMMENT ON FUNCTION public.meta_server_get_connection_token(UUID) IS
  'Server-only decrypted Meta token reader. EXECUTE is restricted to service_role; never expose through frontend RPC calls.';

-- Revoke the implicit PUBLIC EXECUTE granted by PostgreSQL, then grant only the
-- exact server entry points to service_role. API roles receive no access.
REVOKE ALL ON FUNCTION public.meta_server_create_oauth_state(UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_server_consume_oauth_state(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_server_create_pending_connection(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT[], UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_server_replace_connection_token(UUID, UUID, TEXT, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_server_get_connection_token(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_server_remove_connection_token(UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_server_finalize_connection(UUID, UUID, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_server_disconnect_connection(UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.meta_server_record_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.meta_server_create_oauth_state(UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_consume_oauth_state(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_create_pending_connection(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT[], UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_replace_connection_token(UUID, UUID, TEXT, TIMESTAMPTZ, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_get_connection_token(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_remove_connection_token(UUID, UUID, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_finalize_connection(UUID, UUID, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_disconnect_connection(UUID, UUID, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_record_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID)
  TO service_role;

COMMIT;
