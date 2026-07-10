-- ============================================================================
-- RPC PÚBLICA — get_public_all_video_scripts
--
-- Retorna todos os roteiros de vídeo dos planejamentos do cliente identificado
-- pelo token público, em uma única chamada (substitui o loop client-side que
-- chamaria get_public_video_scripts por planejamento na aba "Roteiros").
--
-- SECURITY DEFINER + validação de token a cada chamada (existência, não
-- revogado, não expirado). Não vaza dados de outro cliente: o filtro passa por
-- video_scripts -> plannings -> clients pelo public_link_token.
--
-- Aditiva. Depende só de tabelas base (video_scripts, plannings, clients) e das
-- colunas public_link_revoked/public_link_expires_at da Migration 1.
-- NÃO aplicar em produção. NÃO aplicar no staging até autorização do plano.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_all_video_scripts(_token TEXT)
RETURNS SETOF public.video_scripts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vs.* FROM public.video_scripts vs
  JOIN public.plannings pl ON pl.id = vs.planning_id
  JOIN public.clients c    ON c.id = pl.client_id
  WHERE c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
  ORDER BY vs.planning_id, vs.position, vs.created_at
$$;

REVOKE ALL ON FUNCTION public.get_public_all_video_scripts(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_all_video_scripts(TEXT) TO anon, authenticated;

COMMIT;
