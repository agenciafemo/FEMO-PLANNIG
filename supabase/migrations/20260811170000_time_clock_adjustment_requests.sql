-- ============================================================================
-- SOLICITACOES DE AJUSTE DE PONTO
--
-- Migration preparada para revisao. Nao aplicar diretamente em producao.
-- O colaborador solicita uma batida retroativa com justificativa; somente
-- ADM/Head pode aprovar ou rejeitar. A aprovacao cria uma batida auditavel.
-- ============================================================================

BEGIN;

CREATE TABLE public.time_clock_adjustment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  requested_punched_at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('entrada', 'saida_almoco', 'volta_almoco', 'saida')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT time_clock_adjustment_reason_not_blank
    CHECK (btrim(reason) <> ''),
  CONSTRAINT time_clock_adjustment_reason_length
    CHECK (char_length(btrim(reason)) BETWEEN 5 AND 1000),
  CONSTRAINT time_clock_adjustment_review_note_length
    CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  CONSTRAINT time_clock_adjustment_review_state
    CHECK (
      (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
      OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.time_clock_adjustment_requests IS
  'Pedidos auditaveis de inclusao retroativa de horario no ponto.';

ALTER TABLE public.time_clock_adjustment_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX time_clock_adjustment_org_status_created_idx
  ON public.time_clock_adjustment_requests (organization_id, status, created_at DESC);
CREATE INDEX time_clock_adjustment_org_user_created_idx
  ON public.time_clock_adjustment_requests (organization_id, user_id, created_at DESC);
CREATE UNIQUE INDEX time_clock_adjustment_pending_duplicate_idx
  ON public.time_clock_adjustment_requests (
    organization_id,
    user_id,
    requested_punched_at,
    kind
  )
  WHERE status = 'pending';

ALTER TABLE public.time_clock_punches
  ADD COLUMN adjustment_request_id UUID
    REFERENCES public.time_clock_adjustment_requests(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX time_clock_punches_adjustment_request_key
  ON public.time_clock_punches (adjustment_request_id)
  WHERE adjustment_request_id IS NOT NULL;

-- Valida criacao e torna os dados solicitados imutaveis durante a revisao.
CREATE OR REPLACE FUNCTION public.prepare_time_clock_adjustment_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_day_start TIMESTAMPTZ;
  v_next_day_start TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'A solicitacao deve pertencer ao usuario autenticado';
    END IF;

    IF NOT public.is_org_member(NEW.organization_id, auth.uid()) THEN
      RAISE EXCEPTION 'O usuario deve ser membro ativo da organizacao';
    END IF;

    IF NEW.requested_punched_at > clock_timestamp() + INTERVAL '5 minutes' THEN
      RAISE EXCEPTION 'Nao e permitido solicitar um horario futuro';
    END IF;

    NEW.reason := btrim(NEW.reason);
    NEW.status := 'pending';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.review_note := NULL;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.requested_punched_at IS DISTINCT FROM OLD.requested_punched_at
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Os dados originais da solicitacao nao podem ser alterados';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Esta solicitacao ja foi analisada';
  END IF;

  IF NEW.status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'A analise deve aprovar ou rejeitar a solicitacao';
  END IF;

  IF NOT public.can_view_team_time_clock(NEW.organization_id) THEN
    RAISE EXCEPTION 'Sem permissao para analisar solicitacoes de ponto';
  END IF;

  IF NEW.status = 'approved' THEN
    v_day_start := date_trunc(
      'day',
      NEW.requested_punched_at AT TIME ZONE 'America/Sao_Paulo'
    ) AT TIME ZONE 'America/Sao_Paulo';
    v_next_day_start := v_day_start + INTERVAL '1 day';

    IF EXISTS (
      SELECT 1
      FROM public.time_clock_punches punch
      WHERE punch.organization_id = NEW.organization_id
        AND punch.user_id = NEW.user_id
        AND punch.kind = NEW.kind
        AND punch.punched_at >= v_day_start
        AND punch.punched_at < v_next_day_start
    ) THEN
      RAISE EXCEPTION 'Ja existe uma batida deste tipo para o colaborador neste dia';
    END IF;
  END IF;

  NEW.reviewed_by := auth.uid();
  NEW.reviewed_at := clock_timestamp();
  NEW.review_note := NULLIF(btrim(NEW.review_note), '');
  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_time_clock_adjustment_request
BEFORE INSERT OR UPDATE ON public.time_clock_adjustment_requests
FOR EACH ROW EXECUTE FUNCTION public.prepare_time_clock_adjustment_request();

-- Estende o trigger existente: insercoes normais continuam usando o relogio
-- do banco; insercoes vinculadas a um pedido aprovado preservam o horario
-- solicitado e herdam todos os dados da propria solicitacao.
CREATE OR REPLACE FUNCTION public.prepare_time_clock_punch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_day_start TIMESTAMPTZ;
  v_next_day_start TIMESTAMPTZ;
  v_last_kind TEXT;
  v_expected_kind TEXT;
  v_adjustment public.time_clock_adjustment_requests%ROWTYPE;
BEGIN
  IF NEW.adjustment_request_id IS NOT NULL THEN
    SELECT request.*
    INTO v_adjustment
    FROM public.time_clock_adjustment_requests request
    WHERE request.id = NEW.adjustment_request_id
      AND request.status = 'approved';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A solicitacao de ajuste precisa estar aprovada';
    END IF;

    NEW.organization_id := v_adjustment.organization_id;
    NEW.user_id := v_adjustment.user_id;
    NEW.punched_at := v_adjustment.requested_punched_at;
    NEW.kind := v_adjustment.kind;
    NEW.note := left('Ajuste aprovado: ' || v_adjustment.reason, 500);
    NEW.created_at := v_adjustment.reviewed_at;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members member
    WHERE member.organization_id = NEW.organization_id
      AND member.user_id = NEW.user_id
      AND member.status = 'active'
  ) THEN
    RAISE EXCEPTION 'O usuario deve ser membro ativo da organizacao';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.organization_id::TEXT || ':' || NEW.user_id::TEXT, 0)
  );

  v_day_start := date_trunc('day', v_now AT TIME ZONE 'America/Sao_Paulo')
    AT TIME ZONE 'America/Sao_Paulo';
  v_next_day_start := v_day_start + INTERVAL '1 day';

  SELECT punch.kind
  INTO v_last_kind
  FROM public.time_clock_punches punch
  WHERE punch.organization_id = NEW.organization_id
    AND punch.user_id = NEW.user_id
    AND punch.punched_at >= v_day_start
    AND punch.punched_at < v_next_day_start
  ORDER BY punch.punched_at DESC
  LIMIT 1;

  v_expected_kind := CASE v_last_kind
    WHEN 'entrada' THEN 'saida_almoco'
    WHEN 'saida_almoco' THEN 'volta_almoco'
    WHEN 'volta_almoco' THEN 'saida'
    WHEN 'saida' THEN NULL
    ELSE 'entrada'
  END;

  IF v_expected_kind IS NULL THEN
    RAISE EXCEPTION 'A jornada de hoje ja foi concluida';
  END IF;

  IF NEW.kind <> v_expected_kind THEN
    RAISE EXCEPTION 'Proxima batida esperada: %', v_expected_kind;
  END IF;

  NEW.punched_at := v_now;
  NEW.created_at := NEW.punched_at;
  NEW.note := NULLIF(btrim(NEW.note), '');
  RETURN NEW;
