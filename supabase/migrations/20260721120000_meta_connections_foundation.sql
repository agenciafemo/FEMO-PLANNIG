-- ============================================================================
-- META INTEGRATION - DATABASE FOUNDATION ONLY
--
-- This migration does not perform OAuth, publish content, schedule jobs, create
-- tokens, or call Meta. Tokens must be created later by trusted server-side
-- code and stored in Supabase Vault. Public tables keep only the Vault secret
-- UUID, which is never exposed by the public status RPC.
-- ============================================================================

BEGIN;

-- Fail before creating anything if the multi-tenant or Vault foundations are
-- not available. This migration intentionally does not create/replace them.
DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.organization_members') IS NULL
     OR to_regclass('public.clients') IS NULL
     OR to_regclass('vault.secrets') IS NULL
     OR to_regprocedure('public.is_org_member(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_org_role(uuid,uuid)') IS NULL
     OR to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'Meta foundation dependencies are missing';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- META_CONNECTIONS
-- One active/pending connection per client in phase 1. No token plaintext is
-- stored here: access_token_secret_id only references vault.secrets(id).
-- ---------------------------------------------------------------------------
CREATE TABLE public.meta_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending',
  meta_user_id TEXT,
  access_token_secret_id UUID UNIQUE REFERENCES vault.secrets(id) ON DELETE RESTRICT,
  token_expires_at TIMESTAMPTZ,
  granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  connected_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  connected_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meta_connections_status_valid CHECK (
    status IN ('pending', 'active', 'reauth_required', 'disconnected', 'error')
  ),
  CONSTRAINT meta_connections_active_token_required CHECK (
    status <> 'active' OR access_token_secret_id IS NOT NULL
  ),
  CONSTRAINT meta_connections_disconnected_at_required CHECK (
    status <> 'disconnected' OR disconnected_at IS NOT NULL
  ),
  CONSTRAINT meta_connections_error_code_sanitized CHECK (
    last_error_code IS NULL
    OR last_error_code ~ '^[A-Za-z0-9_.:-]{1,100}$'
  ),
  CONSTRAINT meta_connections_id_scope_unique UNIQUE (id, organization_id, client_id)
);

COMMENT ON TABLE public.meta_connections IS
  'Server-managed Meta connections. Direct API access is revoked; frontend reads only through get_client_meta_connection_status.';
COMMENT ON COLUMN public.meta_connections.access_token_secret_id IS
  'Reference to a Meta access token stored in Supabase Vault. The token and this UUID are never returned by the public status RPC.';

CREATE UNIQUE INDEX meta_connections_one_live_per_client_idx
  ON public.meta_connections (client_id)
  WHERE status IN ('pending', 'active', 'reauth_required', 'error');
CREATE INDEX meta_connections_organization_idx
  ON public.meta_connections (organization_id, status);
CREATE INDEX meta_connections_health_idx
  ON public.meta_connections (status, last_verified_at);

ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- META_CONNECTION_CHANNELS
-- Sanitized Page/Instagram metadata only. It never stores access tokens,
-- authorization codes, raw API responses, or encrypted payloads.
-- ---------------------------------------------------------------------------
CREATE TABLE public.meta_connection_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  client_id UUID NOT NULL,
  channel_type TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  username TEXT,
  account_type TEXT,
  page_tasks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'discovered',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meta_connection_channels_connection_scope_fk
    FOREIGN KEY (connection_id, organization_id, client_id)
    REFERENCES public.meta_connections(id, organization_id, client_id)
    ON DELETE CASCADE,
  CONSTRAINT meta_connection_channels_type_valid CHECK (
    channel_type IN ('facebook_page', 'instagram')
  ),
  CONSTRAINT meta_connection_channels_status_valid CHECK (
    status IN ('discovered', 'active', 'unavailable', 'permission_missing', 'disconnected')
  ),
  CONSTRAINT meta_connection_channels_external_id_not_blank CHECK (
    btrim(external_account_id) <> ''
  ),
  CONSTRAINT meta_connection_channels_display_name_not_blank CHECK (
    btrim(display_name) <> ''
  ),
  CONSTRAINT meta_connection_channels_external_unique
    UNIQUE (connection_id, channel_type, external_account_id)
);

