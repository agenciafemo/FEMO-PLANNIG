-- ============================================================================
-- BANCO DE HORAS — SALDO BASELINE POR COLABORADOR
--
-- Guarda o "saldo de abertura" (banco de horas atual) de cada colaborador e a
-- data a partir da qual os pontos passam a acumular sobre esse saldo. Isso
-- permite migrar de apps antigos (Tiqtaque / Femo Daily) sem recomputar todo o
-- histórico: define-se o saldo atual e o app acumula daqui pra frente.
--
--   banco acumulado exibido = baseline_seconds
--                            + soma dos saldos diários dos pontos com
--                              data >= effective_from
--
-- Os pontos anteriores a effective_from NÃO entram no banco (evita dobrar a
-- conta com o valor já embutido no baseline). Eles seguem guardados apenas
-- para o histórico detalhado.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.time_clock_hour_bank_baseline (
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  baseline_seconds INTEGER NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL DEFAULT current_date,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  PRIMARY KEY (organization_id, user_id)
);

COMMENT ON TABLE public.time_clock_hour_bank_baseline IS
  'Saldo de abertura do banco de horas por colaborador. O app acumula os pontos a partir de effective_from sobre baseline_seconds.';
COMMENT ON COLUMN public.time_clock_hour_bank_baseline.baseline_seconds IS
  'Saldo atual do banco de horas em segundos (pode ser negativo). Valor migrado do app anterior.';
COMMENT ON COLUMN public.time_clock_hour_bank_baseline.effective_from IS
  'Data a partir da qual os pontos passam a somar sobre o baseline. Pontos anteriores ficam só no histórico.';

ALTER TABLE public.time_clock_hour_bank_baseline ENABLE ROW LEVEL SECURITY;

-- Leitura: cada um vê o próprio saldo; gestor do ponto vê o de toda a organização.
DROP POLICY IF EXISTS time_clock_hour_bank_baseline_select ON public.time_clock_hour_bank_baseline;
CREATE POLICY time_clock_hour_bank_baseline_select
  ON public.time_clock_hour_bank_baseline
  FOR SELECT
  TO authenticated
  USING (
    public.is_org_member(organization_id, auth.uid())
    AND (
      user_id = auth.uid()
      OR public.can_view_team_time_clock(organization_id)
    )
  );

-- Escrita (definir/ajustar saldo): apenas gestores do ponto da organização.
DROP POLICY IF EXISTS time_clock_hour_bank_baseline_write ON public.time_clock_hour_bank_baseline;
CREATE POLICY time_clock_hour_bank_baseline_write
  ON public.time_clock_hour_bank_baseline
  FOR ALL
  TO authenticated
  USING (public.can_view_team_time_clock(organization_id))
  WITH CHECK (public.can_view_team_time_clock(organization_id));

COMMIT;
