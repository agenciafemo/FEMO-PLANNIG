-- ============================================================================
-- META — AVISO DE DESCONEXÃO (M3)
--
-- Quando a publicação falha por token/sessão inválida (erro 190/460), a
-- conexão fica "ativa fantasma": marcada como ativa no banco, mas incapaz de
-- publicar. Esta RPC marca a conexão como reauth_required (alimentando o banner
-- de reconexão) e notifica a equipe UMA ÚNICA VEZ (só na transição active ->
-- reauth_required), evitando spam a cada tentativa de publicação.
-- ============================================================================

BEGIN;

-- Notificações de conexão não têm planejamento associado. Relaxa a constraint
-- (idempotente: se já for nullable, é no-op).
ALTER TABLE public.notifications ALTER COLUMN planning_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.meta_server_mark_connection_reauth(
  _connection_id UUID,
  _reason_code TEXT DEFAULT NULL,
  _request_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_client UUID;
  v_owner UUID;
  v_client_name TEXT;
BEGIN
  -- Só demove conexões ATIVAS: garante que a notificação saia apenas na
  -- transição (uma vez), não a cada publicação enquanto segue reauth_required.
  UPDATE public.meta_connections
     SET status = 'reauth_required'
   WHERE id = _connection_id
     AND status = 'active'
   RETURNING organization_id, client_id, connected_by
     INTO v_org, v_client, v_owner;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT name INTO v_client_name FROM public.clients WHERE id = v_client;

  -- Notificação é best-effort: se a tabela variar, a mudança de status já
  -- alimenta o banner de reconexão (o aviso principal).
  BEGIN
    INSERT INTO public.notifications (user_id, organization_id, type, title, body, read)
    VALUES (
      v_owner,
      v_org,
      'meta_reauth_required',
      'Conexão do Instagram caiu',
      COALESCE(v_client_name, 'Um cliente')
        || ' precisa reconectar o Instagram/Meta — a publicação fica pausada até reconectar (em Clientes).',
      false
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.meta_server_mark_connection_reauth(UUID, TEXT, TEXT) IS
  'Marca uma conexão Meta ativa como reauth_required (queda detectada na publicação) e notifica a equipe uma única vez.';

REVOKE ALL ON FUNCTION public.meta_server_mark_connection_reauth(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_server_mark_connection_reauth(UUID, TEXT, TEXT)
  TO service_role;

COMMIT;
