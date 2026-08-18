-- ============================================================================
-- RELATÓRIOS — HISTÓRICO POR CLIENTE
--
-- Persiste cada relatório gerado (metricas + analise da IA + periodo) para
-- montar o historico dos ultimos relatorios de cada cliente. A funcao
-- generate-report grava aqui (server-side) a cada geracao.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_report_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_from DATE,
  period_to DATE,
  analysis TEXT,            -- texto da analise da IA
  dados JSONB,              -- numeros do periodo (posts, status, formato...)
  metricas JSONB,           -- metricas reais do Instagram (pode ser null)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS client_report_history_client_idx
  ON public.client_report_history (organization_id, client_id, created_at DESC);

ALTER TABLE public.client_report_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_report_history_select ON public.client_report_history;
CREATE POLICY client_report_history_select
  ON public.client_report_history
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS client_report_history_write ON public.client_report_history;
CREATE POLICY client_report_history_write
  ON public.client_report_history
  FOR ALL TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_report_history TO authenticated;

COMMIT;
