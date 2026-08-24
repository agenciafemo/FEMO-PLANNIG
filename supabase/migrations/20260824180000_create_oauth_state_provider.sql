-- ============================================================================
-- meta_server_create_oauth_state passa a gravar a PORTA no state.
-- Ver 20260824170000_oauth_state_provider.sql para o porquê.
--
-- DROP antes: o parâmetro novo mudaria a assinatura e as duas versões
-- coexistiriam, deixando a chamada de 7 argumentos ambígua — o que quebraria o
-- início do OAuth inteiro. Em transação: ou vale a nova, ou nada muda.
-- Idempotente.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.meta_server_create_oauth_state(
  UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, UUID
);

CREATE OR REPLACE FUNCTION public.meta_server_create_oauth_state(
  _client_id UUID,
  _requested_by UUID,
  _state_hash TEXT,
  _requested_scopes TEXT[],
  _redirect_path TEXT,
  _expires_at TIMESTAMPTZ,
  _request_id UUID DEFAULT NULL,
  _provider TEXT DEFAULT 'facebook'
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
    expires_at,
    provider
  )
  VALUES (
    v_organization_id,
    _client_id,
    _requested_by,
    _state_hash,
    COALESCE(_requested_scopes, ARRAY[]::TEXT[]),
    _redirect_path,
    _expires_at,
    CASE WHEN _provider = 'instagram' THEN 'instagram' ELSE 'facebook' END
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

REVOKE ALL ON FUNCTION public.meta_server_create_oauth_state(
  UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
