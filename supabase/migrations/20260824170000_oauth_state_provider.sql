-- ============================================================================
-- O `state` do OAuth passa a carregar a PORTA usada.
--
-- Sem isto o callback não tem como saber se o código que voltou veio do login
-- do Facebook ou do login do Instagram — e os dois trocam o código por token em
-- endpoints diferentes, com credenciais diferentes. O state é o único carona
-- que atravessa o redirecionamento, então é nele que a informação viaja.
--
-- Aditiva: nasce 'facebook', que é o que todo state existente é.
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.meta_oauth_states
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'facebook';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_oauth_states_provider_valid'
  ) THEN
    ALTER TABLE public.meta_oauth_states
      ADD CONSTRAINT meta_oauth_states_provider_valid
      CHECK (provider IN ('facebook', 'instagram'));
  END IF;
END $$;

-- Consumo devolve a porta. DROP antes: o RETURNS TABLE ganha coluna, e
-- CREATE OR REPLACE não muda tipo de retorno (42P13). Em transação para não
-- existir instante sem a função — ela é o coração do retorno do OAuth.
DROP FUNCTION IF EXISTS public.meta_server_consume_oauth_state(TEXT);

CREATE OR REPLACE FUNCTION public.meta_server_consume_oauth_state(_state_hash TEXT)
RETURNS TABLE (
  oauth_state_id UUID,
  organization_id UUID,
  client_id UUID,
  requested_by UUID,
  requested_scopes TEXT[],
  redirect_path TEXT,
  provider TEXT
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
    redirect_path,
    COALESCE(provider, 'facebook')
$$;

REVOKE ALL ON FUNCTION public.meta_server_consume_oauth_state(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
