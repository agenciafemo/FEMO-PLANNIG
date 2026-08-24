-- ============================================================================
-- create_scheduled_post passa a aceitar o DESTINO (instagram | facebook).
--
-- Uma linha por destino: publicar "nos dois" e o app chamando esta funcao duas
-- vezes, uma por plataforma. Ver 20260824120000_publish_target_facebook.sql.
--
-- Em transacao e com DROP antes: o parametro novo mudaria a assinatura e as
-- duas versoes coexistiriam, deixando a chamada de 10 argumentos ambigua — o
-- que quebraria o agendamento inteiro.
-- Idempotente.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.create_scheduled_post(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT[]
);

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
  _children_urls TEXT[] DEFAULT NULL,
  _target TEXT DEFAULT 'instagram'
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
  v_target TEXT := COALESCE(NULLIF(btrim(_target), ''), 'instagram');
BEGIN
  SELECT c.organization_id INTO v_org FROM public.clients c WHERE c.id = _client_id;
  IF v_org IS NULL OR NOT public.meta_can_manage_connection(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'meta_schedule_forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_target NOT IN ('instagram', 'facebook') THEN
    RAISE EXCEPTION 'meta_schedule_target_invalid' USING ERRCODE = '22023';
  END IF;

  IF _media_type NOT IN ('image', 'reels', 'story', 'carousel', 'text') THEN
    RAISE EXCEPTION 'meta_schedule_media_type_invalid' USING ERRCODE = '22023';
  END IF;

  -- Post so de texto so existe na Pagina; o Instagram exige midia sempre.
  IF _media_type = 'text' AND v_target <> 'facebook' THEN
    RAISE EXCEPTION 'meta_schedule_text_facebook_only' USING ERRCODE = '22023';
  END IF;

  IF _media_type = 'text' THEN
    IF COALESCE(btrim(_caption), '') = '' THEN
      RAISE EXCEPTION 'meta_schedule_text_empty' USING ERRCODE = '22023';
    END IF;
  ELSIF _media_type = 'image' THEN
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
    organization_id, client_id, connection_id, post_id, target,
    media_type, image_url, video_url, cover_url, children_urls, caption, scheduled_for, created_by
  ) VALUES (
    v_org, _client_id, _connection_id, _post_id, v_target,
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

REVOKE ALL ON FUNCTION public.create_scheduled_post(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT[], TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_scheduled_post(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT[], TEXT
) TO authenticated;

COMMIT;
