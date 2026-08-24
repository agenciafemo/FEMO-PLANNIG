-- ============================================================================
-- Publicar tambem na Pagina do Facebook, nao so no Instagram.
--
-- A conexao ja e com a PAGINA (o token permanente vem dela) e o id da Pagina ja
-- esta em meta_connection_channels. O que faltava era a fila saber que existe
-- outro destino: tudo publicava em /{ig}/media.
--
-- MODELO: UMA LINHA POR DESTINO. Publicar "nos dois" cria duas linhas, uma por
-- plataforma. E o desenho mais robusto — status, erro, retentativa e o aviso de
-- reconexao continuam valendo por linha, sem inventar estado "parcial" nem
-- duplicar colunas de resultado por plataforma.
--
-- Aditiva: `target` nasce com 'instagram', entao toda linha existente e todo
-- agendamento antigo seguem se comportando exatamente como antes.
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.meta_scheduled_posts
  ADD COLUMN IF NOT EXISTS target TEXT NOT NULL DEFAULT 'instagram';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_scheduled_posts_target_valid'
  ) THEN
    ALTER TABLE public.meta_scheduled_posts
      ADD CONSTRAINT meta_scheduled_posts_target_valid
      CHECK (target IN ('instagram', 'facebook'));
  END IF;
END $$;

COMMENT ON COLUMN public.meta_scheduled_posts.target IS
  'Onde publicar: instagram | facebook. Uma linha por destino.';

-- Post so de texto: a Pagina aceita, o Instagram nao. Por isso o formato novo
-- so faz sentido junto do destino facebook (validado na RPC de criacao).
ALTER TABLE public.meta_scheduled_posts
  DROP CONSTRAINT IF EXISTS meta_scheduled_posts_media_type_valid;
ALTER TABLE public.meta_scheduled_posts
  ADD CONSTRAINT meta_scheduled_posts_media_type_valid
  CHECK (media_type IN ('image', 'reels', 'story', 'carousel', 'text'));

-- Resultado da publicacao na Pagina. instagram_media_id continua sendo o do
-- Instagram; nao se misturam.
ALTER TABLE public.meta_scheduled_posts
  ADD COLUMN IF NOT EXISTS facebook_post_id TEXT;

COMMENT ON COLUMN public.meta_scheduled_posts.facebook_post_id IS
  'Id do post na Pagina do Facebook. NULL quando target = instagram.';

-- O worker precisa saber o destino e o id da Pagina para publicar.
--
-- DROP antes do CREATE: a funcao ganha duas colunas no RETURNS TABLE, e o
-- Postgres nao deixa CREATE OR REPLACE mudar o tipo de retorno (42P13). Como
-- tudo roda dentro da transacao acima, nao existe instante com a funcao
-- ausente para o worker.
DROP FUNCTION IF EXISTS public.meta_server_claim_due_scheduled_posts(INT);

CREATE OR REPLACE FUNCTION public.meta_server_claim_due_scheduled_posts(_limit INT DEFAULT 5)
RETURNS TABLE (
  id UUID,
  connection_id UUID,
  instagram_account_id TEXT,
  facebook_page_id TEXT,
  target TEXT,
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
    (SELECT ch.external_account_id
       FROM public.meta_connection_channels ch
      WHERE ch.connection_id = sp.connection_id
        AND ch.channel_type = 'facebook_page'
        AND ch.status = 'active'
      LIMIT 1),
    sp.target,
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
