-- ============================================================================
-- ESTÚDIO DE CONTEÚDO — REFERÊNCIAS DE DESIGN POR CLIENTE (Fase 3a)
--
-- Imagens de referência de design (upload) + descrição do estilo, que servirão
-- de base para a geração de artes com IA (Fase 3b). Arquivos ficam no bucket
-- `content-design-refs` com caminho org_id/client_id/arquivo.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_design_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,           -- URL pública da imagem (para exibir/enviar à IA)
  storage_path TEXT,                 -- caminho no bucket (para apagar o arquivo)
  title TEXT,
  description TEXT,                  -- notas de estilo (paleta, tipografia, mood…)
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS client_design_references_client_idx
  ON public.client_design_references (organization_id, client_id);

ALTER TABLE public.client_design_references ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_design_references_select ON public.client_design_references;
CREATE POLICY client_design_references_select
  ON public.client_design_references
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS client_design_references_write ON public.client_design_references;
CREATE POLICY client_design_references_write
  ON public.client_design_references
  FOR ALL TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_design_references TO authenticated;

-- ---------------------------------------------------------------------------
-- STORAGE: bucket público de referências de design.
-- Caminho esperado: {organization_id}/{client_id}/{arquivo}. As políticas
-- restringem escrita/leitura pela org do primeiro segmento do caminho.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('content-design-refs', 'content-design-refs', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS content_design_refs_insert ON storage.objects;
CREATE POLICY content_design_refs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'content-design-refs'
    AND public.is_org_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

DROP POLICY IF EXISTS content_design_refs_select ON storage.objects;
CREATE POLICY content_design_refs_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'content-design-refs'
    AND public.is_org_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

DROP POLICY IF EXISTS content_design_refs_delete ON storage.objects;
CREATE POLICY content_design_refs_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'content-design-refs'
    AND public.is_org_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

COMMIT;
