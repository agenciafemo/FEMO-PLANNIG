-- ============================================================================
-- Permite o MESMO título em segmentos diferentes (ex.: "Dia do Motorista" em
-- Mecânica e em Uniformes). O índice único antigo não considerava o segmento,
-- então bloqueava. Recria incluindo o segmento na chave.
-- Idempotente.
-- ============================================================================

-- Remove o índice/constraint antigo (pode ser constraint OU índice).
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE public.commemorative_dates DROP CONSTRAINT commemorative_dates_org_title_rule_key';
  EXCEPTION WHEN others THEN NULL;
  END;
  EXECUTE 'DROP INDEX IF EXISTS public.commemorative_dates_org_title_rule_key';
END $$;

-- Nova chave única incluindo o segmento.
CREATE UNIQUE INDEX IF NOT EXISTS commemorative_dates_org_title_rule_seg_key
  ON public.commemorative_dates (
    organization_id,
    COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(title)),
    recurrence_rule,
    COALESCE(segment, '')
  );
