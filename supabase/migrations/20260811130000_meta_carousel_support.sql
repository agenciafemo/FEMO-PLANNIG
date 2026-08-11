-- ============================================================================
-- META CAROUSEL SUPPORT — permite agendar/publicar CARROSSEL (2 a 10 imagens).
--
-- Bug corrigido: a fila não conhecia 'carousel'. Um post de carrossel caía no
-- default 'image' e só a CAPA era publicada como foto única no feed. Agora
-- 'carousel' é tipo de primeira classe: guarda a lista de imagens em
-- children_urls e o worker publica com media_type=CAROUSEL (container-pai com
-- filhos is_carousel_item).
--
-- Depende da migration de story (mesma função create_scheduled_post). Recria a
-- função com o novo parâmetro _children_urls (assinatura muda -> DROP + CREATE
-- + re-GRANT) cobrindo image/reels/story/carousel. Idempotente/seguro.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.meta_scheduled_posts') IS NULL
     OR to_regprocedure('public.meta_can_manage_connection(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'meta_carousel_support: meta_scheduled_posts/foundations ausentes';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1) Coluna children_urls + constraints (media_type e coerência por tipo).
-- ---------------------------------------------------------------------------
ALTER TABLE public.meta_scheduled_posts
  ADD COLUMN IF NOT EXISTS children_urls TEXT[];

ALTER TABLE public.meta_scheduled_posts
  DROP CONSTRAINT IF EXISTS meta_scheduled_posts_media_type_valid;
ALTER TABLE public.meta_scheduled_posts
  ADD CONSTRAINT meta_scheduled_posts_media_type_valid
  CHECK (media_type IN ('image', 'reels', 'story', 'carousel'));

-- Carrossel exige de 2 a 10 imagens, todas https. Os demais tipos seguem iguais.
ALTER TABLE public.meta_scheduled_posts
  DROP CONSTRAINT IF EXISTS meta_scheduled_posts_media_consistent;
ALTER TABLE public.meta_scheduled_posts
  ADD CONSTRAINT meta_scheduled_posts_media_consistent
  CHECK (
    (media_type = 'image' AND image_url IS NOT NULL AND video_url IS NULL)
    OR (media_type = 'reels' AND video_url IS NOT NULL)
    OR (media_type = 'story' AND (image_url IS NOT NULL OR video_url IS NOT NULL))
    OR (
      media_type = 'carousel'
      AND children_urls IS NOT NULL
      AND array_length(children_urls, 1) BETWEEN 2 AND 10
    )
  );

-- Todas as URLs de children precisam ser https (a Meta baixa cada imagem).
-- CHECK não aceita subquery; por isso a validação vai numa função IMMUTABLE
-- (o unnest fica dentro dela, o que é permitido).
CREATE OR REPLACE FUNCTION public.meta_children_all_https(_urls TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _urls IS NULL
      OR NOT EXISTS (SELECT 1 FROM unnest(_urls) AS u WHERE u !~ '^https://');
$$;

ALTER TABLE public.meta_scheduled_posts
  DROP CONSTRAINT IF EXISTS meta_scheduled_posts_children_urls_https;
ALTER TABLE public.meta_scheduled_posts
  ADD CONSTRAINT meta_scheduled_posts_children_urls_https
  CHECK (public.meta_children_all_https(children_urls));

-- ---------------------------------------------------------------------------
-- 2) create_scheduled_post: novo parâmetro _children_urls (image/reels/story/
--    carousel). A assinatura muda -> derruba a de 9 args e recria com 10.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_scheduled_post(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION public.create_scheduled_post(
  _client_id UUID,
  _connection_id UUID,
  _media_type TEXT DEFAULT 'image',
  _image_url TEXT DEFAULT NULL,
  _video_url TEXT DEFAULT NULL,
  _cover_url TEXT DEFAULT NULL,
  _caption TEXT DEFAULT '',
  _scheduled_for TIMESTAMPTZ DEFAULT now(),
  _post_id UUID DEFAULT NULL,
  _children_urls TEXT[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_id UUID;
  v_url TEXT;
BEGIN
  SELECT c.organization_id INTO v_org FROM public.clients c WHERE c.id = _client_id;
  IF v_org IS NULL OR NOT public.meta_can_manage_connection(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'meta_schedule_forbidden' USING ERRCODE = '42501';
  END IF;

  IF _media_type NOT IN ('image', 'reels', 'story', 'carousel') THEN
    RAISE EXCEPTION 'meta_schedule_media_type_invalid' USING ERRCODE = '22023';
  END IF;

  IF _media_type = 'image' THEN
    IF _image_url IS NULL OR _image_url !~ '^https://' THEN
      RAISE EXCEPTION 'meta_schedule_image_invalid' USING ERRCODE = '22023';
    END IF;
  ELSIF _media_type = 'reels' THEN
    IF _video_url IS NULL OR _video_url !~ '^https://' OR _video_url ~* 'drive\.google\.com' THEN
      RAISE EXCEPTION 'meta_schedule_video_invalid' USING ERRCODE = '22023';
    END IF;
    IF _cover_url IS NOT NULL AND _cover_url !~ '^https://' THEN
      RAISE EXCEPTION 'meta_schedule_cover_invalid' USING ERRCODE = '22023';
    END IF;
  ELSIF _media_type = 'story' THEN
    IF _image_url IS NULL AND _video_url IS NULL THEN
      RAISE EXCEPTION 'meta_schedule_story_media_missing' USING ERRCODE = '22023';
    END IF;
    IF _image_url IS NOT NULL AND _image_url !~ '^https://' THEN
      RAISE EXCEPTION 'meta_schedule_image_invalid' USING ERRCODE = '22023';
    END IF;
    IF _video_url IS NOT NULL AND (_video_url !~ '^https://' OR _video_url ~* 'drive\.google\.com') THEN
      RAISE EXCEPTION 'meta_schedule_video_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE -- carousel: 2 a 10 imagens https
    IF _children_urls IS NULL OR array_length(_children_urls, 1) IS NULL
       OR array_length(_children_urls, 1) < 2 OR array_length(_children_urls, 1) > 10 THEN
      RAISE EXCEPTION 'meta_schedule_carousel_count_invalid' USING ERRCODE = '22023';
    END IF;
    FOREACH v_url IN ARRAY _children_urls LOOP
      IF v_url IS NULL OR v_url !~ '^https://' OR v_url ~* 'drive\.google\.com' THEN
        RAISE EXCEPTION 'meta_schedule_carousel_url_invalid' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.meta_scheduled_posts (
    organization_id, client_id, connection_id, post_id,
    media_type, image_url, video_url, cover_url, children_urls, caption, scheduled_for, created_by
  ) VALUES (
    v_org, _client_id, _connection_id, _post_id,
    _media_type,
    CASE WHEN _media_type IN ('image', 'story') THEN _image_url ELSE NULL END,
    CASE WHEN _media_type IN ('reels', 'story') THEN _video_url ELSE NULL END,
    CASE WHEN _media_type = 'reels' THEN _cover_url ELSE NULL END,
    CASE WHEN _media_type = 'carousel' THEN _children_urls ELSE NULL END,
    COALESCE(_caption, ''), COALESCE(_scheduled_for, now()), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_scheduled_post(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_scheduled_post(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT[])
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) claim do worker: devolve também children_urls (RETURNS TABLE muda).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.meta_server_claim_due_scheduled_posts(INT);

CREATE OR REPLACE FUNCTION public.meta_server_claim_due_scheduled_posts(_limit INT DEFAULT 5)
RETURNS TABLE (
  id UUID,
  connection_id UUID,
  instagram_account_id TEXT,
  media_type TEXT,
  image_url TEXT,
  video_url TEXT,
  cover_url TEXT,
  children_urls TEXT[],
  caption TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    sp.connection_id,
    (SELECT ch.external_account_id
       FROM public.meta_connection_channels ch
      WHERE ch.connection_id = sp.connection_id
        AND ch.channel_type = 'instagram'
        AND ch.status = 'active'
      LIMIT 1),
    sp.media_type,
    sp.image_url,
    sp.video_url,
    sp.cover_url,
    sp.children_urls,
    sp.caption;
END;
$$;

REVOKE ALL ON FUNCTION public.meta_server_claim_due_scheduled_posts(INT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_claim_due_scheduled_posts(INT) TO service_role;

COMMIT;
