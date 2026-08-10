-- ============================================================================
-- META — detecção de token morto (erro 190) → reconexão necessária + aviso.
--
-- Quando o worker de publicação recebe um erro 190 da Meta (token/sessão
-- invalidada, ex.: 190_460), o agendamento falha com um código críptico e o
-- time só descobre pelo post que não saiu. Esta RPC deixa o worker sinalizar a
-- conexão como 'reauth_required' (a tela passa a mostrar "Reconectar") e cria
-- uma notificação para quem conectou o cliente. Só o service_role (worker) chama.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.meta_connections') IS NULL
     OR to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'meta_reauth_detection: dependencias ausentes';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.meta_server_flag_connection_reauth(_connection_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn public.meta_connections%ROWTYPE;
  v_client_name TEXT;
BEGIN
  -- Só rebaixa conexões ATIVAS (não sobrescreve disconnected/pending).
  UPDATE public.meta_connections
  SET status = 'reauth_required'
  WHERE id = _connection_id AND status = 'active'
  RETURNING * INTO v_conn;

  IF v_conn.id IS NULL THEN
    RETURN; -- não estava ativa (ou não existe): nada a fazer
  END IF;

  SELECT c.name INTO v_client_name FROM public.clients c WHERE c.id = v_conn.client_id;

  -- Best-effort: falhar ao notificar nunca deve desfazer o flag de reconexão.
  BEGIN
    INSERT INTO public.notifications (user_id, organization_id, type, title, body, read)
    VALUES (
      v_conn.connected_by, v_conn.organization_id, 'meta_reauth_required',
      'Reconecte a conta da Meta',
      COALESCE(v_client_name, 'Um cliente')
        || ' — a conexão do Instagram/Facebook caiu (sessão expirada). Reconecte para os agendamentos voltarem a publicar.',
      false
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.meta_server_flag_connection_reauth(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_flag_connection_reauth(UUID) TO service_role;

COMMIT;
