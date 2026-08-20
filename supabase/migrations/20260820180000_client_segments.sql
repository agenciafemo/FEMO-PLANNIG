-- ============================================================================
-- Segmentos de cliente para o calendário.
--   • clients.segment: o segmento do cliente (medicos, mecanica, dentista, ...).
--   • commemorative_dates.segment: a qual segmento a data pertence.
-- No calendário, um cliente vê: datas do SEU segmento + datas universais
-- (segment NULL e client_id NULL) + as datas específicas dele (client_id).
-- Idempotente.
-- ============================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS segment TEXT;

ALTER TABLE public.commemorative_dates
  ADD COLUMN IF NOT EXISTS segment TEXT;

-- Índice para o filtro por segmento no calendário.
CREATE INDEX IF NOT EXISTS commemorative_dates_segment_idx
  ON public.commemorative_dates (segment);
