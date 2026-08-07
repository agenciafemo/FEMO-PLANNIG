-- ============================================================================
-- Avisos de publicação + status de publicação por post.
--
-- 1) meta_server_mark_scheduled_published passa a criar uma NOTIFICAÇÃO ligada
--    ao planejamento quando o post é publicado (best-effort: nunca quebra a
--    marcação de publicado, mesmo se a tabela notifications mudar).
-- 2) get_posts_publish_status: leitura sanitizada do status de publicação de um
--    conjunto de posts (para o selo "Publicado/Agendado" dentro do planejamento).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.meta_scheduled_posts') IS NULL
     OR to_regclass('public.notifications') IS NULL
     OR to_regprocedure('public.is_org_member(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'meta_publish_notifications dependencies are missing';
  END IF;
END;
$$;

-- Substitui o marker de "publicado" para também registrar a notificação.
CREATE OR REPLACE FUNCTION public.meta_server_mark_scheduled_published(
  _id UUID, _media_id TEXT, _permalink TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sp public.meta_scheduled_posts%ROWTYPE;
  v_planning_id UUID;
  v_client_name TEXT;
BEGIN
  UPDATE public.meta_scheduled_posts
  SET status = 'published', instagram_media_id = _media_id,
      permalink = _permalink, error_code = NULL
  WHERE id = _id
  RETURNING * INTO v_sp;

  IF v_sp.id IS NULL THEN
    RETURN;
  END IF;

  SELECT p.planning_id INTO v_planning_id FROM public.posts p WHERE p.id = v_sp.post_id;
  SELECT c.name INTO v_client_name FROM public.clients c WHERE c.id = v_sp.client_id;

  -- Best-effort: um erro ao notificar nunca deve desfazer a publicação.
  BEGIN
    INSERT INTO public.notifications (
      user_id, organization_id, type, title, body, planning_id, read
    ) VALUES (
      v_sp.created_by, v_sp.organization_id, 'post_published',
      'Publicação feita no Instagram',
      COALESCE(v_client_name, 'Cliente') || ' — um post agendado foi publicado.',
      v_planning_id, false
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

-- Status de publicação de um conjunto de posts (para o selo no planejamento).
-- Devolve a linha mais recente por post; ignora canceladas. Só membros da org.
CREATE OR REPLACE FUNCTION public.get_posts_publish_status(_post_ids UUID[])
RETURNS TABLE (
  post_id UUID,
  status TEXT,
  permalink TEXT,
  scheduled_for TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (sp.post_id)
    sp.post_id, sp.status, sp.permalink, sp.scheduled_for
  FROM public.meta_scheduled_posts sp
  WHERE sp.post_id = ANY(_post_ids)
    AND sp.post_id IS NOT NULL
    AND public.is_org_member(sp.organization_id, auth.uid())
    AND sp.status <> 'canceled'
  ORDER BY sp.post_id, sp.scheduled_for DESC;
$$;

REVOKE ALL ON FUNCTION public.get_posts_publish_status(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_posts_publish_status(UUID[]) TO authenticated;

-- meta_server_mark_scheduled_published continua sendo só do service_role
-- (o CREATE OR REPLACE preserva os grants existentes; reforçamos por garantia).
REVOKE ALL ON FUNCTION public.meta_server_mark_scheduled_published(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_server_mark_scheduled_published(UUID, TEXT, TEXT)
  TO service_role;

COMMIT;
