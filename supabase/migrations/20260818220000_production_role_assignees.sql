-- ============================================================================
-- RESPONSÁVEIS DE PRODUÇÃO (por organização)
--
-- Define QUEM faz cada papel na produção, sem depender de casar por nome de
-- função. O Quadro de Produção usa isso para atribuir/reassignar as etapas.
--   design  -> copy + design (ex.: Giu)
--   writing -> roteiro + texto (ex.: Nanda)
--   editing -> edição de vídeo (ex.: Edu)
--   review  -> revisão (opcional)
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.production_role_assignees (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  design_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  writing_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  editing_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  review_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE public.production_role_assignees IS
  'Quem faz cada papel de produção na organização (usado pelo Quadro de Produção).';

DROP TRIGGER IF EXISTS update_production_role_assignees_updated_at ON public.production_role_assignees;
CREATE TRIGGER update_production_role_assignees_updated_at
BEFORE UPDATE ON public.production_role_assignees
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.production_role_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_role_assignees_select ON public.production_role_assignees;
CREATE POLICY production_role_assignees_select
  ON public.production_role_assignees FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS production_role_assignees_write ON public.production_role_assignees;
CREATE POLICY production_role_assignees_write
  ON public.production_role_assignees FOR ALL TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_role_assignees TO authenticated;

COMMIT;
