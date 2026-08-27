-- ============================================================================
-- FRAME.IO V4 VIA ZAPIER — vínculos de peças, comentários e idempotência
--
-- Esta migration cria somente a persistência. Ela NÃO configura o Zapier,
-- NÃO cria segredo e NÃO publica Edge Function.
--
-- Os comentários são guardados por file_id mesmo antes de o arquivo ser
-- vinculado a uma peça. Assim um evento recebido cedo não é perdido: quando
-- a equipe vincular o arquivo, o histórico já estará disponível.
-- ============================================================================

BEGIN;

CREATE TABLE public.frameio_asset_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  production_item_id UUID NOT NULL
    REFERENCES public.production_items(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL CHECK (char_length(btrim(file_id)) BETWEEN 1 AND 200),
  file_name TEXT CHECK (file_name IS NULL OR char_length(file_name) <= 500),
  file_url TEXT CHECK (
    file_url IS NULL
    OR (char_length(file_url) <= 2048 AND file_url ~* '^https://')
  ),
  account_id TEXT CHECK (account_id IS NULL OR char_length(account_id) <= 200),
  workspace_id TEXT CHECK (workspace_id IS NULL OR char_length(workspace_id) <= 200),
  project_id TEXT CHECK (project_id IS NULL OR char_length(project_id) <= 200),
  frameio_status TEXT CHECK (
    frameio_status IS NULL OR char_length(frameio_status) <= 120
  ),
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, file_id)
);

COMMENT ON TABLE public.frameio_asset_links IS
  'Relaciona um arquivo do Frame.io V4 a uma peça do quadro de produção.';
COMMENT ON COLUMN public.frameio_asset_links.file_id IS
  'Identificador do arquivo entregue pelo Frame.io V4/Zapier; não é token.';

CREATE INDEX frameio_asset_links_org_item_idx
  ON public.frameio_asset_links (organization_id, production_item_id);

CREATE TABLE public.frameio_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL CHECK (char_length(btrim(file_id)) BETWEEN 1 AND 200),
  external_comment_id TEXT NOT NULL
    CHECK (char_length(btrim(external_comment_id)) BETWEEN 1 AND 200),
  comment_text TEXT NOT NULL CHECK (char_length(comment_text) <= 20000),
  frame_timestamp_seconds NUMERIC(12, 3)
    CHECK (frame_timestamp_seconds IS NULL OR frame_timestamp_seconds >= 0),
  author_external_id TEXT
    CHECK (author_external_id IS NULL OR char_length(author_external_id) <= 200),
  author_name TEXT CHECK (author_name IS NULL OR char_length(author_name) <= 500),
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  external_created_at TIMESTAMPTZ,
  external_updated_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_comment_id)
);

COMMENT ON TABLE public.frameio_comments IS
  'Comentários normalizados do Frame.io; nunca armazena credenciais ou payload bruto.';

CREATE INDEX frameio_comments_org_file_created_idx
  ON public.frameio_comments (
    organization_id,
    file_id,
    external_created_at DESC NULLS LAST,
    received_at DESC
  );

CREATE TABLE public.frameio_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL CHECK (char_length(event_key) BETWEEN 1 AND 500),
  event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 120),
  file_id TEXT CHECK (file_id IS NULL OR char_length(file_id) <= 200),
  external_comment_id TEXT
    CHECK (external_comment_id IS NULL OR char_length(external_comment_id) <= 200),
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'rejected', 'failed')),
  reason_code TEXT CHECK (reason_code IS NULL OR char_length(reason_code) <= 160),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (organization_id, event_key)
);

COMMENT ON TABLE public.frameio_webhook_events IS
  'Log mínimo e idempotente do receptor Zapier; não guarda o payload bruto.';

CREATE INDEX frameio_webhook_events_org_received_idx
  ON public.frameio_webhook_events (organization_id, received_at DESC);

CREATE OR REPLACE FUNCTION public.validate_frameio_asset_link_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.production_items item
    WHERE item.id = NEW.production_item_id
      AND item.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'A peça deve pertencer à mesma organização do vínculo Frame.io';
  END IF;

  -- A autoria é imutável; gestores podem corrigir o vínculo sem assumir a
  -- identidade de quem o criou.
  IF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
  END IF;

  NEW.file_id := btrim(NEW.file_id);
  NEW.file_name := NULLIF(btrim(NEW.file_name), '');
  NEW.file_url := NULLIF(btrim(NEW.file_url), '');
  NEW.account_id := NULLIF(btrim(NEW.account_id), '');
  NEW.workspace_id := NULLIF(btrim(NEW.workspace_id), '');
  NEW.project_id := NULLIF(btrim(NEW.project_id), '');
  NEW.frameio_status := NULLIF(btrim(NEW.frameio_status), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_frameio_asset_link_tenant
  ON public.frameio_asset_links;
CREATE TRIGGER validate_frameio_asset_link_tenant
BEFORE INSERT OR UPDATE ON public.frameio_asset_links
FOR EACH ROW EXECUTE FUNCTION public.validate_frameio_asset_link_tenant();

DROP TRIGGER IF EXISTS update_frameio_asset_links_updated_at
  ON public.frameio_asset_links;
CREATE TRIGGER update_frameio_asset_links_updated_at
BEFORE UPDATE ON public.frameio_asset_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.frameio_asset_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frameio_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frameio_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY frameio_asset_links_select
  ON public.frameio_asset_links
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY frameio_asset_links_insert
  ON public.frameio_asset_links
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_edit_org_content(organization_id, auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY frameio_asset_links_update
  ON public.frameio_asset_links
  FOR UPDATE TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

CREATE POLICY frameio_asset_links_delete
  ON public.frameio_asset_links
  FOR DELETE TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()));

CREATE POLICY frameio_comments_select
  ON public.frameio_comments
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

REVOKE ALL ON TABLE public.frameio_asset_links FROM anon;
REVOKE ALL ON TABLE public.frameio_comments FROM anon;
REVOKE ALL ON TABLE public.frameio_webhook_events FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.frameio_asset_links TO authenticated;
GRANT SELECT ON TABLE public.frameio_comments TO authenticated;
GRANT ALL ON TABLE public.frameio_asset_links TO service_role;
GRANT ALL ON TABLE public.frameio_comments TO service_role;
GRANT ALL ON TABLE public.frameio_webhook_events TO service_role;

REVOKE ALL ON FUNCTION public.validate_frameio_asset_link_tenant()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_frameio_asset_link_tenant()
  TO service_role;

COMMIT;