COMMENT ON TABLE public.meta_connection_channels IS
  'Sanitized Meta Page and Instagram account metadata. No token, code, secret, ciphertext, or raw Meta response is stored.';

CREATE INDEX meta_connection_channels_organization_idx
  ON public.meta_connection_channels (organization_id, client_id);
CREATE INDEX meta_connection_channels_connection_status_idx
  ON public.meta_connection_channels (connection_id, status);

ALTER TABLE public.meta_connection_channels ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- META_OAUTH_STATES
-- Internal, one-time OAuth state records. state_hash is the lowercase hex
-- SHA-256 digest of the state sent to Meta; the raw state is never stored.
-- ---------------------------------------------------------------------------
CREATE TABLE public.meta_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  requested_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  redirect_path TEXT NOT NULL DEFAULT '/clients',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meta_oauth_states_hash_sha256_hex CHECK (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT meta_oauth_states_redirect_path_local CHECK (
    redirect_path LIKE '/%'
    AND redirect_path NOT LIKE '//%'
    AND redirect_path !~ '[[:cntrl:]]'
  ),
  CONSTRAINT meta_oauth_states_expiry_after_creation CHECK (
    expires_at > created_at
  ),
  CONSTRAINT meta_oauth_states_used_after_creation CHECK (
    used_at IS NULL OR used_at >= created_at
  )
);

COMMENT ON TABLE public.meta_oauth_states IS
  'Internal one-time OAuth state hashes. No frontend role has direct table access and raw OAuth state/code is never stored.';

CREATE INDEX meta_oauth_states_expiry_idx
  ON public.meta_oauth_states (expires_at)
  WHERE used_at IS NULL;
CREATE INDEX meta_oauth_states_requester_idx
  ON public.meta_oauth_states (requested_by, created_at DESC);

ALTER TABLE public.meta_oauth_states ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- META_CONNECTION_AUDIT_LOGS
-- Append-only, structurally minimal audit data. There is deliberately no JSON
-- payload or free-form API response column that could accidentally retain a
-- token, OAuth code, raw state, App Secret, or raw Meta response.
-- ---------------------------------------------------------------------------
CREATE TABLE public.meta_connection_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  connection_id UUID,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  reason_code TEXT,
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meta_connection_audit_connection_scope_fk
    FOREIGN KEY (connection_id, organization_id, client_id)
    REFERENCES public.meta_connections(id, organization_id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT meta_connection_audit_action_valid CHECK (
    action IN (
      'oauth_started', 'oauth_completed', 'oauth_failed',
      'connection_activated', 'health_checked',
      'reauth_required', 'disconnected'
    )
  ),
  CONSTRAINT meta_connection_audit_result_valid CHECK (
    result IN ('pending', 'success', 'denied', 'failure')
  ),
  CONSTRAINT meta_connection_audit_reason_code_sanitized CHECK (
    reason_code IS NULL
    OR reason_code ~ '^[A-Za-z0-9_.:-]{1,100}$'
  )
);

COMMENT ON TABLE public.meta_connection_audit_logs IS
  'Append-only minimal audit. Fixed action/result plus sanitized reason code; no arbitrary payload or raw Meta response columns.';

CREATE INDEX meta_connection_audit_organization_idx
  ON public.meta_connection_audit_logs (organization_id, created_at DESC);
CREATE INDEX meta_connection_audit_connection_idx
  ON public.meta_connection_audit_logs (connection_id, created_at DESC);
CREATE INDEX meta_connection_audit_actor_idx
  ON public.meta_connection_audit_logs (actor_user_id, created_at DESC);

