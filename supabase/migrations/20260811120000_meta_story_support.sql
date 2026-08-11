-- ============================================================================
-- META STORY SUPPORT — permite agendar/publicar STORIES (imagem ou vídeo).
--
-- Bug corrigido: a fila só aceitava media_type IN ('image','reels'). Um post
-- de story caía no default 'image' e era publicado no FEED (não no story). Aqui
-- 'story' vira um tipo de primeira classe: aceita imagem (image_url) OU vídeo
-- (video_url). O worker publica com media_type=STORIES na Graph API.
--
-- Idempotente/seguro: aborta limpo se a fila não existir; só relaxa constraints
-- e amplia a RPC create_scheduled_post (mesma assinatura -> CREATE OR REPLACE).
-- Linhas existentes de image/reels continuam válidas.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.meta_scheduled_posts') IS NULL
     OR to_regprocedure('public.meta_can_manage_connection(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'meta_story_support: meta_scheduled_posts/foundations ausentes';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1) Constraints: media_type passa a aceitar 'story'; coerência por tipo.
-- ---------------------------------------------------------------------------
ALTER TABLE public.meta_scheduled_posts
  DROP CONSTRAINT IF EXISTS meta_scheduled_posts_media_type_valid;
ALTER TABLE public.meta_scheduled_posts
  ADD CONSTRAINT meta_scheduled_posts_media_type_valid
  CHECK (media_type IN ('image', 'reels', 'story'));

-- Story aceita imagem OU vídeo (pelo menos um). Imagem e reels seguem iguais.
ALTER TABLE public.meta_scheduled_posts
  DROP CONSTRAINT IF EXISTS meta_scheduled_posts_media_consistent;
ALTER TABLE public.meta_scheduled_posts
  ADD CONSTRAINT meta_scheduled_posts_media_consistent
  CHECK (
    (media_type = 'image' AND image_url IS NOT NULL AND video_url IS NULL)
    OR (media_type = 'reels' AND video_url IS NOT NULL)
    OR (media_type = 'story' AND (image_url IS NOT NULL OR video_url IS NOT NULL))
  );

-- ---------------------------------------------------------------------------
-- 2) create_scheduled_post: aceita 'story' (imagem ou vídeo). Mesma assinatura.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_scheduled_post(
  _client_id UUID,
  _connection_id UUID,
  _media_type TEXT DEFAULT 'image',
  _image_url TEXT DEFAULT NULL,
  _video_url TEXT DEFAULT NULL,
  _cover_url TEXT DEFAULT NULL,
  _caption TEXT DEFAULT '',
  _scheduled_for TIMESTAMPTZ DEFAULT now(),
  _post_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_id UUID;
BEGIN
  SELECT c.organization_id INTO v_org FROM public.clients c WHERE c.id = _client_id;
  IF v_org IS NULL OR NOT public.meta_can_manage_connection(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'meta_schedule_forbidden' USING ERRCODE = '42501';
  END IF;

  IF _media_type NOT IN ('image', 'reels', 'story') THEN
    RAISE EXCEPTION 'meta_schedule_media_type_invalid' USING ERRCODE = '22023';
  END IF;

  IF _media_type = 'image' THEN
    IF _image_url IS NULL OR _image_url !~ '^https://' THEN
      RAISE EXCEPTION 'meta_schedule_image_invalid' USING ERRCODE = '22023';
    END IF;
  ELSIF _media_type = 'reels' THEN
    -- A Meta baixa o arquivo: precisa ser https direto. Link do Drive não serve.
    IF _video_url IS NULL OR _video_url !~ '^https://' OR _video_url ~* 'drive\.google\.com' THEN
      RAISE EXCEPTION 'meta_schedule_video_invalid' USING ERRCODE = '22023';
    END IF;
    IF _cover_url IS NOT NULL AND _cover_url !~ '^https://' THEN
      RAISE EXCEPTION 'meta_schedule_cover_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE -- story: imagem OU vídeo (exatamente pelo menos um)
    IF _image_url IS NULL AND _video_url IS NULL THEN
      RAISE EXCEPTION 'meta_schedule_story_media_missing' USING ERRCODE = '22023';
    END IF;
    IF _image_url IS NOT NULL AND _image_url !~ '^https://' THEN
      RAISE EXCEPTION 'meta_schedule_image_invalid' USING ERRCODE = '22023';
    END IF;
    IF _video_url IS NOT NULL AND (_video_url !~ '^https://' OR _video_url ~* 'drive\.google\.com') THEN
      RAISE EXCEPTION 'meta_schedule_video_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.meta_scheduled_posts (
    organization_id, client_id, connection_id, post_id,
    media_type, image_url, video_url, cover_url, caption, scheduled_for, created_by
  ) VALUES (
    v_org, _client_id, _connection_id, _post_id,
    _media_type,
    -- story guarda a imagem quando for story de imagem; feed usa image_url.
    CASE WHEN _media_type IN ('image', 'story') THEN _image_url ELSE NULL END,
    -- story guarda o vídeo quando for story de vídeo; reels usa video_url.
    CASE WHEN _media_type IN ('reels', 'story') THEN _video_url ELSE NULL END,
    CASE WHEN _media_type = 'reels' THEN _cover_url ELSE NULL END,
    COALESCE(_caption, ''), COALESCE(_scheduled_for, now()), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_scheduled_post(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_scheduled_post(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID)
  TO authenticated;

COMMIT;
