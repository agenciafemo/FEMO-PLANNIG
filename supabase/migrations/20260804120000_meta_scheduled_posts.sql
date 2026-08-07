-- ============================================================================
-- META SCHEDULED POSTS — fila de publicação/agendamento no Instagram
--
-- Serve tanto para "publicar agora" (scheduled_for = now) quanto para agendar
-- (scheduled_for no futuro). O worker (Edge Function via cron/invoke) reivindica
-- os itens vencidos, publica pela API e grava o resultado. Nenhum token vive
-- aqui — a publicação usa meta_server_get_connection_token da conexão. Só
-- metadados sanitizados (imagem pública, legenda, ids) são guardados.
-- ============================================================================

BEGIN;

-- Aborta limpo se as fundações (multi-tenant + Meta) não existirem.
DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.clients') IS NULL
     OR to_regclass('public.meta_connections') IS NULL
     OR to_regclass('public.meta_connection_channels') IS NULL
     OR to_regprocedure('public.meta_can_manage_connection(uuid,uuid)') IS NULL
     OR to_regprocedure('public.is_org_member(uuid,uuid)') IS NULL
     OR to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'meta_scheduled_posts dependencies are missing';
  END IF;
END;
$$;

CREATE TABLE public.meta_scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  connection_id UUID NOT NULL REFERENCES public.meta_connections(id) ON DELETE RESTRICT,
  post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  media_type TEXT NOT NULL DEFAULT 'image',
  image_url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'queued',
  instagram_media_id TEXT,
  permalink TEXT,
  error_code TEXT,
  attempts INT NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meta_scheduled_posts_status_valid CHECK (
    status IN ('queued', 'processing', 'published', 'failed', 'canceled')
  ),
  CONSTRAINT meta_scheduled_posts_media_type_valid CHECK (media_type IN ('image')),
  CONSTRAINT meta_scheduled_posts_image_url_https CHECK (image_url ~ '^https://'),
  CONSTRAINT meta_scheduled_posts_error_code_sanitized CHECK (
    error_code IS NULL OR error_code ~ '^[A-Za-z0-9_.:-]{1,100}$'
  )
);

COMMENT ON TABLE public.meta_scheduled_posts IS
  'Fila de publicacao/agendamento no Instagram. Metadados sanitizados; nenhum token e guardado aqui.';

CREATE INDEX meta_scheduled_posts_org_idx ON public.meta_scheduled_posts (organization_id, scheduled_for DESC);
CREATE INDEX meta_scheduled_posts_client_idx ON public.meta_scheduled_posts (client_id, scheduled_for);
CREATE INDEX meta_scheduled_posts_due_idx ON public.meta_scheduled_posts (scheduled_for)
  WHERE status = 'queued';

ALTER TABLE public.meta_scheduled_posts ENABLE ROW LEVEL SECURITY;

-- Deriva/garante o escopo (org do cliente) e valida que a conexão é do cliente.
CREATE OR REPLACE FUNCTION public.enforce_meta_scheduled_post_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'meta_scheduled_post_client_scope_mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.meta_connections mc
    WHERE mc.id = NEW.connection_id AND mc.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'meta_scheduled_post_connection_mismatch' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_meta_scheduled_post_scope
BEFORE INSERT OR UPDATE OF organization_id, client_id, connection_id
ON public.meta_scheduled_posts
FOR EACH ROW EXECUTE FUNCTION public.enforce_meta_scheduled_post_scope();

CREATE TRIGGER update_meta_scheduled_posts_updated_at
BEFORE UPDATE ON public.meta_scheduled_posts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Leitura: membros da organizacao veem os agendamentos da sua org (defense-in-depth).
CREATE POLICY meta_scheduled_posts_member_select
ON public.meta_scheduled_posts
FOR SELECT TO authenticated
USING (public.is_org_member(organization_id, auth.uid()));

REVOKE ALL ON TABLE public.meta_scheduled_posts FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs do USUARIO (SECURITY DEFINER; so quem gerencia a conexao pode agendar).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_scheduled_post(
  _client_id UUID,
  _connection_id UUID,
  _image_url TEXT,
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
  IF _image_url !~ '^https://' THEN
    RAISE EXCEPTION 'meta_schedule_image_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.meta_scheduled_posts (
    organization_id, client_id, connection_id, post_id,
    image_url, caption, scheduled_for, created_by
  ) VALUES (
    v_org, _client_id, _connection_id, _post_id,
    _image_url, COALESCE(_caption, ''), COALESCE(_scheduled_for, now()), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_scheduled_post(_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM public.meta_scheduled_posts WHERE id = _id;
  IF v_org IS NULL OR NOT public.meta_can_manage_connection(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'meta_schedule_forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.meta_scheduled_posts
  SET status = 'canceled'
  WHERE id = _id AND status IN ('queued', 'failed');
END;
$$;

-- Leitura para o calendario (janela por data). RETURNS TABLE sanitizada.
CREATE OR REPLACE FUNCTION public.get_scheduled_posts(
  _from TIMESTAMPTZ,
  _to TIMESTAMPTZ,
  _client_id UUID DEFAULT NULL
)
RETURNS SETOF public.meta_scheduled_posts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sp.*
  FROM public.meta_scheduled_posts sp
  WHERE public.is_org_member(sp.organization_id, auth.uid())
    AND sp.scheduled_for >= _from
    AND sp.scheduled_for < _to
    AND (_client_id IS NULL OR sp.client_id = _client_id)
    AND sp.status <> 'canceled'
  ORDER BY sp.scheduled_for;
$$;

-- ---------------------------------------------------------------------------
-- RPCs do SERVIDOR (worker). GRANT so a service_role.
-- ---------------------------------------------------------------------------

-- Reivindica ate _limit itens vencidos, marca 'processing' e devolve o que o
-- worker precisa para publicar (incl. o id do Instagram do canal ativo).
CREATE OR REPLACE FUNCTION public.meta_server_claim_due_scheduled_posts(_limit INT DEFAULT 5)
RETURNS TABLE (
  id UUID,
  connection_id UUID,
  instagram_account_id TEXT,
  image_url TEXT,
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
    sp.image_url,
    sp.caption;
END;
$$;

CREATE OR REPLACE FUNCTION public.meta_server_mark_scheduled_published(
  _id UUID, _media_id TEXT, _permalink TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.meta_scheduled_posts
  SET status = 'published', instagram_media_id = _media_id,
      permalink = _permalink, error_code = NULL
  WHERE id = _id;
$$;

CREATE OR REPLACE FUNCTION public.meta_server_mark_scheduled_failed(
  _id UUID, _error_code TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.meta_scheduled_posts
  SET status = 'failed',
      error_code = left(regexp_replace(COALESCE(_error_code, 'unknown'), '[^A-Za-z0-9_.:-]', '_', 'g'), 100)
  WHERE id = _id;
$$;

-- ---------------------------------------------------------------------------
-- GRANTS / REVOKES explicitos.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.enforce_meta_scheduled_post_scope() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_scheduled_post(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_scheduled_post(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_scheduled_post(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_post(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_scheduled_posts(TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scheduled_posts(TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.meta_server_claim_due_scheduled_posts(INT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_claim_due_scheduled_posts(INT) TO service_role;
REVOKE ALL ON FUNCTION public.meta_server_mark_scheduled_published(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_mark_scheduled_published(UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.meta_server_mark_scheduled_failed(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_server_mark_scheduled_failed(UUID, TEXT) TO service_role;

COMMIT;
