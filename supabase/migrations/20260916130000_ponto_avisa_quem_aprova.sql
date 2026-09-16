-- ============================================================================
-- Ponto: pedido pendente avisa quem aprova, e a resposta avisa quem pediu.
--
-- Hoje quem pede ajuste de horário ou ausência fica esperando sem que ninguém
-- seja avisado: o pedido só aparece para quem abrir a aba "Visão da equipe"
-- do Ponto. Havia 1 ajuste pendente no momento desta migration.
--
-- Quem aprova é a mesma regra de can_view_team_time_clock (e-mail da ADM ou
-- cargo ADM/Head) — aqui extraída para uma função própria, porque o gatilho
-- roda sem auth.uid() do aprovador.
--
-- Idempotente.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.time_clock_adjustment_requests') IS NULL
     OR to_regclass('public.time_clock_absences') IS NULL
     OR to_regclass('public.notifications') IS NULL
     OR to_regclass('public.organization_members') IS NULL THEN
    RAISE EXCEPTION 'Faltam tabelas do Ponto ou de notificações';
  END IF;
END;
$$;

-- Quem pode aprovar ponto nesta organização.
CREATE OR REPLACE FUNCTION public.time_clock_approver_ids(_organization_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT member.user_id
  FROM public.organization_members member
  JOIN auth.users account ON account.id = member.user_id
  WHERE member.organization_id = _organization_id
    AND member.status = 'active'
    AND (
      lower(account.email) = 'ferlopesmoro@gmail.com'
      OR lower(btrim(COALESCE(member.job_title, ''))) IN ('adm', 'head')
    )
$$;

-- Como a pessoa é chamada no aviso.
CREATE OR REPLACE FUNCTION public.time_clock_person_name(_organization_id UUID, _user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(btrim(member.display_name), ''),
    NULLIF(btrim(profile.full_name), ''),
    'Alguém da equipe'
  )
  FROM public.organization_members member
  LEFT JOIN public.profiles profile ON profile.id = member.user_id
  WHERE member.organization_id = _organization_id
    AND member.user_id = _user_id
  LIMIT 1
$$;

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
    WHEN 'atestado' THEN 'atestado'
    WHEN 'folga' THEN 'folga'
    WHEN 'ferias' THEN 'férias'
    WHEN 'outro' THEN 'ausência'
    ELSE _kind
  END
$$;

-- Pedido de ajuste de horário → avisa quem aprova.
CREATE OR REPLACE FUNCTION public.notify_time_clock_adjustment_requested()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (organization_id, user_id, type, title, body)
  SELECT
    NEW.organization_id,
    approver,
    'time_clock_approval',
    '⏰ Ponto: horário para aprovar',
    public.time_clock_person_name(NEW.organization_id, NEW.user_id)
      || ' pediu ' || public.time_clock_kind_label(NEW.kind) || ' em '
      || to_char(NEW.requested_punched_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM')
      || ' às '
      || to_char(NEW.requested_punched_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')
  FROM public.time_clock_approver_ids(NEW.organization_id) AS approver
  -- Quem pediu não precisa aprovar a si mesmo.
  WHERE approver <> NEW.user_id;

  RETURN NEW;
END;
$$;

-- Pedido de ausência → avisa quem aprova.
CREATE OR REPLACE FUNCTION public.notify_time_clock_absence_requested()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (organization_id, user_id, type, title, body)
  SELECT
    NEW.organization_id,
    approver,
    'time_clock_approval',
    '📄 Ponto: ausência para aprovar',
    public.time_clock_person_name(NEW.organization_id, NEW.user_id)
      || ' pediu ' || public.time_clock_kind_label(NEW.kind) || ' de '
      || to_char(NEW.start_date, 'DD/MM') || ' a ' || to_char(NEW.end_date, 'DD/MM')
  FROM public.time_clock_approver_ids(NEW.organization_id) AS approver
  WHERE approver <> NEW.user_id;

  RETURN NEW;
END;
$$;

-- Resposta (aprovado/recusado) → avisa quem pediu, para nada ficar sem resposta.
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
      || to_char(NEW.requested_punched_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM');
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

DROP TRIGGER IF EXISTS notify_adjustment_requested ON public.time_clock_adjustment_requests;
CREATE TRIGGER notify_adjustment_requested
AFTER INSERT ON public.time_clock_adjustment_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_time_clock_adjustment_requested();

DROP TRIGGER IF EXISTS notify_adjustment_reviewed ON public.time_clock_adjustment_requests;
CREATE TRIGGER notify_adjustment_reviewed
AFTER UPDATE OF status ON public.time_clock_adjustment_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_time_clock_request_reviewed();

DROP TRIGGER IF EXISTS notify_absence_requested ON public.time_clock_absences;
CREATE TRIGGER notify_absence_requested
AFTER INSERT ON public.time_clock_absences
FOR EACH ROW EXECUTE FUNCTION public.notify_time_clock_absence_requested();

DROP TRIGGER IF EXISTS notify_absence_reviewed ON public.time_clock_absences;
CREATE TRIGGER notify_absence_reviewed
AFTER UPDATE OF status ON public.time_clock_absences
FOR EACH ROW EXECUTE FUNCTION public.notify_time_clock_request_reviewed();

-- O que já está pendente hoje também precisa ser avisado (sem duplicar).
INSERT INTO public.notifications (organization_id, user_id, type, title, body)
SELECT
  request.organization_id,
  approver,
  'time_clock_approval',
  '⏰ Ponto: horário para aprovar',
  public.time_clock_person_name(request.organization_id, request.user_id)
    || ' pediu ' || public.time_clock_kind_label(request.kind) || ' em '
    || to_char(request.requested_punched_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM')
    || ' às '
    || to_char(request.requested_punched_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')
FROM public.time_clock_adjustment_requests request
CROSS JOIN LATERAL public.time_clock_approver_ids(request.organization_id) AS approver
WHERE request.status = 'pending'
  AND approver <> request.user_id
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications existente
    WHERE existente.user_id = approver
      AND existente.type = 'time_clock_approval'
      AND existente.body = public.time_clock_person_name(request.organization_id, request.user_id)
        || ' pediu ' || public.time_clock_kind_label(request.kind) || ' em '
        || to_char(request.requested_punched_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM')
        || ' às '
        || to_char(request.requested_punched_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')
  );

INSERT INTO public.notifications (organization_id, user_id, type, title, body)
SELECT
  absence.organization_id,
  approver,
  'time_clock_approval',
  '📄 Ponto: ausência para aprovar',
  public.time_clock_person_name(absence.organization_id, absence.user_id)
    || ' pediu ' || public.time_clock_kind_label(absence.kind) || ' de '
    || to_char(absence.start_date, 'DD/MM') || ' a ' || to_char(absence.end_date, 'DD/MM')
FROM public.time_clock_absences absence
CROSS JOIN LATERAL public.time_clock_approver_ids(absence.organization_id) AS approver
WHERE absence.status = 'pending'
  AND approver <> absence.user_id
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications existente
    WHERE existente.user_id = approver
      AND existente.type = 'time_clock_approval'
      AND existente.body = public.time_clock_person_name(absence.organization_id, absence.user_id)
        || ' pediu ' || public.time_clock_kind_label(absence.kind) || ' de '
        || to_char(absence.start_date, 'DD/MM') || ' a ' || to_char(absence.end_date, 'DD/MM')
  );

REVOKE ALL ON FUNCTION public.time_clock_approver_ids(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.time_clock_person_name(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.time_clock_kind_label(TEXT) FROM PUBLIC, anon;
-- A tela do Ponto precisa saber quantos pedidos existem para quem aprova.
GRANT EXECUTE ON FUNCTION public.time_clock_approver_ids(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.time_clock_kind_label(TEXT) TO authenticated;

COMMIT;

-- Conferência: 5 linhas, todas ok = true.
SELECT 'gatilho de ajuste pedido' AS item,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notify_adjustment_requested' AND NOT tgisinternal) AS ok
UNION ALL
SELECT 'gatilho de ajuste respondido',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notify_adjustment_reviewed' AND NOT tgisinternal)
UNION ALL
SELECT 'gatilho de ausência pedida',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notify_absence_requested' AND NOT tgisinternal)
UNION ALL
SELECT 'gatilho de ausência respondida',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notify_absence_reviewed' AND NOT tgisinternal)
UNION ALL
SELECT 'nenhum pendente sem aviso',
       NOT EXISTS (
         SELECT 1
         FROM public.time_clock_adjustment_requests request
         CROSS JOIN LATERAL public.time_clock_approver_ids(request.organization_id) AS approver
         WHERE request.status = 'pending'
           AND approver <> request.user_id
           AND NOT EXISTS (
             SELECT 1 FROM public.notifications existente
             WHERE existente.user_id = approver
               AND existente.type = 'time_clock_approval'
           )
       );
