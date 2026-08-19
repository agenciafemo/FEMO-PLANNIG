-- ============================================================================
-- CONTRATO DE CONTEÚDO POR CLIENTE
--
-- Quantidade padrão de cada tipo de peça que o cliente tem no contrato. O
-- planejamento passa a nascer com essas quantidades (sem escolher toda vez);
-- extras continuam podendo ser adicionados no planejamento.
--
-- Aditivo/isolado: tabela nova (1 linha por cliente). Não altera clients, posts
-- nem planejamentos.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_content_contract (
  client_id UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  qty_static   INTEGER NOT NULL DEFAULT 0 CHECK (qty_static   >= 0 AND qty_static   <= 200),
  qty_reels    INTEGER NOT NULL DEFAULT 0 CHECK (qty_reels    >= 0 AND qty_reels    <= 200),
  qty_carousel INTEGER NOT NULL DEFAULT 0 CHECK (qty_carousel >= 0 AND qty_carousel <= 200),
  qty_story    INTEGER NOT NULL DEFAULT 0 CHECK (qty_story    >= 0 AND qty_story    <= 200),
  qty_blog     INTEGER NOT NULL DEFAULT 0 CHECK (qty_blog     >= 0 AND qty_blog     <= 200),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE public.client_content_contract IS
  'Quantidade padrão de peças por cliente (contrato); o planejamento nasce com elas.';

CREATE INDEX IF NOT EXISTS client_content_contract_org_idx
  ON public.client_content_contract (organization_id);

-- Garante que o cliente pertence à organização informada (cross-tenant).
CREATE OR REPLACE FUNCTION public.validate_client_contract_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'O cliente deve pertencer à mesma organização do contrato';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_client_contract_tenant ON public.client_content_contract;
CREATE TRIGGER validate_client_contract_tenant
BEFORE INSERT OR UPDATE ON public.client_content_contract
FOR EACH ROW EXECUTE FUNCTION public.validate_client_contract_tenant();

DROP TRIGGER IF EXISTS update_client_content_contract_updated_at ON public.client_content_contract;
CREATE TRIGGER update_client_content_contract_updated_at
BEFORE UPDATE ON public.client_content_contract
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.client_content_contract ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_content_contract_select ON public.client_content_contract;
CREATE POLICY client_content_contract_select
  ON public.client_content_contract FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS client_content_contract_write ON public.client_content_contract;
CREATE POLICY client_content_contract_write
  ON public.client_content_contract FOR ALL TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_content_contract TO authenticated;

COMMIT;
