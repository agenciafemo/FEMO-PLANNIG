-- ============================================================================
-- Modelos de etapas por tipo de peça, editáveis pela organização.
--
-- Antes: as etapas de cada tipo (reels, carrossel, story, blog...) eram fixas
-- no código (PIPELINES em src/lib/productionPipeline.ts). Só dava para
-- customizar peça por peça, depois de criada.
--
-- Agora: cada organização pode editar o MODELO de um tipo. Toda peça nova
-- daquele tipo nasce com as etapas do modelo.
--
-- Tabela vazia = usa o modelo padrão do código (fallback). A organização só
-- passa a ter linhas aqui quando salva o modelo pela primeira vez, então nada
-- muda para quem nunca abriu a tela.
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.production_step_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL
    CHECK (content_type IN ('static', 'reels', 'carousel', 'story', 'blog', 'extra')),
  step_key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'check' CHECK (kind IN ('check', 'data', 'gate', 'acao')),
  position INTEGER NOT NULL DEFAULT 0,
  -- responsável natural da etapa; NULL = ninguém automático
  role TEXT CHECK (role IN ('design', 'writing', 'editing', 'review')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT production_step_templates_unique UNIQUE (organization_id, content_type, step_key)
);

CREATE INDEX IF NOT EXISTS production_step_templates_org_type_idx
  ON public.production_step_templates (organization_id, content_type, position);

ALTER TABLE public.production_step_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_step_templates_select ON public.production_step_templates;
CREATE POLICY production_step_templates_select
  ON public.production_step_templates FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS production_step_templates_write ON public.production_step_templates;
CREATE POLICY production_step_templates_write
  ON public.production_step_templates FOR ALL TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_step_templates TO authenticated;

DROP TRIGGER IF EXISTS update_production_step_templates_updated_at
  ON public.production_step_templates;
CREATE TRIGGER update_production_step_templates_updated_at
  BEFORE UPDATE ON public.production_step_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
