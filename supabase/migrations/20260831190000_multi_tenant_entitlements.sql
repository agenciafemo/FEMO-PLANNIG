-- Multi-tenant entitlements: planos, assinatura e limites aplicados no banco.
-- A cobrança permanece desacoplada do provedor; um webhook/service-role pode
-- atualizar plan_code e subscription_status depois.

BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_members INTEGER NOT NULL CHECK (max_members >= 0),
  max_clients INTEGER NOT NULL CHECK (max_clients >= 0),
  max_monthly_ai_runs INTEGER NOT NULL CHECK (max_monthly_ai_runs >= 0),
  max_storage_bytes BIGINT NOT NULL CHECK (max_storage_bytes >= 0),
  features JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.organization_plans (code, name, max_members, max_clients, max_monthly_ai_runs, max_storage_bytes, features)
VALUES
  ('free', 'Free', 3, 5, 20, 1073741824, '{"instagram": false, "advanced_reports": false}'::jsonb),
  ('starter', 'Starter', 10, 25, 200, 10737418240, '{"instagram": true, "advanced_reports": false}'::jsonb),
  ('pro', 'Pro', 30, 100, 1000, 107374182400, '{"instagram": true, "advanced_reports": true}'::jsonb),
  ('enterprise', 'Enterprise', 1000, 10000, 100000, 1099511627776, '{"instagram": true, "advanced_reports": true}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  max_members = EXCLUDED.max_members,
  max_clients = EXCLUDED.max_clients,
  max_monthly_ai_runs = EXCLUDED.max_monthly_ai_runs,
  max_storage_bytes = EXCLUDED.max_storage_bytes,
  features = EXCLUDED.features,
  updated_at = now();

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan_code TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_customer_id TEXT;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_plan_code_fkey,
  ADD CONSTRAINT organizations_plan_code_fkey FOREIGN KEY (plan_code) REFERENCES public.organization_plans(code),
  DROP CONSTRAINT IF EXISTS organizations_subscription_status_check,
  ADD CONSTRAINT organizations_subscription_status_check CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled', 'paused'));

CREATE INDEX IF NOT EXISTS organizations_plan_code_idx ON public.organizations(plan_code);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_billing_customer_id_unique
  ON public.organizations(billing_customer_id) WHERE billing_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.organization_usage_monthly (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  ai_runs INTEGER NOT NULL DEFAULT 0 CHECK (ai_runs >= 0),
  storage_bytes BIGINT NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, period_start)
);

ALTER TABLE public.organization_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_usage_monthly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_plans_select_authenticated ON public.organization_plans;
CREATE POLICY organization_plans_select_authenticated ON public.organization_plans
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS organization_usage_select_members ON public.organization_usage_monthly;
CREATE POLICY organization_usage_select_members ON public.organization_usage_monthly
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));

