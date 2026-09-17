-- ============================================================================
-- Ponto: "Editar hora" corrige a batida que já existe.
--
-- O ajuste aprovado só sabia ACRESCENTAR uma batida. Se o dia já tinha uma
-- entrada (mesmo errada), aprovar "Entrada 08:30" falhava com "Ja existe uma
-- batida deste tipo" — e o dia ficava sem conserto. Aconteceu em 16/09: a
-- saída para o almoço das 12:00 foi gravada como entrada, e a correção não
-- passava na aprovação.
--
-- Agora, ao aprovar:
--   * entrada, saída para almoço, volta do almoço e saída (uma por dia):
--     se já existe batida do mesmo tipo naquele dia, o horário dela é
--     SUBSTITUÍDO pelo pedido. O horário antigo fica gravado no próprio pedido
--     (replaced_punch_id / replaced_punched_at) — nada some sem rastro;
--   * saída no meio do dia e retorno podem se repetir: sempre acrescentam.
--     (Antes também eram recusadas quando já havia uma no dia.)
--
-- A linha da batida é atualizada, não apagada: o id continua o mesmo e todas
-- as telas e relatórios leem o horário novo sem precisar filtrar nada.
--
-- Idempotente.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.time_clock_adjustment_requests') IS NULL
     OR to_regclass('public.time_clock_punches') IS NULL THEN
    RAISE EXCEPTION 'Faltam as tabelas do Ponto';
  END IF;

  IF to_regprocedure('public.time_clock_kind_label(text)') IS NULL THEN
    RAISE EXCEPTION 'Aplique antes a migration 20260916130000 (avisos de quem aprova)';
  END IF;
END;
$$;

ALTER TABLE public.time_clock_adjustment_requests
  ADD COLUMN IF NOT EXISTS replaced_punch_id UUID
    REFERENCES public.time_clock_punches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaced_punched_at TIMESTAMPTZ;

COMMENT ON COLUMN public.time_clock_adjustment_requests.replaced_punch_id IS
  'Batida que o ajuste aprovado corrigiu (mesmo tipo, mesmo dia). NULL = o ajuste acrescentou uma batida.';
COMMENT ON COLUMN public.time_clock_adjustment_requests.replaced_punched_at IS
  'Horário que a batida tinha antes da correção. É o rastro do que foi trocado.';

