-- ============================================================================
-- Ponto: um botão só, e o horário decide o que é a batida.
--
-- A tela oferecia a próxima etapa da jornada: às 08:47, com a entrada já
-- batida, o botão dizia "Registrar saída para almoço". Quem saísse às 09:00
-- para o médico gravava almoço sem querer.
--
-- Agora o tipo vem do horário (espelho de classificarBatida no frontend):
--   * quem está fora só volta (entrada, volta do almoço ou retorno);
--   * quem está dentro: 11:00–14:30 é almoço (uma vez ao dia), a partir das
--     17:00 encerra o dia, qualquer outro horário é saída no meio do dia.
-- O servidor valida pelo SEU relógio: o cliente sugere, mas quem decide é
-- aqui — relógio de celular errado não vira almoço às 9h.
--
-- E o que foge da jornada manda a DATA para revisão de ADM/Head:
-- entrada/almoço/volta/saída fora das janelas largas, ou batida em fim de
-- semana. Saída no meio do dia não entra aqui porque já tem aprovação
-- própria (time_clock_interval_justifications).
--
-- Idempotente.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.time_clock_punches') IS NULL
     OR to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Faltam as tabelas do Ponto';
  END IF;

  IF to_regprocedure('public.time_clock_approver_ids(uuid)') IS NULL
     OR to_regprocedure('public.time_clock_person_name(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Aplique antes a migration 20260916130000 (avisos de quem aprova)';
  END IF;
END;
$$;

-- Janela esperada de cada batida, em segundos do dia. Larga de propósito:
-- diz "isto é uma batida normal", não cobra pontualidade (quem cobra minutos
-- é a tolerância de 5 min, no frontend).
CREATE OR REPLACE FUNCTION public.time_clock_janela(_kind TEXT)
RETURNS TABLE (de INTEGER, ate INTEGER)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT janela.de, janela.ate
  FROM (VALUES
    ('entrada',      6 * 3600,                10 * 3600),
    ('saida_almoco', 11 * 3600,               14 * 3600 + 30 * 60),
    ('volta_almoco', 11 * 3600 + 30 * 60,     15 * 3600),
    ('saida',        17 * 3600,               21 * 3600)
  ) AS janela(kind, de, ate)
  WHERE janela.kind = _kind
$$;

CREATE OR REPLACE FUNCTION public.time_clock_segundo_do_dia(_momento TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (EXTRACT(HOUR FROM _momento AT TIME ZONE 'America/Sao_Paulo') * 3600
        + EXTRACT(MINUTE FROM _momento AT TIME ZONE 'America/Sao_Paulo') * 60
        + EXTRACT(SECOND FROM _momento AT TIME ZONE 'America/Sao_Paulo'))::INTEGER
$$;

-- ---------------------------------------------------------------------------
-- Sequência do dia + o horário manda no tipo da saída.
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
  v_segundo INTEGER;
  v_esperado TEXT;
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
  v_segundo := public.time_clock_segundo_do_dia(v_now);

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

  -- Estando fora, só existe um caminho de volta.
  IF v_last_kind IS NULL THEN
    v_esperado := 'entrada';
  ELSIF v_last_kind = 'saida_almoco' THEN
    v_esperado := 'volta_almoco';
  ELSIF v_last_kind = 'saida_intervalo' THEN
    v_esperado := 'volta_intervalo';
  ELSIF v_last_kind = 'saida' THEN
    RAISE EXCEPTION 'A jornada de hoje ja foi concluida';
  ELSE
    -- Dentro: o horário decide. É a mesma regra de classificarBatida.
    IF NOT v_almoco_feito
       AND v_segundo >= (SELECT de FROM public.time_clock_janela('saida_almoco'))
       AND v_segundo <= (SELECT ate FROM public.time_clock_janela('saida_almoco')) THEN
      v_esperado := 'saida_almoco';
    ELSIF v_segundo >= (SELECT de FROM public.time_clock_janela('saida')) THEN
      v_esperado := 'saida';
    ELSE
      v_esperado := 'saida_intervalo';
    END IF;
  END IF;

  -- O cliente sugere o tipo; quem decide é o relógio do servidor.
  NEW.kind := v_esperado;
  NEW.punched_at := v_now;
  NEW.created_at := NEW.punched_at;
  NEW.note := NULLIF(btrim(NEW.note), '');
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Data que foge da jornada entra na fila de ADM/Head.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_clock_day_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  work_date DATE NOT NULL,
  motivos TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT time_clock_day_reviews_unica UNIQUE (organization_id, user_id, work_date),
  CONSTRAINT time_clock_day_reviews_note_length
    CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  CONSTRAINT time_clock_day_reviews_estado CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.time_clock_day_reviews IS
  'Datas com batida fora da jornada (horário atípico ou fim de semana) esperando ADM/Head.';

ALTER TABLE public.time_clock_day_reviews ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS time_clock_day_reviews_org_status_idx
  ON public.time_clock_day_reviews (organization_id, status, work_date DESC);

CREATE OR REPLACE FUNCTION public.prepare_time_clock_day_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Esta data já foi respondida';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT public.can_view_team_time_clock(NEW.organization_id) THEN
      RAISE EXCEPTION 'Somente ADM ou Head responde revisões do ponto';
    END IF;
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := clock_timestamp();
  END IF;

  NEW.organization_id := OLD.organization_id;
  NEW.user_id := OLD.user_id;
  NEW.work_date := OLD.work_date;
  NEW.created_at := OLD.created_at;
  NEW.review_note := NULLIF(btrim(NEW.review_note), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_day_review ON public.time_clock_day_reviews;
CREATE TRIGGER prepare_day_review
BEFORE INSERT OR UPDATE ON public.time_clock_day_reviews
FOR EACH ROW EXECUTE FUNCTION public.prepare_time_clock_day_review();

-- Marca a data quando a batida foge da jornada.
CREATE OR REPLACE FUNCTION public.flag_time_clock_day_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data DATE := (NEW.punched_at AT TIME ZONE 'America/Sao_Paulo')::DATE;
  v_segundo INTEGER := public.time_clock_segundo_do_dia(NEW.punched_at);
  v_de INTEGER;
  v_ate INTEGER;
  v_motivo TEXT;
  v_existente public.time_clock_day_reviews;
  v_avisar BOOLEAN := false;
BEGIN
  -- Saída no meio do dia já tem aprovação própria: não cobra duas vezes.
  IF NEW.kind IN ('saida_intervalo', 'volta_intervalo') THEN
    RETURN NEW;
  END IF;

  SELECT de, ate INTO v_de, v_ate FROM public.time_clock_janela(NEW.kind);

  IF EXTRACT(ISODOW FROM v_data) >= 6 THEN
    v_motivo := 'Batida em fim de semana às '
      || to_char(NEW.punched_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI');
  ELSIF v_de IS NOT NULL AND (v_segundo < v_de OR v_segundo > v_ate) THEN
    v_motivo := public.time_clock_kind_label(NEW.kind) || ' às '
      || to_char(NEW.punched_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')
      || ' (fora de ' || to_char((v_de || ' seconds')::INTERVAL, 'HH24:MI')
      || '–' || to_char((v_ate || ' seconds')::INTERVAL, 'HH24:MI') || ')';
  ELSE
    RETURN NEW;
  END IF;

  SELECT * INTO v_existente
  FROM public.time_clock_day_reviews
  WHERE organization_id = NEW.organization_id
    AND user_id = NEW.user_id
    AND work_date = v_data;

  IF NOT FOUND THEN
    INSERT INTO public.time_clock_day_reviews
      (organization_id, user_id, work_date, motivos)
    VALUES (NEW.organization_id, NEW.user_id, v_data, ARRAY[v_motivo]);
    v_avisar := true;
  ELSIF v_existente.status <> 'pending' THEN
    -- Batida atípica depois de respondido reabre a data.
    UPDATE public.time_clock_day_reviews
    SET motivos = array_append(motivos, v_motivo),
        status = 'pending',
        reviewed_by = NULL,
        reviewed_at = NULL
    WHERE id = v_existente.id;
    v_avisar := true;
  ELSIF NOT (v_motivo = ANY (v_existente.motivos)) THEN
    UPDATE public.time_clock_day_reviews
    SET motivos = array_append(motivos, v_motivo)
    WHERE id = v_existente.id;
  END IF;

  -- Um aviso por data, não um por batida.
  IF v_avisar THEN
    INSERT INTO public.notifications (organization_id, user_id, type, title, body)
    SELECT
      NEW.organization_id,
      approver,
      'time_clock_approval',
      '⏰ Ponto: dia fora do horário para revisar',
      public.time_clock_person_name(NEW.organization_id, NEW.user_id)
        || ' em ' || to_char(v_data, 'DD/MM') || ' — ' || v_motivo
    FROM public.time_clock_approver_ids(NEW.organization_id) AS approver
    WHERE approver <> NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS flag_day_review ON public.time_clock_punches;
CREATE TRIGGER flag_day_review
AFTER INSERT ON public.time_clock_punches
FOR EACH ROW EXECUTE FUNCTION public.flag_time_clock_day_review();

-- Resposta avisa quem bateu.
CREATE OR REPLACE FUNCTION public.notify_time_clock_day_reviewed()
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
      WHEN 'approved' THEN '✅ Ponto: seu dia fora do horário foi aprovado'
      ELSE '❌ Ponto: seu dia fora do horário foi recusado'
    END,
    to_char(NEW.work_date, 'DD/MM') || ' — ' || array_to_string(NEW.motivos, '; ')
      || COALESCE('. ' || NULLIF(btrim(NEW.review_note), ''), '')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_day_reviewed ON public.time_clock_day_reviews;
CREATE TRIGGER notify_day_reviewed
AFTER UPDATE OF status ON public.time_clock_day_reviews
FOR EACH ROW EXECUTE FUNCTION public.notify_time_clock_day_reviewed();

DROP POLICY IF EXISTS time_clock_day_reviews_select ON public.time_clock_day_reviews;
CREATE POLICY time_clock_day_reviews_select
ON public.time_clock_day_reviews
FOR SELECT TO authenticated
USING (
  (user_id = auth.uid() AND public.is_org_member(organization_id, auth.uid()))
  OR public.can_view_team_time_clock(organization_id)
);

DROP POLICY IF EXISTS time_clock_day_reviews_update ON public.time_clock_day_reviews;
CREATE POLICY time_clock_day_reviews_update
ON public.time_clock_day_reviews
FOR UPDATE TO authenticated
USING (public.can_view_team_time_clock(organization_id))
WITH CHECK (public.can_view_team_time_clock(organization_id));

-- Quem cria a linha é o gatilho (SECURITY DEFINER), nunca a tela.
REVOKE ALL ON public.time_clock_day_reviews FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.time_clock_day_reviews TO authenticated;

REVOKE ALL ON FUNCTION public.time_clock_janela(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.time_clock_segundo_do_dia(TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.time_clock_janela(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.time_clock_segundo_do_dia(TIMESTAMPTZ) TO authenticated;

COMMIT;

-- Conferência: 7 linhas, todas ok = true.
SELECT 'janela do almoço 11:00–14:30' AS item,
       (SELECT de = 11 * 3600 AND ate = 14 * 3600 + 30 * 60
        FROM public.time_clock_janela('saida_almoco')) AS ok
UNION ALL
SELECT 'servidor decide o tipo pelo horário',
       pg_get_functiondef('public.prepare_time_clock_punch()'::regprocedure)
         ILIKE '%NEW.kind := v_esperado%'
UNION ALL
SELECT 'tabela de revisão do dia', to_regclass('public.time_clock_day_reviews') IS NOT NULL
UNION ALL
SELECT 'revisão com RLS',
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.time_clock_day_reviews'::regclass)
UNION ALL
SELECT 'gatilho que marca a data',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'flag_day_review' AND NOT tgisinternal)
UNION ALL
SELECT 'gatilho que avisa a resposta',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notify_day_reviewed' AND NOT tgisinternal)
UNION ALL
SELECT 'ninguém insere revisão pela tela',
       NOT has_table_privilege('authenticated', 'public.time_clock_day_reviews', 'INSERT');
