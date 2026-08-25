-- ============================================================================
-- Devolve EXECUTE ao service_role nas tres funcoes de OAuth da Meta.
--
-- POR QUE ISSO QUEBROU:
-- Recriar uma funcao (DROP + CREATE) DESCARTA os privilegios dela. A migration
-- original (20260721150000) sabia disso e fazia REVOKE seguido de GRANT. As
-- migrations de 24/08 que adicionaram o parametro _provider recriaram as
-- funcoes e fizeram so o REVOKE:
--
--   20260824170000  meta_server_consume_oauth_state         (sem GRANT)
--   20260824180000  meta_server_create_oauth_state          (sem GRANT)
--   20260824190000  meta_server_create_pending_connection   (sem GRANT)
--
-- As Edge Functions chamam o banco como service_role. Sem EXECUTE, a RPC volta
-- erro e o usuario ve "oauth_state_create_failed" ao clicar em conectar.
--
-- O REVOKE de PUBLIC/anon/authenticated continua valendo e e proposital: essas
-- funcoes sao SECURITY DEFINER e mexem no cofre de tokens. So o servidor entra.
-- ============================================================================

BEGIN;

GRANT EXECUTE ON FUNCTION public.meta_server_create_oauth_state(
  UUID, UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, UUID, TEXT
) TO service_role;

GRANT EXECUTE ON FUNCTION public.meta_server_consume_oauth_state(TEXT)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.meta_server_create_pending_connection(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT[], UUID, TEXT, TEXT
) TO service_role;

COMMIT;
