-- ============================================================================
-- Finaliza o login DIRETO do Instagram sem exigir uma Pagina do Facebook.
--
-- O fluxo via Facebook continua usando meta_server_finalize_connection e a
-- escolha explicita de Pagina. Esta funcao aceita somente conexoes pendentes
-- cujo provider seja "instagram", cria apenas o canal Instagram e ativa a
-- conexao na mesma transacao.
--
-- SECURITY DEFINER e necessario porque as tabelas e o Vault sao server-only.
-- A funcao fica revogada de todas as funcoes publicas e liberada apenas para
-- service_role, que e usado pela Edge Function depois de validar o OAuth state.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.meta_server_finalize_instagram_connection(
  _connection_id UUID,
  _actor_user_id UUID,
  _instagram_account_id TEXT,
  _instagram_display_name TEXT,
  _instagram_username TEXT DEFAULT NULL,
  _instagram_account_type TEXT DEFAULT NULL,
  _request_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
     OR v_connection.provider <> 'instagram'
     OR v_connection.access_token_secret_id IS NULL
     OR NOT public.meta_can_manage_connection(
       v_connection.organization_id,
       _actor_user_id
     ) THEN
    RAISE EXCEPTION 'meta_instagram_connection_finalize_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF btrim(COALESCE(_instagram_account_id, '')) = ''
     OR btrim(COALESCE(_instagram_display_name, '')) = ''
     OR btrim(_instagram_account_id) <>
       btrim(COALESCE(v_connection.meta_user_id, '')) THEN
    RAISE EXCEPTION 'meta_instagram_channel_invalid'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.meta_connection_channels
  WHERE connection_id = v_connection.id;

  INSERT INTO public.meta_connection_channels (
    connection_id,
    organization_id,
    client_id,
    channel_type,
    external_account_id,
    display_name,
    username,
    account_type,
    status
  ) VALUES (
    v_connection.id,
    v_connection.organization_id,
    v_connection.client_id,
    'instagram',
    btrim(_instagram_account_id),
    btrim(_instagram_display_name),
    NULLIF(btrim(COALESCE(_instagram_username, '')), ''),
    NULLIF(btrim(COALESCE(_instagram_account_type, '')), ''),
    'active'
  );

  UPDATE public.meta_connections
  SET status = 'active',
      connected_at = clock_timestamp(),
      disconnected_at = NULL,
      last_verified_at = clock_timestamp(),
      last_error_code = NULL
  WHERE id = v_connection.id;

  INSERT INTO public.meta_connection_audit_logs (
    organization_id,
    client_id,
    connection_id,
    actor_user_id,
    action,
    result,
    request_id
  ) VALUES (
    v_connection.organization_id,
    v_connection.client_id,
    v_connection.id,
    _actor_user_id,
    'connection_activated',
    'success',
    _request_id
  );
END;
$$;

COMMENT ON FUNCTION public.meta_server_finalize_instagram_connection(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID
) IS
  'Server-only: activates a pending direct Instagram connection without a Facebook Page. No token is returned.';

REVOKE ALL ON FUNCTION public.meta_server_finalize_instagram_connection(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.meta_server_finalize_instagram_connection(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID
) TO service_role;

COMMIT;
