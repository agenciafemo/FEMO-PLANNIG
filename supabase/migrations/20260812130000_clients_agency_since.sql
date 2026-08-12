-- ============================================================================
-- CLIENTES — "cliente desde" (data de início na agência).
--
-- Campo opcional para controle: desde quando o cliente está na agência. A UI
-- calcula o "tempo na agência" a partir disso. Aditiva e segura; as políticas
-- de RLS existentes de clients já cobrem a coluna.
-- ============================================================================

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS agency_since DATE;

COMMENT ON COLUMN public.clients.agency_since IS
  'Data em que o cliente entrou na agência (para calcular tempo de casa).';

COMMIT;
