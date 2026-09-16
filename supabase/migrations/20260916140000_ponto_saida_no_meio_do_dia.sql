-- ============================================================================
-- Ponto: sair no meio do dia (médico, banco) e voltar — e anotar observação
-- em qualquer data.
--
-- Hoje o dia tem exatamente 4 batidas em ordem fixa. Quem sai às 10h para o
-- médico e volta às 11h não tem como registrar: ou usa o almoço no lugar
-- errado, ou o servidor recusa ("A jornada de hoje já foi concluída").
--
-- Passa a existir o par "saída no meio do dia" / "retorno", repetível quantas
-- vezes for preciso. O tempo fora sai da conta do dia (é o que já acontece
-- entre duas batidas) e gera um pedido para ADM/Head responder: abonar (tem
-- atestado) ou descontar do banco de horas. Assim nada fica sem resposta.
--
-- Também cria a observação por data, escrita pela própria pessoa e lida por
-- quem aprova.
--
-- Depende de: 20260811120000 (ponto), 20260812120000 (ausências),
-- 20260916130000 (avisos de quem aprova). Idempotente.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.time_clock_punches') IS NULL
     OR to_regclass('public.time_clock_adjustment_requests') IS NULL THEN
    RAISE EXCEPTION 'Faltam as tabelas do Ponto';
  END IF;

  IF to_regprocedure('public.can_view_team_time_clock(uuid)') IS NULL
     OR to_regprocedure('public.is_org_member(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam as funções de permissão (can_view_team_time_clock / is_org_member)';
  END IF;

  IF to_regprocedure('public.time_clock_approver_ids(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Aplique antes a migration 20260916130000 (avisos de quem aprova)';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1) Dois tipos novos de batida.
-- ---------------------------------------------------------------------------
ALTER TABLE public.time_clock_punches
  DROP CONSTRAINT IF EXISTS time_clock_punches_kind_check;
ALTER TABLE public.time_clock_punches
  ADD CONSTRAINT time_clock_punches_kind_check
  CHECK (kind IN ('entrada', 'saida_almoco', 'volta_almoco', 'saida',
                  'saida_intervalo', 'volta_intervalo'));

-- O ajuste de horário também precisa alcançar as batidas novas: quem esqueceu
-- de bater o retorno tem que poder pedir o horário certo.
ALTER TABLE public.time_clock_adjustment_requests
  DROP CONSTRAINT IF EXISTS time_clock_adjustment_requests_kind_check;
ALTER TABLE public.time_clock_adjustment_requests
  ADD CONSTRAINT time_clock_adjustment_requests_kind_check
  CHECK (kind IN ('entrada', 'saida_almoco', 'volta_almoco', 'saida',
                  'saida_intervalo', 'volta_intervalo'));

COMMENT ON COLUMN public.time_clock_punches.kind IS
  'entrada, saida_almoco, volta_almoco, saida e o par repetível saida_intervalo/volta_intervalo (saída no meio do dia).';

-- ---------------------------------------------------------------------------
-- 2) Sequência do dia: o par do meio do dia entra em qualquer momento.
--
-- Estado "dentro" = entrada, volta_almoco ou volta_intervalo.
-- Estado "fora"   = saida_almoco, saida_intervalo (esperam o retorno) e saida
--                   (encerra o dia).
-- ---------------------------------------------------------------------------
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
  v_almoco_feito BOOLEAN;
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

  -- Última etapa do dia: batidas oficiais + ajustes ainda em análise.
  SELECT sequence.kind
  INTO v_last_kind
  FROM (
    SELECT punch.kind, punch.punched_at AS happened_at
    FROM public.time_clock_punches punch
    WHERE punch.organization_id = NEW.organization_id
      AND punch.user_id = NEW.user_id
      AND punch.punched_at >= v_day_start
      AND punch.punched_at < v_next_day_start
    UNION ALL
    SELECT request.kind, request.requested_punched_at AS happened_at
    FROM public.time_clock_adjustment_requests request
    WHERE request.organization_id = NEW.organization_id
      AND request.user_id = NEW.user_id
      AND request.status = 'pending'
      AND request.requested_punched_at >= v_day_start
      AND request.requested_punched_at < v_next_day_start
  ) sequence
  ORDER BY sequence.happened_at DESC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM public.time_clock_punches punch
    WHERE punch.organization_id = NEW.organization_id
      AND punch.user_id = NEW.user_id
      AND punch.kind = 'saida_almoco'
      AND punch.punched_at >= v_day_start
      AND punch.punched_at < v_next_day_start
  ) INTO v_almoco_feito;

  IF v_last_kind IS NULL THEN
    IF NEW.kind <> 'entrada' THEN
      RAISE EXCEPTION 'Comece o dia registrando a entrada';
    END IF;

  ELSIF v_last_kind = 'saida_almoco' THEN
    IF NEW.kind <> 'volta_almoco' THEN
      RAISE EXCEPTION 'Você está no almoço: registre a volta do almoço';
    END IF;

  ELSIF v_last_kind = 'saida_intervalo' THEN
    IF NEW.kind <> 'volta_intervalo' THEN
      RAISE EXCEPTION 'Você está fora: registre o retorno antes da próxima batida';
    END IF;

  ELSIF v_last_kind = 'saida' THEN
    RAISE EXCEPTION 'A jornada de hoje ja foi concluida';

  ELSE
    -- Dentro (entrada, volta do almoço ou retorno): pode almoçar (uma vez),
    -- sair no meio do dia (quantas vezes precisar) ou encerrar.
    IF NEW.kind NOT IN ('saida_almoco', 'saida_intervalo', 'saida') THEN
      RAISE EXCEPTION 'Você já está trabalhando: registre saída para almoço, saída no meio do dia ou saída';
    END IF;

    IF NEW.kind = 'saida_almoco' AND v_almoco_feito THEN
      RAISE EXCEPTION 'O almoço de hoje já foi registrado; use a saída no meio do dia';
    END IF;
  END IF;

  NEW.punched_at := v_now;
  NEW.created_at := NEW.punched_at;
  NEW.note := NULLIF(btrim(NEW.note), '');
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) O tempo fora vira um pedido para ADM/Head responder.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_clock_interval_justifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  work_date DATE NOT NULL,
  left_at TIMESTAMPTZ NOT NULL,
  returned_at TIMESTAMPTZ NOT NULL,
  minutes INTEGER NOT NULL,
  reason TEXT NOT NULL,
  -- 'abono' = tem atestado, o tempo não pesa no dia (depois de aprovado).
  -- 'banco' = sai do banco de horas mesmo, só precisa de ciência.
  treatment TEXT NOT NULL CHECK (treatment IN ('abono', 'banco')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT time_clock_interval_period CHECK (returned_at > left_at),
  CONSTRAINT time_clock_interval_minutes CHECK (minutes > 0 AND minutes <= 24 * 60),
  CONSTRAINT time_clock_interval_reason CHECK (btrim(reason) <> '' AND char_length(reason) <= 500),
  CONSTRAINT time_clock_interval_note_length
    CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  CONSTRAINT time_clock_interval_review_state CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.time_clock_interval_justifications IS
  'Saída no meio do dia: quanto tempo, por quê e o que fazer com as horas (abono ou banco). ADM/Head responde.';

ALTER TABLE public.time_clock_interval_justifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS time_clock_interval_org_user_idx
  ON public.time_clock_interval_justifications (organization_id, user_id, work_date DESC);
CREATE INDEX IF NOT EXISTS time_clock_interval_org_status_idx
  ON public.time_clock_interval_justifications (organization_id, status, work_date DESC);

CREATE OR REPLACE FUNCTION public.prepare_time_clock_interval_justification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Só dá para justificar a própria saída';
    END IF;

    NEW.status := 'pending';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.review_note := NULL;
    NEW.reason := btrim(NEW.reason);
    NEW.minutes := GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NEW.returned_at - NEW.left_at)) / 60)::INTEGER);
    NEW.work_date := (NEW.left_at AT TIME ZONE 'America/Sao_Paulo')::DATE;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Este pedido já foi respondido';
  END IF;

  IF NEW.status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Responda aprovando ou recusando';
  END IF;

  IF NOT public.can_view_team_time_clock(NEW.organization_id) THEN
    RAISE EXCEPTION 'Somente ADM ou Head responde pedidos do ponto';
  END IF;

  -- O que foi pedido é imutável; a revisão só preenche quem respondeu.
  NEW.organization_id := OLD.organization_id;
  NEW.user_id := OLD.user_id;
  NEW.work_date := OLD.work_date;
  NEW.left_at := OLD.left_at;
  NEW.returned_at := OLD.returned_at;
  NEW.minutes := OLD.minutes;
  NEW.reason := OLD.reason;
  NEW.treatment := OLD.treatment;
  NEW.created_at := OLD.created_at;
  NEW.reviewed_by := auth.uid();
  NEW.reviewed_at := clock_timestamp();
  NEW.review_note := NULLIF(btrim(NEW.review_note), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_interval_justification ON public.time_clock_interval_justifications;
CREATE TRIGGER prepare_interval_justification
BEFORE INSERT OR UPDATE ON public.time_clock_interval_justifications
FOR EACH ROW EXECUTE FUNCTION public.prepare_time_clock_interval_justification();

DROP POLICY IF EXISTS time_clock_interval_select_own_or_managers
  ON public.time_clock_interval_justifications;
CREATE POLICY time_clock_interval_select_own_or_managers
ON public.time_clock_interval_justifications
FOR SELECT TO authenticated
USING (
  (user_id = auth.uid() AND public.is_org_member(organization_id, auth.uid()))
  OR public.can_view_team_time_clock(organization_id)
);

DROP POLICY IF EXISTS time_clock_interval_insert_own
  ON public.time_clock_interval_justifications;
CREATE POLICY time_clock_interval_insert_own
ON public.time_clock_interval_justifications
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND status = 'pending'
  AND public.is_org_member(organization_id, auth.uid())
);