-- ---------------------------------------------------------------------------
-- Validação do pedido: na aprovação, descobre se é correção ou acréscimo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_time_clock_adjustment_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_day_start TIMESTAMPTZ;
  v_next_day_start TIMESTAMPTZ;
  v_existente public.time_clock_punches%ROWTYPE;
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
    -- Quem decide o que é substituído é a aprovação, não quem pede.
    NEW.replaced_punch_id := NULL;
    NEW.replaced_punched_at := NULL;
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

  NEW.replaced_punch_id := NULL;
  NEW.replaced_punched_at := NULL;

  -- Saída no meio do dia e retorno se repetem: sempre acrescentam.
  IF NEW.status = 'approved'
     AND NEW.kind NOT IN ('saida_intervalo', 'volta_intervalo') THEN
    v_day_start := date_trunc(
      'day',
      NEW.requested_punched_at AT TIME ZONE 'America/Sao_Paulo'
    ) AT TIME ZONE 'America/Sao_Paulo';
    v_next_day_start := v_day_start + INTERVAL '1 day';

    SELECT punch.*
    INTO v_existente
    FROM public.time_clock_punches punch
    WHERE punch.organization_id = NEW.organization_id
      AND punch.user_id = NEW.user_id
      AND punch.kind = NEW.kind
      AND punch.punched_at >= v_day_start
      AND punch.punched_at < v_next_day_start
    ORDER BY punch.punched_at
    LIMIT 1;

    IF FOUND THEN
      NEW.replaced_punch_id := v_existente.id;
      NEW.replaced_punched_at := v_existente.punched_at;
    END IF;
  END IF;

  NEW.reviewed_by := auth.uid();
  NEW.reviewed_at := clock_timestamp();
  NEW.review_note := NULLIF(btrim(NEW.review_note), '');
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Aprovação: corrige a batida existente ou cria uma nova.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_approved_time_clock_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    IF NEW.replaced_punch_id IS NOT NULL THEN
      UPDATE public.time_clock_punches
      SET punched_at = NEW.requested_punched_at,
          adjustment_request_id = NEW.id,
          note = left(
            'Ajuste aprovado (antes '
              || to_char(NEW.replaced_punched_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')
              || '): ' || NEW.reason,
            500
          )
      WHERE id = NEW.replaced_punch_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'A batida a corrigir nao foi encontrada';
      END IF;
    ELSE
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
  END IF;
  RETURN NEW;
END;
$$;

-- Rótulos das batidas do meio do dia (antes saíam como "saida_intervalo").
CREATE OR REPLACE FUNCTION public.time_clock_kind_label(_kind TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _kind
    WHEN 'entrada' THEN 'entrada'
    WHEN 'saida_almoco' THEN 'saída para almoço'
    WHEN 'volta_almoco' THEN 'volta do almoço'
    WHEN 'saida' THEN 'saída'
    WHEN 'saida_intervalo' THEN 'saída no meio do dia'
    WHEN 'volta_intervalo' THEN 'retorno'
    WHEN 'atestado' THEN 'atestado'
    WHEN 'folga' THEN 'folga'
    WHEN 'ferias' THEN 'férias'
    WHEN 'outro' THEN 'ausência'
    ELSE _kind
  END
$$;

-- Resposta avisa quem pediu — e diz qual horário foi trocado.
CREATE OR REPLACE FUNCTION public.notify_time_clock_request_reviewed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assunto TEXT;
  v_detalhe TEXT;
BEGIN
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('approved', 'rejected') THEN
    RETURN NEW;
  END IF;

  -- A tabela de ajuste tem kind + horário; a de ausência tem kind + período.
  IF TG_TABLE_NAME = 'time_clock_adjustment_requests' THEN
    v_assunto := 'Horário de ' || public.time_clock_kind_label(NEW.kind) || ' em '
      || to_char(NEW.requested_punched_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM')
      || ' às '
      || to_char(NEW.requested_punched_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI');
    IF NEW.status = 'approved' AND NEW.replaced_punched_at IS NOT NULL THEN
      v_assunto := v_assunto || ' (no lugar de '
        || to_char(NEW.replaced_punched_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') || ')';
    END IF;
  ELSE
    v_assunto := initcap(public.time_clock_kind_label(NEW.kind)) || ' de '
      || to_char(NEW.start_date, 'DD/MM') || ' a ' || to_char(NEW.end_date, 'DD/MM');
  END IF;

  v_detalhe := v_assunto || ' — '
    || CASE NEW.status WHEN 'approved' THEN 'aprovado' ELSE 'recusado' END
    || COALESCE('. ' || NULLIF(btrim(NEW.review_note), ''), '');

  INSERT INTO public.notifications (organization_id, user_id, type, title, body)
  VALUES (
    NEW.organization_id,
    NEW.user_id,
    'time_clock_reviewed',
    CASE NEW.status
      WHEN 'approved' THEN '✅ Ponto: seu pedido foi aprovado'
      ELSE '❌ Ponto: seu pedido foi recusado'
    END,
    v_detalhe
  );

  RETURN NEW;
END;
$$;

COMMIT;

-- Conferência: 5 linhas, todas ok = true.
SELECT 'pedido guarda o horário trocado' AS item,
       (SELECT count(*) = 2 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'time_clock_adjustment_requests'
          AND column_name IN ('replaced_punch_id', 'replaced_punched_at')) AS ok
UNION ALL
SELECT 'aprovação não recusa mais batida existente',
       pg_get_functiondef('public.prepare_time_clock_adjustment_request()'::regprocedure)
         NOT ILIKE '%Ja existe uma batida deste tipo%'
UNION ALL
SELECT 'aprovação corrige a batida',
       pg_get_functiondef('public.apply_approved_time_clock_adjustment()'::regprocedure)
         ILIKE '%replaced_punch_id%'
UNION ALL
SELECT 'aviso diz o horário trocado',
       pg_get_functiondef('public.notify_time_clock_request_reviewed()'::regprocedure)
         ILIKE '%no lugar de%'
UNION ALL
SELECT 'gatilhos de aprovação continuam ligados',
       (SELECT count(*) FROM pg_trigger
        WHERE tgrelid = 'public.time_clock_adjustment_requests'::regclass
          AND tgname IN ('prepare_time_clock_adjustment_request', 'apply_approved_time_clock_adjustment')
          AND NOT tgisinternal) = 2;
