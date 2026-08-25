-- ============================================================================
-- Campo para ligar a transcricao automatica de um evento do Calendario de
-- Equipe (bot entra no link da reuniao e grava/transcreve).
-- ============================================================================

BEGIN;

ALTER TABLE public.team_events
  ADD COLUMN IF NOT EXISTS record_and_transcribe BOOLEAN NOT NULL DEFAULT false;

COMMIT;
