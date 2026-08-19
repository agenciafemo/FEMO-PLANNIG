-- ============================================================================
-- QUADRO DE PRODUÇÃO — PEÇAS QUE FLUEM POR ETAPAS
--
-- Cada peça de um planejamento (carrossel, post, reel, story, blog) vira um
-- item que anda por etapas (copy -> design -> revisão -> pronto; reel: roteiro
-- -> edição -> ...). O item guarda a ETAPA atual e o RESPONSÁVEL atual. Ao
-- concluir a etapa, avança para a próxima e reassigna (feito no app).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.production_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  planning_id UUID REFERENCES public.plannings(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  content_type TEXT NOT NULL
    CHECK (content_type IN ('static', 'reels', 'carousel', 'story', 'blog')),
  piece_number INTEGER NOT NULL DEFAULT 1 CHECK (piece_number >= 1),
  -- etapa atual: copy | design | roteiro | edicao | texto | revisao | pronto
  stage TEXT NOT NULL DEFAULT 'copy',
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,                    -- direcionamentos/sugestões (ex.: datas do mês)
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE public.production_items IS
  'Peças de produção que fluem por etapas (Quadro de Produção).';

CREATE INDEX IF NOT EXISTS production_items_org_stage_idx
  ON public.production_items (organization_id, stage, position);
CREATE INDEX IF NOT EXISTS production_items_planning_idx
  ON public.production_items (planning_id);
CREATE INDEX IF NOT EXISTS production_items_assignee_idx
  ON public.production_items (assignee_id) WHERE assignee_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_production_item_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'O cliente deve pertencer à mesma organização do item';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_production_item_tenant ON public.production_items;
CREATE TRIGGER validate_production_item_tenant
BEFORE INSERT OR UPDATE ON public.production_items
FOR EACH ROW EXECUTE FUNCTION public.validate_production_item_tenant();

DROP TRIGGER IF EXISTS update_production_items_updated_at ON public.production_items;
CREATE TRIGGER update_production_items_updated_at
BEFORE UPDATE ON public.production_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.production_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_items_select ON public.production_items;
CREATE POLICY production_items_select
  ON public.production_items FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS production_items_write ON public.production_items;
CREATE POLICY production_items_write
  ON public.production_items FOR ALL TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_items TO authenticated;

COMMIT;