CREATE OR REPLACE FUNCTION public.get_organization_entitlements(_organization_id UUID)
RETURNS TABLE (
  organization_id UUID, plan_code TEXT, plan_name TEXT, subscription_status TEXT,
  max_members INTEGER, max_clients INTEGER, max_monthly_ai_runs INTEGER,
  max_storage_bytes BIGINT, ai_runs_used INTEGER, storage_bytes_used BIGINT,
  period_start DATE, features JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, p.code, p.name, o.subscription_status, p.max_members, p.max_clients,
         p.max_monthly_ai_runs, p.max_storage_bytes,
         COALESCE(u.ai_runs, 0), COALESCE(u.storage_bytes, 0),
         date_trunc('month', now())::date, p.features
  FROM public.organizations o
  JOIN public.organization_plans p ON p.code = o.plan_code
  LEFT JOIN public.organization_usage_monthly u
    ON u.organization_id = o.id AND u.period_start = date_trunc('month', now())::date
  WHERE o.id = _organization_id AND public.is_org_member(_organization_id);
$$;

REVOKE ALL ON FUNCTION public.get_organization_entitlements(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_organization_entitlements(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_customer_managed_organization_fields()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') AND (
    NEW.plan_code IS DISTINCT FROM OLD.plan_code OR
    NEW.subscription_status IS DISTINCT FROM OLD.subscription_status OR
    NEW.subscription_started_at IS DISTINCT FROM OLD.subscription_started_at OR
    NEW.current_period_start IS DISTINCT FROM OLD.current_period_start OR
    NEW.current_period_end IS DISTINCT FROM OLD.current_period_end OR
    NEW.billing_customer_id IS DISTINCT FROM OLD.billing_customer_id
  ) THEN
    RAISE EXCEPTION 'Campos de assinatura só podem ser alterados pelo serviço de cobrança'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_customer_managed_organization_fields ON public.organizations;
CREATE TRIGGER prevent_customer_managed_organization_fields
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_customer_managed_organization_fields();

CREATE OR REPLACE FUNCTION public.enforce_organization_member_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_limit INTEGER; v_count INTEGER;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('member_limit:' || NEW.organization_id::text));
  SELECT p.max_members INTO v_limit FROM public.organizations o JOIN public.organization_plans p ON p.code = o.plan_code WHERE o.id = NEW.organization_id;
  SELECT count(*) INTO v_count FROM public.organization_members WHERE organization_id = NEW.organization_id AND status = 'active';
  IF v_limit IS NOT NULL AND v_count >= v_limit THEN
    RAISE EXCEPTION 'member_limit_reached: o plano permite no máximo % membros ativos', v_limit USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_organization_member_limit ON public.organization_members;
CREATE TRIGGER enforce_organization_member_limit BEFORE INSERT OR UPDATE OF status ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_member_limit();

CREATE OR REPLACE FUNCTION public.enforce_client_plan_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_limit INTEGER; v_count INTEGER;
BEGIN
  IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('client_limit:' || NEW.organization_id::text));
  SELECT p.max_clients INTO v_limit FROM public.organizations o JOIN public.organization_plans p ON p.code = o.plan_code WHERE o.id = NEW.organization_id;
  SELECT count(*) INTO v_count FROM public.clients WHERE organization_id = NEW.organization_id;
  IF v_limit IS NOT NULL AND v_count >= v_limit THEN
    RAISE EXCEPTION 'client_limit_reached: o plano permite no máximo % clientes', v_limit USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_organization_member_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_client_plan_limit() FROM PUBLIC, anon, authenticated;
-- A migration antiga de beta podia ter criado este trigger. Removê-lo evita
-- duas fontes de verdade (client_limit e os limites do catálogo de planos).
DROP TRIGGER IF EXISTS enforce_client_limit ON public.clients;
DROP TRIGGER IF EXISTS enforce_client_plan_limit ON public.clients;
CREATE TRIGGER enforce_client_plan_limit BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_client_plan_limit();

CREATE OR REPLACE FUNCTION public.consume_organization_ai_run(_organization_id UUID, _amount INTEGER DEFAULT 1)
RETURNS TABLE (allowed BOOLEAN, used INTEGER, quota INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_quota INTEGER; v_used INTEGER; v_period DATE := date_trunc('month', now())::date;
BEGIN
  IF _amount IS NULL OR _amount < 1 OR _amount > 100 THEN RAISE EXCEPTION 'Quantidade inválida' USING ERRCODE = '22023'; END IF;
  IF NOT public.is_org_member(_organization_id) THEN RAISE EXCEPTION 'Sem acesso à organização' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ai_quota:' || _organization_id::text || ':' || v_period::text));
  SELECT p.max_monthly_ai_runs INTO v_quota FROM public.organizations o JOIN public.organization_plans p ON p.code = o.plan_code WHERE o.id = _organization_id;
  INSERT INTO public.organization_usage_monthly (organization_id, period_start) VALUES (_organization_id, v_period) ON CONFLICT DO NOTHING;
  SELECT ai_runs INTO v_used FROM public.organization_usage_monthly WHERE organization_id = _organization_id AND period_start = v_period FOR UPDATE;
  IF v_used + _amount > v_quota THEN RETURN QUERY SELECT false, v_used, v_quota; RETURN; END IF;
  UPDATE public.organization_usage_monthly SET ai_runs = ai_runs + _amount, updated_at = now() WHERE organization_id = _organization_id AND period_start = v_period;
  RETURN QUERY SELECT true, v_used + _amount, v_quota;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_organization_ai_run(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_organization_ai_run(UUID, INTEGER) TO authenticated;

COMMENT ON TABLE public.organization_plans IS 'Catálogo de planos e limites; cobrança atualiza a organização via service_role.';
COMMENT ON TABLE public.organization_usage_monthly IS 'Contadores mensais atômicos por organização para quotas de IA e armazenamento.';

COMMIT;
