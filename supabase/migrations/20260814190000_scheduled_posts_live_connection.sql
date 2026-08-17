-- ============================================================================
-- CORRECAO PERMANENTE: agendamento resiliente a reconexao.
--
-- O claim RPC resolvia a conta do IG pela conexao GUARDADA no post
-- (sp.connection_id). Quando um cliente reconecta, essa conexao antiga morre e
-- o post fica orfao (instagram_account_missing). Agora o RPC resolve a conexao
-- e a conta pela CONEXAO ATIVA ATUAL do cliente (fallback: a guardada). Assim
-- reconectar nunca mais quebra os agendamentos. Mesma assinatura/colunas -> nao
-- exige redeploy da funcao meta-publish.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.meta_server_claim_due_scheduled_posts(_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, connection_id uuid, instagram_account_id text, media_type text, image_url text, video_url text, cover_url text, children_urls text[], caption text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT sp.id
    FROM public.meta_scheduled_posts sp
    WHERE sp.status = 'queued' AND sp.scheduled_for <= now()
    ORDER BY sp.scheduled_for
    LIMIT GREATEST(COALESCE(_limit, 5), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.meta_scheduled_posts sp
  SET status = 'processing', attempts = sp.attempts + 1
  FROM due
  WHERE sp.id = due.id
  RETURNING
    sp.id,
    -- Conexao ATIVA atual do cliente (fallback: a guardada no post).
    COALESCE(
      (SELECT mc.id FROM public.meta_connections mc
        WHERE mc.client_id = sp.client_id AND mc.status = 'active'
        ORDER BY mc.updated_at DESC LIMIT 1),
      sp.connection_id
    ),
    -- Conta de IG da conexao ativa atual do cliente.
    (SELECT ch.external_account_id
       FROM public.meta_connections mc
       JOIN public.meta_connection_channels ch ON ch.connection_id = mc.id
      WHERE mc.client_id = sp.client_id AND mc.status = 'active'
        AND ch.channel_type = 'instagram' AND ch.status = 'active'
      ORDER BY mc.updated_at DESC LIMIT 1),
    sp.media_type,
    sp.image_url,
    sp.video_url,
    sp.cover_url,
    sp.children_urls,
    sp.caption;
END;
$function$;