DROP POLICY IF EXISTS time_clock_interval_managers_update
  ON public.time_clock_interval_justifications;
CREATE POLICY time_clock_interval_managers_update
ON public.time_clock_interval_justifications
FOR UPDATE TO authenticated
USING (public.can_view_team_time_clock(organization_id))
WITH CHECK (public.can_view_team_time_clock(organization_id));

REVOKE ALL ON public.time_clock_interval_justifications FROM anon;
REVOKE DELETE ON public.time_clock_interval_justifications FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.time_clock_interval_justifications TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Observação por data: a pessoa escreve, quem aprova lê.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_clock_day_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  work_date DATE NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT time_clock_day_notes_note
    CHECK (btrim(note) <> '' AND char_length(note) <= 1000),
  CONSTRAINT time_clock_day_notes_unica UNIQUE (organization_id, user_id, work_date)
);

COMMENT ON TABLE public.time_clock_day_notes IS
  'Observação do colaborador em uma data do ponto (ex.: "saí às 10h para o médico"). ADM/Head lê.';

ALTER TABLE public.time_clock_day_notes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prepare_time_clock_day_note()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Só dá para anotar no próprio ponto';
  END IF;
  NEW.note := btrim(NEW.note);
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.organization_id := OLD.organization_id;
    NEW.user_id := OLD.user_id;
    NEW.work_date := OLD.work_date;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_day_note ON public.time_clock_day_notes;
