-- ============================================================================
-- meta_server_create_pending_connection passa a gravar o NOME da conta Meta
-- que autorizou (ver 20260821260000_meta_connection_author.sql).
--
-- Em transação e com DROP antes: o parâmetro novo mudaria a assinatura e as
-- duas versões coexistiriam, deixando a chamada de 6 argumentos ambígua — o
-- que quebraria o OAuth inteiro. Ou vale a nova, ou nada muda.
--
-- Mantém REVOKE de todos os papéis: é função de uso exclusivamente interno,
-- chamada pela Edge Function com a service key.
-- Idempotente.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.meta_server_create_pending_connection(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT[], UUID
);

CREATE OR REPLACE FUNCTION public.meta_server_create_pending_connection(
  _oauth_state_id UUID,
  _meta_user_id TEXT,
  _access_token TEXT,
  _token_expires_at TIMESTAMPTZ,
  _granted_scopes TEXT[],
  _request_id UUID DEFAULT NULL,
  _meta_user_name TEXT DEFAULT NULL
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
    id, organization_id, client_id, status, meta_user_id, meta_user_name,
    access_token_secret_id, token_expires_at, granted_scopes, connected_by
  ) VALUES (
    v_connection_id, v_state.organization_id, v_state.client_id, 'pending',
    _meta_user_id, NULLIF(btrim(COALESCE(_meta_user_name, '')), ''),
    v_secret_id, _token_expires_at,
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

REVOKE ALL ON FUNCTION public.meta_server_create_pending_connection(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT[], UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
