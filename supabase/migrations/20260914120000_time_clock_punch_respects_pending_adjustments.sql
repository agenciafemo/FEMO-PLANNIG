-- Ponto: ajuste de horário em análise conta na sequência de batidas do dia.
--
-- Antes, a próxima batida esperada olhava só as batidas oficiais. Com um
-- ajuste "Entrada 08:30 · em análise", a pessoa ficava travada:
--   * bater "saída almoço" era recusado (o servidor ainda esperava "entrada");
--   * bater "entrada" de novo passava, mas a aprovação do ajuste falhava depois
--     ("Ja existe uma batida deste tipo").
-- Agora os ajustes pendentes do dia entram na sequência pelo horário pedido.
-- O ajuste continua fora do banco de horas até ser aprovado (a aprovação é
-- que materializa a batida oficial).
--
-- CREATE OR REPLACE preserva privilégios e o trigger existente. Idempotente.
-- Única mudança em relação a 20260811170000: o SELECT de v_last_kind.

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