CREATE TRIGGER prepare_day_note
BEFORE INSERT OR UPDATE ON public.time_clock_day_notes
FOR EACH ROW EXECUTE FUNCTION public.prepare_time_clock_day_note();

DROP POLICY IF EXISTS time_clock_day_notes_select_own_or_managers ON public.time_clock_day_notes;
CREATE POLICY time_clock_day_notes_select_own_or_managers
ON public.time_clock_day_notes
FOR SELECT TO authenticated
USING (
  (user_id = auth.uid() AND public.is_org_member(organization_id, auth.uid()))
  OR public.can_view_team_time_clock(organization_id)
);

DROP POLICY IF EXISTS time_clock_day_notes_write_own ON public.time_clock_day_notes;
CREATE POLICY time_clock_day_notes_write_own
ON public.time_clock_day_notes
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS time_clock_day_notes_update_own ON public.time_clock_day_notes;
CREATE POLICY time_clock_day_notes_update_own
ON public.time_clock_day_notes
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS time_clock_day_notes_delete_own ON public.time_clock_day_notes;
CREATE POLICY time_clock_day_notes_delete_own
ON public.time_clock_day_notes
FOR DELETE TO authenticated
USING (user_id = auth.uid());

REVOKE ALL ON public.time_clock_day_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_clock_day_notes TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Avisos: pedido de saída no meio do dia e a resposta dele.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_time_clock_interval_requested()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (organization_id, user_id, type, title, body)
  SELECT
    NEW.organization_id,
    approver,
    'time_clock_approval',
    '⏰ Ponto: saída no meio do dia para aprovar',
    public.time_clock_person_name(NEW.organization_id, NEW.user_id)
      || ' ficou ' || NEW.minutes || ' min fora em '
      || to_char(NEW.work_date, 'DD/MM') || ' — '
      || CASE NEW.treatment WHEN 'abono' THEN 'pede abono' ELSE 'descontar do banco' END
      || ': ' || left(NEW.reason, 100)
  FROM public.time_clock_approver_ids(NEW.organization_id) AS approver
  WHERE approver <> NEW.user_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_time_clock_interval_reviewed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('approved', 'rejected') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (organization_id, user_id, type, title, body)
  VALUES (
    NEW.organization_id,
    NEW.user_id,
    'time_clock_reviewed',
    CASE NEW.status
      WHEN 'approved' THEN '✅ Ponto: sua saída no meio do dia foi aprovada'
      ELSE '❌ Ponto: sua saída no meio do dia foi recusada'
    END,
    NEW.minutes || ' min em ' || to_char(NEW.work_date, 'DD/MM') || ' — '
      || CASE NEW.status
           WHEN 'approved' THEN
             CASE NEW.treatment WHEN 'abono' THEN 'abonado' ELSE 'descontado do banco de horas' END
           ELSE 'recusado'
         END
      || COALESCE('. ' || NULLIF(btrim(NEW.review_note), ''), '')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_interval_requested ON public.time_clock_interval_justifications;
CREATE TRIGGER notify_interval_requested
AFTER INSERT ON public.time_clock_interval_justifications
FOR EACH ROW EXECUTE FUNCTION public.notify_time_clock_interval_requested();

DROP TRIGGER IF EXISTS notify_interval_reviewed ON public.time_clock_interval_justifications;
CREATE TRIGGER notify_interval_reviewed
AFTER UPDATE OF status ON public.time_clock_interval_justifications
FOR EACH ROW EXECUTE FUNCTION public.notify_time_clock_interval_reviewed();

COMMIT;

-- Conferência: 8 linhas, todas ok = true.
SELECT 'batida do meio do dia permitida' AS item,
       pg_get_constraintdef(oid) ILIKE '%saida_intervalo%' AS ok
FROM pg_constraint WHERE conname = 'time_clock_punches_kind_check'
UNION ALL
SELECT 'ajuste alcança as batidas novas',
       pg_get_constraintdef(oid) ILIKE '%volta_intervalo%'
FROM pg_constraint WHERE conname = 'time_clock_adjustment_requests_kind_check'
UNION ALL
SELECT 'sequência aceita sair no meio',
       pg_get_functiondef('public.prepare_time_clock_punch()'::regprocedure) ILIKE '%saida_intervalo%'
UNION ALL
SELECT 'tabela de justificativa', to_regclass('public.time_clock_interval_justifications') IS NOT NULL
UNION ALL
SELECT 'tabela de observações', to_regclass('public.time_clock_day_notes') IS NOT NULL
UNION ALL
SELECT 'justificativa com RLS',
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.time_clock_interval_justifications'::regclass)
UNION ALL
SELECT 'observação com RLS',
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.time_clock_day_notes'::regclass)
UNION ALL
SELECT 'avisos da saída no meio do dia',
       (SELECT count(*) FROM pg_trigger
        WHERE tgrelid = 'public.time_clock_interval_justifications'::regclass
          AND NOT tgisinternal) >= 3;