END;
$$;

-- A aprovacao materializa a batida oficial na mesma transacao.
CREATE OR REPLACE FUNCTION public.apply_approved_time_clock_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    INSERT INTO public.time_clock_punches (
      organization_id,
      user_id,
      punched_at,
      kind,
      adjustment_request_id
    )
    VALUES (
      NEW.organization_id,
      NEW.user_id,
      NEW.requested_punched_at,
      NEW.kind,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER apply_approved_time_clock_adjustment
AFTER UPDATE OF status ON public.time_clock_adjustment_requests
FOR EACH ROW EXECUTE FUNCTION public.apply_approved_time_clock_adjustment();

CREATE POLICY time_clock_adjustments_select_own_or_managers
ON public.time_clock_adjustment_requests
FOR SELECT TO authenticated
USING (
  (
    user_id = auth.uid()
    AND public.is_org_member(organization_id, auth.uid())
  )
  OR public.can_view_team_time_clock(organization_id)
);

CREATE POLICY time_clock_adjustments_insert_own
ON public.time_clock_adjustment_requests
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND status = 'pending'
  AND public.is_org_member(organization_id, auth.uid())
);

CREATE POLICY time_clock_adjustments_managers_update
ON public.time_clock_adjustment_requests
FOR UPDATE TO authenticated
USING (public.can_view_team_time_clock(organization_id))
WITH CHECK (public.can_view_team_time_clock(organization_id));

REVOKE ALL ON public.time_clock_adjustment_requests FROM anon;
REVOKE DELETE ON public.time_clock_adjustment_requests FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.time_clock_adjustment_requests TO authenticated;

COMMIT;
