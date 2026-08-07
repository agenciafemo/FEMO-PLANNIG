-- ============================================================================
-- META REELS SUPPORT — permite agendar/publicar Reels (vídeo) além de imagem.
--
-- Antes: a fila só aceitava media_type='image' e um image_url. Reels caía como
-- foto (só a capa era publicada). Agora a fila guarda o vídeo (video_url, um
-- arquivo público servido pelo bucket post-media) e a capa opcional (cover_url).
-- Nenhum token vive aqui; segue o mesmo padrão sanitizado da fila original.
--
-- Idempotente/seguro: aborta limpo se a fila não existir; só relaxa constraints
-- e amplia as RPCs. Linhas de imagem existentes continuam válidas.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.meta_scheduled_posts') IS NULL
     OR to_regprocedure('public.meta_can_manage_connection(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'meta_reels_support: meta_scheduled_posts/foundations ausentes';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1) Tabela: novas colunas + constraints por tipo de mídia.
-- ---------------------------------------------------------------------------
ALTER TABLE public.meta_scheduled_posts
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- image_url deixa de ser obrigatório (reels não tem imagem principal).
ALTER TABLE public.meta_scheduled_posts ALTER COLUMN image_url DROP NOT NULL;

-- media_type passa a aceitar 'reels'.
ALTER TABLE public.meta_scheduled_posts
  DROP CONSTRAINT IF EXISTS meta_scheduled_posts_media_type_valid;
ALTER TABLE public.meta_scheduled_posts
  ADD CONSTRAINT meta_scheduled_posts_media_type_valid
  CHECK (media_type IN ('image', 'reels'));

-- Coerência por tipo: imagem exige image_url; reels exige video_url.
ALTER TABLE public.meta_scheduled_posts
  DROP CONSTRAINT IF EXISTS meta_scheduled_posts_media_consistent;
ALTER TABLE public.meta_scheduled_posts
  ADD CONSTRAINT meta_scheduled_posts_media_consistent
  CHECK (
    (media_type = 'image' AND image_url IS NOT NULL AND video_url IS NULL)
    OR (media_type = 'reels' AND video_url IS NOT NULL)
  );

-- URLs continuam obrigatoriamente https (nulo é permitido pela coerência acima).
ALTER TABLE public.meta_scheduled_posts
  DROP CONSTRAINT IF EXISTS meta_scheduled_posts_video_url_https;
ALTER TABLE public.meta_scheduled_posts
  ADD CONSTRAINT meta_scheduled_posts_video_url_https
  CHECK (video_url IS NULL OR video_url ~ '^https://');
ALTER TABLE public.meta_scheduled_posts
  DROP CONSTRAINT IF EXISTS meta_scheduled_posts_cover_url_https;
ALTER TABLE public.meta_scheduled_posts
  ADD CONSTRAINT meta_scheduled_posts_cover_url_https
  CHECK (cover_url IS NULL OR cover_url ~ '^https://');

-- ---------------------------------------------------------------------------
-- 2) create_scheduled_post: nova assinatura com media_type/video/cover.
--    (a assinatura muda -> derruba a antiga e recria; re-GRANT no fim.)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_scheduled_post(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, UUID);

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

  IF _media_type NOT IN ('image', 'reels') THEN
    RAISE EXCEPTION 'meta_schedule_media_type_invalid' USING ERRCODE = '22023';
  END IF;

  IF _media_type = 'image' THEN
    IF _image_url IS NULL OR _image_url !~ '^https://' THEN
      RAISE EXCEPTION 'meta_schedule_image_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE -- reels
    -- A Meta baixa o arquivo: precisa ser https direto. Link do Drive não serve.
    IF _video_url IS NULL OR _video_url !~ '^https://' OR _video_url ~* 'drive\.google\.com' THEN
      RAISE EXCEPTION 'meta_schedule_video_invalid' USING ERRCODE = '22023';
    END IF;
    IF _cover_url IS NOT NULL AND _cover_url !~ '^https://' THEN
      RAISE EXCEPTION 'meta_schedule_cover_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.meta_scheduled_posts (
    organization_id, client_id, connection_id, post_id,
    media_type, image_url, video_url, cover_url, caption, scheduled_for, created_by
  ) VALUES (
    v_org, _client_id, _connection_id, _post_id,
    _media_type,
    CASE WHEN _media_type = 'image' THEN _image_url ELSE NULL END,
    CASE WHEN _media_type = 'reels' THEN _video_url ELSE NULL END,
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

-- ---------------------------------------------------------------------------
-- 3) claim do worker: devolve também media_type / video_url / cover_url.
--    (o RETURNS TABLE muda -> derruba e recria; re-GRANT no fim.)
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
    sp.caption;
END;
$$;

REVOKE ALL ON FUNCTION public.meta_server_claim_due_scheduled_posts(INT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_claim_due_scheduled_posts(INT) TO service_role;

COMMIT;