ALTER TABLE public.meta_connection_audit_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- INTERNAL AUTHORIZATION AND SCOPE-INTEGRITY HELPERS
-- These functions are intentionally unavailable to API roles. Public Edge
-- Functions will perform their own JWT checks and invoke future server-only
-- mutation functions; no mutation function is introduced in this migration.
-- ---------------------------------------------------------------------------
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
    AND public.get_org_role(_organization_id, _user_id) IN ('owner', 'admin', 'manager')
$$;

CREATE OR REPLACE FUNCTION public.enforce_meta_connection_client_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = NEW.client_id
      AND c.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'meta_connection_client_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_meta_channel_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT mc.organization_id, mc.client_id
  INTO NEW.organization_id, NEW.client_id
  FROM public.meta_connections mc
  WHERE mc.id = NEW.connection_id;

  IF NEW.organization_id IS NULL OR NEW.client_id IS NULL THEN
    RAISE EXCEPTION 'meta_channel_connection_not_found'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_meta_oauth_state_client_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = NEW.client_id
      AND c.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'meta_oauth_state_client_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_meta_audit_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.connection_id IS NOT NULL THEN
    SELECT mc.organization_id, mc.client_id
    INTO NEW.organization_id, NEW.client_id
    FROM public.meta_connections mc
    WHERE mc.id = NEW.connection_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = NEW.client_id
      AND c.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'meta_audit_client_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_meta_connection_client_scope
BEFORE INSERT OR UPDATE OF organization_id, client_id
ON public.meta_connections
FOR EACH ROW EXECUTE FUNCTION public.enforce_meta_connection_client_scope();

CREATE TRIGGER sync_meta_channel_scope
BEFORE INSERT OR UPDATE OF connection_id, organization_id, client_id
ON public.meta_connection_channels
FOR EACH ROW EXECUTE FUNCTION public.sync_meta_channel_scope();

CREATE TRIGGER enforce_meta_oauth_state_client_scope
BEFORE INSERT OR UPDATE OF organization_id, client_id
ON public.meta_oauth_states
FOR EACH ROW EXECUTE FUNCTION public.enforce_meta_oauth_state_client_scope();

CREATE TRIGGER enforce_meta_audit_scope
BEFORE INSERT OR UPDATE OF connection_id, organization_id, client_id
ON public.meta_connection_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.enforce_meta_audit_scope();

CREATE TRIGGER update_meta_connections_updated_at
BEFORE UPDATE ON public.meta_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_meta_connection_channels_updated_at
BEFORE UPDATE ON public.meta_connection_channels
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS DEFENSE IN DEPTH
-- Direct table grants remain revoked below. These SELECT policies define the
-- intended tenant boundary even if a future grant is added accidentally.
-- There are intentionally no INSERT/UPDATE/DELETE policies for API users.
-- ---------------------------------------------------------------------------
CREATE POLICY meta_connections_member_select
ON public.meta_connections
FOR SELECT TO authenticated
USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY meta_connection_channels_member_select
ON public.meta_connection_channels
FOR SELECT TO authenticated
USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY meta_connection_audit_manager_select
ON public.meta_connection_audit_logs
FOR SELECT TO authenticated
USING (public.meta_can_manage_connection(organization_id, auth.uid()));

-- No policy is created for meta_oauth_states. It is server-only.

-- ---------------------------------------------------------------------------
-- SANITIZED PUBLIC STATUS RPC
-- Returns one row per channel, or one row with NULL channel fields when the
-- client has no connection. It never returns access_token_secret_id or OAuth
-- state data. Unauthorized users receive zero rows to avoid enumeration.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- EXPLICIT GRANTS AND REVOKES
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.meta_connections
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.meta_connection_channels
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.meta_oauth_states
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.meta_connection_audit_logs
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.meta_can_manage_connection(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_meta_connection_client_scope()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_meta_channel_scope()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_meta_oauth_state_client_scope()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_meta_audit_scope()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_client_meta_connection_status(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_meta_connection_status(UUID)
  TO authenticated;

COMMIT;
