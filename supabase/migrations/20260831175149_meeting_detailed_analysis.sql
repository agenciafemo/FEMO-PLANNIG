-- Análise aprofundada opcional da reunião. Fica separada da ata operacional:
-- gerar detalhes nunca deve recriar decisões nem apagar itens de ação.

BEGIN;

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS detailed_summary JSONB,
  ADD COLUMN IF NOT EXISTS detailed_summary_generated_at TIMESTAMPTZ;

ALTER TABLE public.meetings
  DROP CONSTRAINT IF EXISTS meetings_detailed_summary_object_check;

ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_detailed_summary_object_check
  CHECK (
    detailed_summary IS NULL
    OR jsonb_typeof(detailed_summary) = 'object'
  );

COMMENT ON COLUMN public.meetings.detailed_summary IS
  'Análise detalhada opcional, derivada exclusivamente da transcrição e salva '
  'separadamente da ata, decisões e itens de ação.';

COMMENT ON COLUMN public.meetings.detailed_summary_generated_at IS
  'Momento em que a análise detalhada atual foi gerada. É apagado ao refazer a ata.';

COMMIT;
