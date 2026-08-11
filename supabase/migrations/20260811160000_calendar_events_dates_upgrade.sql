-- ============================================================================
-- CALENDARIO — evento estilo Google (dia inteiro + horario) e datas
-- comemorativas por cliente / novas categorias.
--
-- Aditiva e segura: só adiciona colunas/constraints. Linhas existentes seguem
-- válidas (all_day default true; client_id null = data geral da organização).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.calendar_events') IS NULL
     OR to_regclass('public.commemorative_dates') IS NULL THEN
    RAISE EXCEPTION 'calendar upgrade: tabelas do calendario ausentes';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1) calendar_events: dia inteiro + horario de inicio/fim (estilo Google).
-- ---------------------------------------------------------------------------
ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time TIME;

-- Coerencia: evento com horario nao pode ser "dia inteiro"; se tiver fim,
-- precisa ter inicio.
ALTER TABLE public.calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_time_consistent;
ALTER TABLE public.calendar_events
  ADD CONSTRAINT calendar_events_time_consistent
  CHECK (
    (all_day = true AND start_time IS NULL AND end_time IS NULL)
    OR (all_day = false AND start_time IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 2) commemorative_dates: por cliente + categorias aniversario/personalizada.
-- ---------------------------------------------------------------------------
ALTER TABLE public.commemorative_dates
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE;

-- client_id só existe em datas de organização (nunca no catalogo global).
ALTER TABLE public.commemorative_dates
  DROP CONSTRAINT IF EXISTS commemorative_dates_client_requires_org;
ALTER TABLE public.commemorative_dates
  ADD CONSTRAINT commemorative_dates_client_requires_org
  CHECK (client_id IS NULL OR organization_id IS NOT NULL);

-- Amplia as categorias (aniversario = data recorrente de pessoa/empresa;
-- personalizada = qualquer data que a agencia queira acompanhar).
ALTER TABLE public.commemorative_dates
  DROP CONSTRAINT IF EXISTS commemorative_dates_category_check;
ALTER TABLE public.commemorative_dates
  ADD CONSTRAINT commemorative_dates_category_check
  CHECK (category IN ('nacional', 'varejo', 'sazonal', 'aniversario', 'personalizada'));

-- Unicidade por organizacao passa a considerar o cliente (mesmo titulo pode
-- existir para clientes diferentes, ex.: "Aniversario").
DROP INDEX IF EXISTS commemorative_dates_org_title_rule_key;
CREATE UNIQUE INDEX commemorative_dates_org_title_rule_key
  ON public.commemorative_dates (
    organization_id,
    COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(title)),
    recurrence_rule
  )
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS commemorative_dates_client_idx
  ON public.commemorative_dates (client_id) WHERE client_id IS NOT NULL;

-- Impede associar a data a um cliente de outra organizacao.
CREATE OR REPLACE FUNCTION public.validate_commemorative_date_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.client_id IS DISTINCT FROM OLD.client_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.clients c
       WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id
     ) THEN
    RAISE EXCEPTION 'O cliente deve pertencer a mesma organizacao da data';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_commemorative_date_tenant ON public.commemorative_dates;
CREATE TRIGGER validate_commemorative_date_tenant
BEFORE INSERT OR UPDATE ON public.commemorative_dates
FOR EACH ROW EXECUTE FUNCTION public.validate_commemorative_date_tenant();

COMMIT;
