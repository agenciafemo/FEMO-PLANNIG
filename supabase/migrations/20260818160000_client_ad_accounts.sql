-- ============================================================================
-- RELATÓRIO DE TRÁFEGO PAGO (META ADS) — MAPA CLIENTE -> CONTA DE ANÚNCIOS
--
-- Guarda qual conta de anúncios da Business Manager da Femo pertence a cada
-- cliente. A função meta-ads-insights usa esse mapa (+ um System User token
-- guardado em secret) para puxar as métricas de Ads do cliente no mês.
--
-- ADITIVA e ISOLADA: tabela nova. NÃO altera clients, posts, conexões Meta,
-- tokens de publicação nem nada relacionado aos posts programados.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- ID numérico da conta de anúncios (sem o prefixo "act_"). Ex.: 1234567890.
  ad_account_id TEXT NOT NULL
    CHECK (btrim(ad_account_id) <> '' AND ad_account_id ~ '^[0-9]+$'),
  -- Nome da conta (cache do que a Marketing API devolve) — só para exibir.
  ad_account_name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  -- Um cliente = uma conta de anúncios (o caso comum da agência).
  CONSTRAINT client_ad_accounts_org_client_key UNIQUE (organization_id, client_id)
);

COMMENT ON TABLE public.client_ad_accounts IS
  'Mapa cliente -> conta de anúncios (act_) da BM da Femo, usado pelo relatório de tráfego pago.';

CREATE INDEX IF NOT EXISTS client_ad_accounts_org_client_idx
  ON public.client_ad_accounts (organization_id, client_id);

-- updated_at automático (mesma função usada pelas demais tabelas do app).
DROP TRIGGER IF EXISTS update_client_ad_accounts_updated_at ON public.client_ad_accounts;
CREATE TRIGGER update_client_ad_accounts_updated_at
BEFORE UPDATE ON public.client_ad_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Garante que o cliente pertence à mesma organização do registro (cross-tenant).
CREATE OR REPLACE FUNCTION public.validate_client_ad_account_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = NEW.client_id
      AND c.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'O cliente deve pertencer à mesma organização do registro';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_client_ad_account_tenant ON public.client_ad_accounts;
CREATE TRIGGER validate_client_ad_account_tenant
BEFORE INSERT OR UPDATE ON public.client_ad_accounts
FOR EACH ROW EXECUTE FUNCTION public.validate_client_ad_account_tenant();

-- ---------------------------------------------------------------------------
-- RLS: leitura para membro da org; escrita para editor (padrão do app).
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_ad_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_ad_accounts_select ON public.client_ad_accounts;
CREATE POLICY client_ad_accounts_select
  ON public.client_ad_accounts
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS client_ad_accounts_write ON public.client_ad_accounts;
CREATE POLICY client_ad_accounts_write
  ON public.client_ad_accounts
  FOR ALL TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_ad_accounts TO authenticated;

COMMIT;
